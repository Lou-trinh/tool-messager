import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from './current-user.decorator';
import type { AuthUser } from './auth.types';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Missing bearer token.');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new UnauthorizedException('Authentication is not configured.');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string; type?: string }>(token, {
        secret,
      });
      if (payload.type && payload.type !== 'access') throw new Error('Invalid token type');
      const record = await this.prisma.user.findFirst({
        where: { id: payload.sub, deletedAt: null },
        select: { id: true, email: true, systemRole: true },
      });
      if (!record) throw new Error('User no longer exists');
      const user: AuthUser = record;
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired.');
    }
  }
}
