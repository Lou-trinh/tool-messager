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

  private accessTtlSeconds(): number {
    const value = Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900);
    if (!Number.isSafeInteger(value) || value < 60 || value > 86_400) {
      throw new Error('JWT_ACCESS_TTL_SECONDS must be an integer between 60 and 86400.');
    }
    return value;
  }

  private refreshTtlDays(): number {
    const value = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);
    if (!Number.isSafeInteger(value) || value < 1 || value > 365) {
      throw new Error('JWT_REFRESH_TTL_DAYS must be an integer between 1 and 365.');
    }
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
      const freePlan = await tx.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
      await tx.subscription.create({
        data: {
          workspaceId: workspace.id,
          planId: freePlan.id,
          startAt: new Date(),
          endAt: new Date(Date.now() + 30 * 86_400_000),
          status: 'ACTIVE',
        },
      });
      await tx.auditLog.create({ data: { workspaceId: workspace.id, userId: createdUser.id, action: 'USER_REGISTERED', resource: 'User', resourceId: createdUser.id, result: 'SUCCESS' } });
      return createdUser;
    });
    return this.issueTokens({ id: user.id, email: user.email, systemRole: user.systemRole }, metadata);
  }

  async login(input: LoginDto, metadata: { ipHash?: string; userAgent?: string }): Promise<TokenPair> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || user.deletedAt || !(await argon2.verify(user.passwordHash, input.password))) {
      await this.prisma.auditLog.create({
        data: {
          action: 'USER_LOGIN_FAILED',
          resource: 'AuthSession',
          result: 'DENIED',
          ...(metadata.ipHash ? { ipHash: metadata.ipHash } : {}),
          metadata: { emailHash: this.hashToken(normalizedEmail), ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}) },
        },
      });
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    const tokens = await this.issueTokens(
      { id: user.id, email: user.email, systemRole: user.systemRole },
      { ...metadata, ...(input.sessionName ? { sessionName: input.sessionName } : {}) },
    );
    await this.prisma.auditLog.create({ data: { userId: user.id, action: 'USER_LOGIN', resource: 'AuthSession', result: 'SUCCESS', ...(metadata.ipHash ? { ipHash: metadata.ipHash } : {}), metadata: { ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}) } } });
    return tokens;
  }

  private async issueTokens(
    user: AuthUser,
    metadata: { ipHash?: string; userAgent?: string; sessionName?: string },
    rotation?: { familyId: string; parentId: string },
  ): Promise<TokenPair> {
    const refreshDays = this.refreshTtlDays();
    const accessTtl = this.accessTtlSeconds();
    const familyId = rotation?.familyId ?? randomBytes(16).toString('hex');
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, systemRole: user.systemRole, type: 'access' },
      { secret: this.secret('JWT_SECRET'), expiresIn: accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, systemRole: user.systemRole, type: 'refresh', familyId, nonce: randomBytes(16).toString('hex') },
      { secret: this.secret('JWT_REFRESH_SECRET'), expiresIn: refreshDays * 86_400 },
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        ...(rotation ? { parentId: rotation.parentId } : {}),
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshDays * 86_400_000),
        ...metadata,
      },
    });
    return { accessToken, refreshToken, expiresInSeconds: accessTtl };
  }

  private async revokeCompromisedFamily(userId: string, familyId: string, tokenId: string, metadata: { ipHash?: string; userAgent?: string }): Promise<void> {
    const detectedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where: { userId, familyId }, data: { revokedAt: detectedAt, reuseDetectedAt: detectedAt } }),
      this.prisma.auditLog.create({ data: { userId, action: 'REFRESH_TOKEN_REUSE_DETECTED', resource: 'AuthSession', resourceId: tokenId, result: 'DENIED', ...(metadata.ipHash ? { ipHash: metadata.ipHash } : {}), metadata: { familyId, ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}) } } }),
    ]);
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
    if (!stored) throw new UnauthorizedException('Refresh session is no longer active.');
    if (stored.revokedAt) {
      await this.revokeCompromisedFamily(stored.userId, stored.familyId, stored.id, metadata);
      throw new UnauthorizedException('Refresh token reuse detected; the entire session was revoked.');
    }
    const compromisedFamily = await this.prisma.refreshToken.findFirst({ where: { userId: stored.userId, familyId: stored.familyId, reuseDetectedAt: { not: null } }, select: { id: true } });
    if (compromisedFamily) {
      await this.revokeCompromisedFamily(stored.userId, stored.familyId, stored.id, metadata);
      throw new UnauthorizedException('Refresh session belongs to a compromised token family.');
    }
    if (stored.expiresAt <= new Date()) throw new UnauthorizedException('Refresh session is no longer active.');
    const user = await this.prisma.user.findFirst({ where: { id: payload.sub, deletedAt: null }, select: { id: true, email: true, systemRole: true } });
    if (!user || user.id !== stored.userId) throw new UnauthorizedException('User is no longer active.');
    const revoked = await this.prisma.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (revoked.count !== 1) {
      await this.revokeCompromisedFamily(stored.userId, stored.familyId, stored.id, metadata);
      throw new UnauthorizedException('Concurrent refresh reuse detected; the entire session was revoked.');
    }
    try {
      return await this.issueTokens(user, { ...metadata, ...(stored.sessionName ? { sessionName: stored.sessionName } : {}) }, { familyId: stored.familyId, parentId: stored.id });
    } catch (error) {
      await this.revokeCompromisedFamily(stored.userId, stored.familyId, stored.id, metadata);
      throw error;
    }
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, tokenHash: this.hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { userId, action: 'USER_LOGOUT', resource: 'AuthSession', result: 'SUCCESS' } });
  }

  async logoutAll(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { userId, action: 'USER_LOGOUT_ALL', resource: 'AuthSession', result: 'SUCCESS', metadata: { revokedSessions: result.count } } });
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
