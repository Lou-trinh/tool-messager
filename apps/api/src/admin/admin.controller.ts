import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { AdminService } from './admin.service';
import { ChangePlanDto, CreateTenantDto, EmergencyStopDto, ExtendSubscriptionDto, GlobalSuppressionDto, ResetTenantPasswordDto, SupportSessionDto, UpdateTenantDto, UpsertPlanDto } from './admin.dto';
import { SuperAdminGuard } from './super-admin.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard') dashboard(): Promise<unknown> { return this.wrap(this.admin.dashboard()); }
  @Get('tenants') tenants(): Promise<unknown> { return this.wrap(this.admin.tenants()); }
  @Get('tenants/:tenantId') tenant(@Param('tenantId') tenantId: string): Promise<unknown> { return this.wrap(this.admin.tenant(tenantId)); }
  @Post('tenants') createTenant(@CurrentUser() user: AuthUser, @Body() body: CreateTenantDto): Promise<unknown> { return this.wrap(this.admin.createTenant(user.id, body)); }
  @Patch('tenants/:tenantId') updateTenant(@CurrentUser() user: AuthUser, @Param('tenantId') tenantId: string, @Body() body: UpdateTenantDto): Promise<unknown> { return this.wrap(this.admin.updateTenant(user.id, tenantId, body)); }
  @Delete('tenants/:tenantId') async archiveTenant(@CurrentUser() user: AuthUser, @Param('tenantId') tenantId: string): Promise<unknown> { await this.admin.archiveTenant(user.id, tenantId); return { success: true, data: { archived: true } }; }
  @Post('tenants/:tenantId/suspend') suspend(@CurrentUser() user: AuthUser, @Param('tenantId') tenantId: string): Promise<unknown> { return this.wrap(this.admin.setTenantStatus(user.id, tenantId, true)); }
  @Post('tenants/:tenantId/activate') activate(@CurrentUser() user: AuthUser, @Param('tenantId') tenantId: string): Promise<unknown> { return this.wrap(this.admin.setTenantStatus(user.id, tenantId, false)); }
  @Post('tenants/:tenantId/change-plan') changePlan(@CurrentUser() user: AuthUser, @Param('tenantId') tenantId: string, @Body() body: ChangePlanDto): Promise<unknown> { return this.wrap(this.admin.changePlan(user.id, tenantId, body)); }
  @Post('tenants/:tenantId/extend') extend(@CurrentUser() user: AuthUser, @Param('tenantId') tenantId: string, @Body() body: ExtendSubscriptionDto): Promise<unknown> { return this.wrap(this.admin.extendSubscription(user.id, tenantId, body)); }
  @Post('tenants/:tenantId/reset-password') async resetPassword(@CurrentUser() user: AuthUser, @Param('tenantId') tenantId: string, @Body() body: ResetTenantPasswordDto): Promise<unknown> { await this.admin.resetOwnerPassword(user.id, tenantId, body); return { success: true, data: { reset: true } }; }
  @Post('tenants/:tenantId/support-sessions') support(@CurrentUser() user: AuthUser, @Param('tenantId') tenantId: string, @Body() body: SupportSessionDto): Promise<unknown> { return this.wrap(this.admin.startSupportSession(user.id, tenantId, body)); }
  @Get('support-sessions') supportSessions(@CurrentUser() user: AuthUser): Promise<unknown> { return this.wrap(this.admin.supportSessions(user.id)); }
  @Delete('support-sessions/:sessionId') async endSupport(@CurrentUser() user: AuthUser, @Param('sessionId') sessionId: string): Promise<unknown> { await this.admin.endSupportSession(user.id, sessionId); return { success: true, data: { ended: true } }; }

  @Get('plans') plans(): Promise<unknown> { return this.wrap(this.admin.plans()); }
  @Patch('plans/:code') updatePlan(@CurrentUser() user: AuthUser, @Param('code') code: 'FREE' | 'BASIC' | 'PRO' | 'BUSINESS' | 'ENTERPRISE', @Body() body: UpsertPlanDto): Promise<unknown> { return this.wrap(this.admin.updatePlan(user.id, code, body)); }
  @Get('subscriptions') subscriptions(): Promise<unknown> { return this.wrap(this.admin.subscriptions()); }
  @Get('usage') usage(): Promise<unknown> { return this.wrap(this.admin.usage()); }
  @Get('logs') logs(): Promise<unknown> { return this.wrap(this.admin.logs()); }
  @Get('queue') queue(): Promise<unknown> { return this.wrap(this.admin.queueOverview()); }
  @Get('workers') workers(): Promise<unknown> { return this.wrap(this.admin.queueOverview()); }
  @Get('suppressions') suppressions(): Promise<unknown> { return this.wrap(this.admin.globalSuppressions()); }
  @Post('suppressions') addSuppression(@CurrentUser() user: AuthUser, @Body() body: GlobalSuppressionDto): Promise<unknown> { return this.wrap(this.admin.addGlobalSuppression(user.id, body)); }
  @Delete('suppressions/:entryId') async removeSuppression(@CurrentUser() user: AuthUser, @Param('entryId') entryId: string): Promise<unknown> { await this.admin.removeGlobalSuppression(user.id, entryId); return { success: true, data: { removed: true } }; }

  @Post('emergency-stop') emergencyStop(@CurrentUser() user: AuthUser, @Body() body: EmergencyStopDto): Promise<unknown> { return this.wrap(this.admin.setEmergencyStop(user.id, true, body.reason)); }
  @Delete('emergency-stop') resumeOutbound(@CurrentUser() user: AuthUser): Promise<unknown> { return this.wrap(this.admin.setEmergencyStop(user.id, false)); }

  private async wrap(data: Promise<unknown>): Promise<unknown> { return { success: true, data: await data }; }
}
