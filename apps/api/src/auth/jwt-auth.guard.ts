import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from './current-user.decorator';
import type { AuthUser } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Missing bearer token.');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new UnauthorizedException('Authentication is not configured.');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(token, {
        secret,
      });
      const user: AuthUser = { id: payload.sub, email: payload.email };
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired.');
    }
  }
}
