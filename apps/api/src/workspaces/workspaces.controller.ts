import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CreateWorkspaceDto, InviteMemberDto } from './workspaces.dto';
import { WorkspacesService } from './workspaces.service';

@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<unknown> { return { success: true, data: await this.workspaces.list(user.id) }; }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateWorkspaceDto): Promise<unknown> { return { success: true, data: await this.workspaces.create(user.id, body) }; }

  @Get(':workspaceId')
  async detail(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.workspaces.detail(user.id, workspaceId) }; }

  @Get(':workspaceId/dashboard')
  async dashboard(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.workspaces.dashboard(user.id, workspaceId) }; }

  @Get(':workspaceId/members')
  async members(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.workspaces.members(user.id, workspaceId) }; }

  @Post(':workspaceId/invitations')
  async invite(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: InviteMemberDto): Promise<unknown> { return { success: true, data: await this.workspaces.invite(user.id, workspaceId, body) }; }
  @Get(':workspaceId/usage')
  async usage(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.workspaces.usage(user.id, workspaceId) }; }
  @Get(':workspaceId/notifications')
  async notifications(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.workspaces.notifications(user.id, workspaceId) }; }
  @Patch(':workspaceId/notifications/:notificationId/read')
  async readNotification(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('notificationId') notificationId: string): Promise<unknown> { return { success: true, data: await this.workspaces.readNotification(user.id, workspaceId, notificationId) }; }
}
