import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './auth.dto';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private requestMetadata(request: Request): { ipHash?: string; userAgent?: string } {
    const userAgent = request.headers['user-agent'];
    return {
      ...(request.ip ? { ipHash: createHash('sha256').update(request.ip).digest('hex') } : {}),
      ...(userAgent ? { userAgent } : {}),
    };
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() body: RegisterDto, @Req() request: Request): Promise<unknown> {
    return { success: true, data: await this.auth.register(body, this.requestMetadata(request)) };
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() body: LoginDto, @Req() request: Request): Promise<unknown> {
    return { success: true, data: await this.auth.login(body, this.requestMetadata(request)) };
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Body() body: RefreshDto, @Req() request: Request): Promise<unknown> {
    return { success: true, data: await this.auth.refresh(body.refreshToken, this.requestMetadata(request)) };
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgot(@Body() body: ForgotPasswordDto): Promise<unknown> {
    return { success: true, data: await this.auth.forgotPassword(body) };
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reset(@Body() body: ResetPasswordDto): Promise<unknown> {
    await this.auth.resetPassword(body);
    return { success: true, data: { reset: true } };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser, @Body() body: RefreshDto): Promise<unknown> {
    await this.auth.logout(user.id, body.refreshToken);
    return { success: true, data: { loggedOut: true } };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthUser): Promise<unknown> {
    return { success: true, data: { revokedSessions: await this.auth.logoutAll(user.id) } };
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser): Promise<unknown> {
    return { success: true, data: await this.auth.sessions(user.id) };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser): unknown {
    return { success: true, data: user };
  }

  @UseGuards(JwtAuthGuard)
  @Post('email-verification/request')
  async requestVerification(@CurrentUser() user: AuthUser): Promise<unknown> {
    return { success: true, data: await this.auth.requestEmailVerification(user.id) };
  }

  @Post('email-verification/verify')
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<unknown> {
    await this.auth.verifyEmail(body.token);
    return { success: true, data: { verified: true } };
  }
}
