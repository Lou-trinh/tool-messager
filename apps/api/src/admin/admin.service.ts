import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import argon2 from 'argon2';
import type { Prisma, SubscriptionStatus } from '@omni/database';
import { queues } from '@omni/queue';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';
import { SubscriptionPolicyService } from '../common/subscription-policy.service';
import type { ChangePlanDto, CreateTenantDto, ExtendSubscriptionDto, GlobalSuppressionDto, ResetTenantPasswordDto, SupportSessionDto, UpdateTenantDto, UpsertPlanDto } from './admin.dto';

const outboundQueues = [queues.messageSend, queues.messageRetry, queues.automationExecute, queues.postPublish] as const;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly queue: QueueService, private readonly policy: SubscriptionPolicyService) {}

  private async audit(adminId: string, workspaceId: string | undefined, action: string, resource: string, resourceId?: string, metadata?: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.auditLog.create({ data: { ...(workspaceId ? { workspaceId } : {}), userId: adminId, action, resource, ...(resourceId ? { resourceId } : {}), result: 'SUCCESS', ...(metadata ? { metadata } : {}) } });
  }

  async dashboard(): Promise<unknown> {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [totalTenants, activeTenants, suspendedTenants, expiredTenants, totalAccounts, connectedAccounts, totalContacts, messagesToday, messagesMonth, activeCampaigns, failedCampaigns, queue, control] = await Promise.all([
      this.prisma.workspace.count({ where: { deletedAt: null } }),
      this.prisma.workspace.count({ where: { deletedAt: null, status: 'ACTIVE', suspendedAt: null } }),
      this.prisma.workspace.count({ where: { deletedAt: null, OR: [{ status: 'SUSPENDED' }, { suspendedAt: { not: null } }] } }),
      this.prisma.subscription.count({ where: { OR: [{ status: 'EXPIRED' }, { endAt: { lt: now } }] } }),
      this.prisma.socialAccount.count({ where: { deletedAt: null } }),
      this.prisma.socialAccount.count({ where: { deletedAt: null, status: 'CONNECTED' } }),
      this.prisma.contact.count({ where: { deletedAt: null } }),
      this.prisma.message.count({ where: { direction: 'OUTBOUND', createdAt: { gte: dayStart } } }),
      this.prisma.message.count({ where: { direction: 'OUTBOUND', createdAt: { gte: monthStart } } }),
      this.prisma.campaign.count({ where: { deletedAt: null, status: { in: ['RUNNING', 'SCHEDULED'] } } }),
      this.prisma.campaign.count({ where: { deletedAt: null, status: 'FAILED' } }),
      this.queue.overview([...outboundQueues]),
      this.prisma.systemControl.findUnique({ where: { id: 'global' } }),
    ]);
    return { tenants: { total: totalTenants, active: activeTenants, expired: expiredTenants, suspended: suspendedTenants }, accounts: { total: totalAccounts, connected: connectedAccounts, disconnected: totalAccounts - connectedAccounts }, contacts: totalContacts, messages: { today: messagesToday, month: messagesMonth }, campaigns: { active: activeCampaigns, failed: failedCampaigns }, queue, system: { outboundPaused: control?.outboundPaused ?? false, reason: control?.reason ?? null, api: 'HEALTHY', worker: 'OBSERVABLE_BY_QUEUE' } };
  }

  async tenants(): Promise<unknown[]> {
    const items = await this.prisma.workspace.findMany({ where: { deletedAt: null }, include: { members: { where: { role: 'OWNER', status: 'ACTIVE' }, take: 1, include: { user: { select: { id: true, displayName: true, email: true } } } }, subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { accounts: true, contacts: true, campaigns: true, messages: true, members: true } } }, orderBy: { createdAt: 'desc' } });
    return items.map(({ subscriptions, members, ...tenant }) => ({ ...tenant, owner: members[0]?.user ?? null, subscription: subscriptions[0] ? { ...subscriptions[0], plan: { ...subscriptions[0].plan, maxStorageBytes: Number(subscriptions[0].plan.maxStorageBytes) } } : null }));
  }

  async tenant(tenantId: string): Promise<unknown> {
    const tenant = await this.prisma.workspace.findFirst({ where: { id: tenantId, deletedAt: null }, include: { members: { include: { user: { select: { id: true, email: true, displayName: true, systemRole: true } } } }, subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' } }, _count: { select: { accounts: true, contacts: true, campaigns: true, messages: true, conversations: true, backgroundJobs: true } } } });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    return { ...tenant, subscriptions: tenant.subscriptions.map((subscription) => ({ ...subscription, plan: { ...subscription.plan, maxStorageBytes: Number(subscription.plan.maxStorageBytes) } })), usage: await this.policy.usage(tenantId) };
  }

  async createTenant(adminId: string, input: CreateTenantDto): Promise<unknown> {
    const email = input.ownerEmail.trim().toLowerCase();
    if (await this.prisma.workspace.findUnique({ where: { slug: input.tenantSlug } })) throw new ConflictException('Tenant slug already exists.');
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('Owner email already exists.');
    const startAt = new Date(input.startDate); const endAt = new Date(input.expirationDate);
    if (endAt <= startAt) throw new ConflictException('Expiration date must be after start date.');
    const passwordHash = await argon2.hash(input.temporaryPassword);
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUniqueOrThrow({ where: { code: input.plan } });
      const owner = await tx.user.create({ data: { email, displayName: input.ownerName, passwordHash } });
      const tenant = await tx.workspace.create({ data: { name: input.companyName, slug: input.tenantSlug, status: 'ACTIVE' } });
      await tx.workspaceMember.create({ data: { workspaceId: tenant.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
      const overrides = { ...(input.maxAccounts !== undefined ? { maxZaloAccounts: input.maxAccounts } : {}), ...(input.maxContacts !== undefined ? { maxContacts: input.maxContacts } : {}), ...(input.maxMessages !== undefined ? { maxMessagesPerMonth: input.maxMessages } : {}) };
      const subscription = await tx.subscription.create({ data: { workspaceId: tenant.id, planId: plan.id, startAt, endAt, status: endAt <= new Date() ? 'EXPIRED' : 'ACTIVE', overrides } });
      await tx.auditLog.create({ data: { workspaceId: tenant.id, userId: adminId, action: 'TENANT_CREATED', resource: 'Workspace', resourceId: tenant.id, result: 'SUCCESS', metadata: { plan: input.plan, ownerId: owner.id, subscriptionId: subscription.id } } });
      return { tenant, owner: { id: owner.id, email: owner.email, displayName: owner.displayName }, subscription };
    });
  }

  async updateTenant(adminId: string, tenantId: string, input: UpdateTenantDto): Promise<unknown> {
    const tenant = await this.prisma.workspace.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    const updated = await this.prisma.workspace.update({ where: { id: tenantId }, data: { ...(input.companyName ? { name: input.companyName } : {}), ...(input.timezone ? { timezone: input.timezone } : {}) } });
    await this.audit(adminId, tenantId, 'TENANT_UPDATED', 'Workspace', tenantId);
    return updated;
  }

  async setTenantStatus(adminId: string, tenantId: string, suspended: boolean): Promise<unknown> {
    const tenant = await this.prisma.workspace.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    const updated = await this.prisma.workspace.update({ where: { id: tenantId }, data: { status: suspended ? 'SUSPENDED' : 'ACTIVE', suspendedAt: suspended ? new Date() : null } });
    await this.prisma.subscription.updateMany({ where: { workspaceId: tenantId, status: { in: ['ACTIVE', 'EXPIRING', 'SUSPENDED'] } }, data: { status: suspended ? 'SUSPENDED' : 'ACTIVE' } });
    if (suspended) await this.prisma.campaign.updateMany({ where: { workspaceId: tenantId, status: { in: ['RUNNING', 'SCHEDULED'] } }, data: { status: 'PAUSED' } });
    await this.audit(adminId, tenantId, suspended ? 'TENANT_SUSPENDED' : 'TENANT_ACTIVATED', 'Workspace', tenantId);
    return updated;
  }

  async archiveTenant(adminId: string, tenantId: string): Promise<void> {
    const result = await this.prisma.workspace.updateMany({ where: { id: tenantId, deletedAt: null }, data: { status: 'ARCHIVED', deletedAt: new Date(), suspendedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Tenant not found.');
    await this.audit(adminId, tenantId, 'TENANT_ARCHIVED', 'Workspace', tenantId);
  }

  async changePlan(adminId: string, tenantId: string, input: ChangePlanDto): Promise<unknown> {
    const subscription = await this.prisma.subscription.findFirst({ where: { workspaceId: tenantId }, orderBy: { createdAt: 'desc' } });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { code: input.plan } });
    const overrides = { ...(input.maxAccounts !== undefined ? { maxZaloAccounts: input.maxAccounts } : {}), ...(input.maxContacts !== undefined ? { maxContacts: input.maxContacts } : {}), ...(input.maxMessagesPerMonth !== undefined ? { maxMessagesPerMonth: input.maxMessagesPerMonth } : {}) };
    const updated = await this.prisma.subscription.update({ where: { id: subscription.id }, data: { planId: plan.id, overrides } });
    await this.audit(adminId, tenantId, 'SUBSCRIPTION_PLAN_CHANGED', 'Subscription', subscription.id, { plan: input.plan });
    return updated;
  }

  async extendSubscription(adminId: string, tenantId: string, input: ExtendSubscriptionDto): Promise<unknown> {
    const subscription = await this.prisma.subscription.findFirst({ where: { workspaceId: tenantId }, orderBy: { createdAt: 'desc' } });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    const endAt = new Date(input.expirationDate);
    const status: SubscriptionStatus = endAt > new Date() ? 'ACTIVE' : 'EXPIRED';
    const updated = await this.prisma.subscription.update({ where: { id: subscription.id }, data: { endAt, status, ...(input.autoRenew !== undefined ? { autoRenew: input.autoRenew } : {}) } });
    await this.audit(adminId, tenantId, 'SUBSCRIPTION_EXTENDED', 'Subscription', subscription.id, { endAt: endAt.toISOString() });
    return updated;
  }

  async resetOwnerPassword(adminId: string, tenantId: string, input: ResetTenantPasswordDto): Promise<void> {
    const owner = await this.prisma.workspaceMember.findFirst({ where: { workspaceId: tenantId, role: 'OWNER', status: 'ACTIVE' }, select: { userId: true } });
    if (!owner) throw new NotFoundException('Tenant owner not found.');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: owner.userId }, data: { passwordHash: await argon2.hash(input.temporaryPassword) } }),
      this.prisma.refreshToken.updateMany({ where: { userId: owner.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit(adminId, tenantId, 'TENANT_OWNER_PASSWORD_RESET', 'User', owner.userId);
  }

  async startSupportSession(adminId: string, tenantId: string, input: SupportSessionDto): Promise<unknown> {
    if (!await this.prisma.workspace.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Tenant not found.');
    const session = await this.prisma.supportSession.create({ data: { adminId, workspaceId: tenantId, reason: input.reason, expiresAt: new Date(Date.now() + (input.durationMinutes ?? 60) * 60_000) } });
    await this.audit(adminId, tenantId, 'SUPPORT_SESSION_STARTED', 'SupportSession', session.id, { reason: input.reason, expiresAt: session.expiresAt.toISOString() });
    return session;
  }

  async supportSessions(adminId: string): Promise<unknown[]> {
    await this.prisma.supportSession.updateMany({ where: { adminId, status: 'ACTIVE', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED', endedAt: new Date() } });
    return this.prisma.supportSession.findMany({
      where: { adminId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
      orderBy: { startedAt: 'desc' },
    });
  }

  async endSupportSession(adminId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.supportSession.findFirst({ where: { id: sessionId, adminId, status: 'ACTIVE' } });
    if (!session) throw new NotFoundException('Active support session not found.');
    await this.prisma.supportSession.update({ where: { id: sessionId }, data: { status: 'ENDED', endedAt: new Date() } });
    await this.audit(adminId, session.workspaceId, 'SUPPORT_SESSION_ENDED', 'SupportSession', sessionId);
  }

  async plans(): Promise<unknown[]> {
    const plans = await this.prisma.plan.findMany({ orderBy: { monthlyPriceCents: 'asc' } });
    return plans.map((plan) => ({ ...plan, maxStorageBytes: Number(plan.maxStorageBytes) }));
  }

  async updatePlan(adminId: string, code: 'FREE' | 'BASIC' | 'PRO' | 'BUSINESS' | 'ENTERPRISE', input: UpsertPlanDto): Promise<unknown> {
    const plan = await this.prisma.plan.upsert({ where: { code }, update: { ...input, maxStorageBytes: BigInt(input.maxStorageBytes) }, create: { code, ...input, maxStorageBytes: BigInt(input.maxStorageBytes) } });
    await this.audit(adminId, undefined, 'PLAN_UPDATED', 'Plan', plan.id, { code });
    return { ...plan, maxStorageBytes: Number(plan.maxStorageBytes) };
  }

  async usage(): Promise<unknown[]> {
    const tenants = await this.prisma.workspace.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true } });
    return Promise.all(tenants.map(async (tenant) => { try { return { ...tenant, usage: await this.policy.usage(tenant.id) }; } catch (error) { return { ...tenant, error: error instanceof Error ? error.message : 'Usage unavailable' }; } }));
  }

  async subscriptions(): Promise<unknown[]> {
    const items = await this.prisma.subscription.findMany({ include: { workspace: { select: { id: true, name: true, slug: true } }, plan: true }, orderBy: { createdAt: 'desc' } });
    return items.map((item) => ({ ...item, plan: { ...item.plan, maxStorageBytes: Number(item.plan.maxStorageBytes) } }));
  }

  async logs(): Promise<unknown[]> {
    return this.prisma.auditLog.findMany({ include: { workspace: { select: { name: true, slug: true } }, user: { select: { email: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  async queueOverview(): Promise<unknown> { return this.queue.overview([...outboundQueues]); }

  async globalSuppressions(): Promise<unknown[]> {
    return this.prisma.suppressionEntry.findMany({ where: { scope: 'GLOBAL' }, orderBy: { createdAt: 'desc' } });
  }

  async addGlobalSuppression(adminId: string, input: GlobalSuppressionDto): Promise<unknown> {
    const normalizedPhone = input.phone ? this.normalizePhone(input.phone) : undefined;
    const platformUserId = input.platformUserId?.trim();
    if (!normalizedPhone && !(input.platform && platformUserId)) throw new ConflictException('Phone or platform + platformUserId is required.');
    const identifier: Prisma.SuppressionEntryWhereInput = normalizedPhone
      ? { normalizedPhone }
      : { platform: input.platform!, platformUserId: platformUserId! };
    const contactIdentifier: Prisma.ContactWhereInput = normalizedPhone
      ? { normalizedPhone }
      : { platform: input.platform!, platformUserId: platformUserId! };
    const existing = await this.prisma.suppressionEntry.findFirst({ where: { scope: 'GLOBAL', ...identifier } });
    const identifierData = normalizedPhone
      ? { normalizedPhone }
      : { platform: input.platform!, platformUserId: platformUserId! };
    const entry = existing
      ? await this.prisma.suppressionEntry.update({ where: { id: existing.id }, data: { reason: input.reason, source: 'SUPER_ADMIN', createdById: adminId } })
      : await this.prisma.suppressionEntry.create({ data: { scope: 'GLOBAL', ...identifierData, reason: input.reason, source: 'SUPER_ADMIN', createdById: adminId } });
    await this.prisma.contact.updateMany({ where: contactIdentifier, data: { suppressed: true, status: 'DO_NOT_CONTACT', consentStatus: 'OPTED_OUT' } });
    await this.audit(adminId, undefined, 'GLOBAL_SUPPRESSION_ADDED', 'SuppressionEntry', entry.id, { ...identifierData, reason: input.reason });
    return entry;
  }

  async removeGlobalSuppression(adminId: string, entryId: string): Promise<void> {
    const result = await this.prisma.suppressionEntry.deleteMany({ where: { id: entryId, scope: 'GLOBAL' } });
    if (!result.count) throw new NotFoundException('Global suppression entry not found.');
    await this.audit(adminId, undefined, 'GLOBAL_SUPPRESSION_REMOVED', 'SuppressionEntry', entryId);
  }

  async setEmergencyStop(adminId: string, paused: boolean, reason?: string): Promise<unknown> {
    const control = await this.prisma.systemControl.upsert({ where: { id: 'global' }, update: { outboundPaused: paused, reason: paused ? (reason ?? 'Emergency stop') : null, updatedById: adminId }, create: { id: 'global', outboundPaused: paused, reason: paused ? (reason ?? 'Emergency stop') : null, updatedById: adminId } });
    if (paused) {
      await Promise.all([this.queue.pauseMany([...outboundQueues]), this.prisma.campaign.updateMany({ where: { status: { in: ['RUNNING', 'SCHEDULED'] } }, data: { status: 'PAUSED' } })]);
    } else await this.queue.resumeMany([...outboundQueues]);
    await this.audit(adminId, undefined, paused ? 'SYSTEM_OUTBOUND_PAUSED' : 'SYSTEM_OUTBOUND_RESUMED', 'SystemControl', control.id, { reason: control.reason });
    return control;
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) throw new ConflictException('Invalid phone number.');
    if (digits.startsWith('84')) return `+${digits}`;
    if (digits.startsWith('0')) return `+84${digits.slice(1)}`;
    return `+${digits}`;
  }
}
