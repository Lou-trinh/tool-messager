import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateAccountDto } from './accounts.dto';
import { AccountsService } from './accounts.service';
import { ZaloOAuthService } from './zalo-oauth.service';

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService, private readonly zaloOAuth: ZaloOAuthService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.accounts.list(user.id, workspaceId) }; }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: CreateAccountDto): Promise<unknown> { return { success: true, data: await this.accounts.create(user.id, workspaceId, body) }; }

  @Post('zalo/oauth/start')
  async startZaloOAuth(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> {
    return { success: true, data: await this.zaloOAuth.begin(user.id, workspaceId) };
  }

  @Post(':accountId/zalo/refresh')
  async refreshZalo(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('accountId') accountId: string): Promise<unknown> {
    await this.zaloOAuth.refreshAccount(user.id, workspaceId, accountId);
    return { success: true, data: { refreshed: true } };
  }

  @Post(':accountId/sync')
  async sync(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('accountId') accountId: string): Promise<unknown> { return { success: true, data: await this.accounts.sync(user.id, workspaceId, accountId) }; }

  @Delete(':accountId')
  async disconnect(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('accountId') accountId: string): Promise<unknown> { return { success: true, data: await this.accounts.disconnect(user.id, workspaceId, accountId) }; }
}
