import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CreateAutomationDto, CreatePostDto, CreateProxyDto, CreateTemplateDto, SchedulePostDto, SetAutomationStatusDto, UpdateTemplateDto } from './operations.dto';
import { OperationsService } from './operations.service';

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('templates')
  async templates(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.operations.templates(user.id, workspaceId) }; }
  @Post('templates')
  async createTemplate(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: CreateTemplateDto): Promise<unknown> { return { success: true, data: await this.operations.createTemplate(user.id, workspaceId, body) }; }
  @Patch('templates/:templateId')
  async updateTemplate(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('templateId') templateId: string, @Body() body: UpdateTemplateDto): Promise<unknown> { return { success: true, data: await this.operations.updateTemplate(user.id, workspaceId, templateId, body) }; }
  @Delete('templates/:templateId')
  async deleteTemplate(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('templateId') templateId: string): Promise<unknown> { await this.operations.deleteTemplate(user.id, workspaceId, templateId); return { success: true, data: { archived: true } }; }

  @Get('automations')
  async automations(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.operations.automations(user.id, workspaceId) }; }
  @Post('automations')
  async createAutomation(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: CreateAutomationDto): Promise<unknown> { return { success: true, data: await this.operations.createAutomation(user.id, workspaceId, body) }; }
  @Patch('automations/:automationId/status')
  async setAutomationStatus(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('automationId') automationId: string, @Body() body: SetAutomationStatusDto): Promise<unknown> { return { success: true, data: await this.operations.setAutomationStatus(user.id, workspaceId, automationId, body) }; }

  @Get('posts')
  async posts(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.operations.posts(user.id, workspaceId) }; }
  @Post('posts')
  async createPost(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: CreatePostDto): Promise<unknown> { return { success: true, data: await this.operations.createPost(user.id, workspaceId, body) }; }
  @Post('posts/:postId/schedule')
  async schedulePost(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('postId') postId: string, @Body() body: SchedulePostDto): Promise<unknown> { return { success: true, data: await this.operations.schedulePost(user.id, workspaceId, postId, body) }; }
  @Post('posts/:postId/publish')
  async publishPost(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('postId') postId: string): Promise<unknown> { return { success: true, data: await this.operations.publishPost(user.id, workspaceId, postId) }; }
  @Get('calendar')
  async calendar(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Query('from') from?: string, @Query('to') to?: string): Promise<unknown> { return { success: true, data: await this.operations.posts(user.id, workspaceId, from, to) }; }

  @Get('groups')
  async groups(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.operations.groups(user.id, workspaceId) }; }
  @Get('groups/:groupId/members')
  async groupMembers(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('groupId') groupId: string): Promise<unknown> { return { success: true, data: await this.operations.groupMembers(user.id, workspaceId, groupId) }; }
  @Post('groups/:groupId/sync')
  async syncGroup(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('groupId') groupId: string): Promise<unknown> { return { success: true, data: await this.operations.syncGroup(user.id, workspaceId, groupId) }; }

  @Get('proxies')
  async proxies(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.operations.proxies(user.id, workspaceId) }; }
  @Post('proxies')
  async createProxy(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: CreateProxyDto): Promise<unknown> { return { success: true, data: await this.operations.createProxy(user.id, workspaceId, body) }; }
  @Post('proxies/:proxyId/accounts/:accountId')
  async assignProxy(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('proxyId') proxyId: string, @Param('accountId') accountId: string): Promise<unknown> { await this.operations.assignProxy(user.id, workspaceId, proxyId, accountId); return { success: true, data: { assigned: true } }; }
  @Delete('proxies/:proxyId')
  async deleteProxy(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('proxyId') proxyId: string): Promise<unknown> { await this.operations.deleteProxy(user.id, workspaceId, proxyId); return { success: true, data: { disabled: true } }; }

  @Get('analytics')
  async analytics(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.operations.analytics(user.id, workspaceId) }; }
  @Get('contacts-export.csv')
  async exportContacts(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Res() response: Response): Promise<void> {
    const csv = await this.operations.exportContacts(user.id, workspaceId);
    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader('content-disposition', 'attachment; filename="contacts.csv"');
    response.send(`\uFEFF${csv}`);
  }
}
