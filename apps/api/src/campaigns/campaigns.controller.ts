import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCampaignDto, ScheduleCampaignDto } from './campaigns.dto';
import { CampaignsService } from './campaigns.service';

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}
  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.campaigns.list(user.id, workspaceId) }; }
  @Post()
  async create(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: CreateCampaignDto): Promise<unknown> { return { success: true, data: await this.campaigns.create(user.id, workspaceId, body) }; }
  @Post(':campaignId/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('campaignId') campaignId: string): Promise<unknown> { return { success: true, data: await this.campaigns.approve(user.id, workspaceId, campaignId) }; }
  @Post(':campaignId/schedule')
  async schedule(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('campaignId') campaignId: string, @Body() body: ScheduleCampaignDto): Promise<unknown> { return { success: true, data: await this.campaigns.schedule(user.id, workspaceId, campaignId, body) }; }
  @Post(':campaignId/launch')
  async launch(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('campaignId') campaignId: string): Promise<unknown> { return { success: true, data: await this.campaigns.launch(user.id, workspaceId, campaignId) }; }
}
