import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import type {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './auth.dto';
import type { AuthUser, TokenPair } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private secret(name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required.`);
    return value;
  }

  private slug(value: string): string {
    const base = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `${base || 'workspace'}-${randomBytes(3).toString('hex')}`;
  }

  async register(input: RegisterDto, metadata: { ipHash?: string; userAgent?: string }): Promise<TokenPair> {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException('An account already exists for this email.');
    }
    const passwordHash = await argon2.hash(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({ data: { email, displayName: input.displayName, passwordHash } });
      const workspace = await tx.workspace.create({ data: { name: input.workspaceName, slug: this.slug(input.workspaceName) } });
      await tx.workspaceMember.create({ data: { userId: createdUser.id, workspaceId: workspace.id, role: 'OWNER' } });
      await tx.auditLog.create({ data: { workspaceId: workspace.id, userId: createdUser.id, action: 'USER_REGISTERED', resource: 'User', resourceId: createdUser.id, result: 'SUCCESS' } });
      return createdUser;
    });
    return this.issueTokens({ id: user.id, email: user.email }, metadata);
  }

  async login(input: LoginDto, metadata: { ipHash?: string; userAgent?: string }): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (!user || user.deletedAt || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    return this.issueTokens(
      { id: user.id, email: user.email },
      { ...metadata, ...(input.sessionName ? { sessionName: input.sessionName } : {}) },
    );
  }

  private async issueTokens(
    user: AuthUser,
    metadata: { ipHash?: string; userAgent?: string; sessionName?: string },
  ): Promise<TokenPair> {
    const refreshDays = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, type: 'access' },
      { secret: this.secret('JWT_SECRET'), expiresIn: 900 },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, type: 'refresh', nonce: randomBytes(16).toString('hex') },
      { secret: this.secret('JWT_REFRESH_SECRET'), expiresIn: refreshDays * 86_400 },
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshDays * 86_400_000),
        ...metadata,
      },
    });
    return { accessToken, refreshToken, expiresInSeconds: 900 };
  }

  async refresh(token: string, metadata: { ipHash?: string; userAgent?: string }): Promise<TokenPair> {
    let payload: { sub: string; email: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.secret('JWT_REFRESH_SECRET') });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    if (payload.type !== 'refresh') throw new UnauthorizedException('Invalid token type.');
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashToken(token) } });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) throw new UnauthorizedException('Refresh session is no longer active.');
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueTokens({ id: payload.sub, email: payload.email }, metadata);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, tokenHash: this.hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async logoutAll(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return result.count;
  }

  async sessions(userId: string): Promise<unknown[]> {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, sessionName: true, userAgent: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async forgotPassword(input: ForgotPasswordDto): Promise<{ accepted: true; delivery: 'QUEUED' | 'NOT_CONFIGURED'; developmentToken?: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (!user) return { accepted: true, delivery: process.env.SMTP_URL ? 'QUEUED' : 'NOT_CONFIGURED' };
    const rawToken = randomBytes(32).toString('base64url');
    await this.prisma.user.update({ where: { id: user.id }, data: { resetTokenHash: this.hashToken(rawToken), resetTokenExpiresAt: new Date(Date.now() + 3_600_000) } });
    const delivery = process.env.SMTP_URL ? 'QUEUED' : 'NOT_CONFIGURED';
    return {
      accepted: true,
      delivery,
      ...(process.env.NODE_ENV !== 'production' ? { developmentToken: rawToken } : {}),
    };
  }

  async resetPassword(input: ResetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { resetTokenHash: this.hashToken(input.token), resetTokenExpiresAt: { gt: new Date() } } });
    if (!user) throw new UnauthorizedException('Reset token is invalid or expired.');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(input.newPassword), resetTokenHash: null, resetTokenExpiresAt: null } }),
      this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async requestEmailVerification(userId: string): Promise<{ delivery: 'QUEUED' | 'NOT_CONFIGURED'; developmentToken?: string }> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.emailVerificationToken.create({ data: { userId, tokenHash: this.hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) } });
    const delivery = process.env.SMTP_URL ? 'QUEUED' : 'NOT_CONFIGURED';
    return { delivery, ...(process.env.NODE_ENV !== 'production' ? { developmentToken: token } : {}) };
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: this.hashToken(token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw new UnauthorizedException('Verification token is invalid or expired.');
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
  }
}
