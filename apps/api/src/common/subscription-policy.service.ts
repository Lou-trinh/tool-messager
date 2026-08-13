import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Plan, Subscription } from '@omni/database';
import { subscriptionLifecycleStatus } from '@omni/shared';
import { PrismaService } from './prisma.service';

type Entitlements = {
  planCode: Plan['code'];
  subscriptionId: string;
  subscriptionStatus: Subscription['status'];
  subscriptionStart: Date;
  subscriptionEnd: Date;
  maxZaloAccounts: number;
  maxUsers: number;
  maxContacts: number;
  maxCampaigns: number;
  maxMessagesPerDay: number;
  maxMessagesPerMonth: number;
  maxStorageBytes: bigint;
  automationEnabled: boolean;
  analyticsEnabled: boolean;
  apiEnabled: boolean;
};

@Injectable()
export class SubscriptionPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  private override<T extends number | boolean | bigint>(overrides: unknown, key: string, fallback: T): T {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return fallback;
    const value = (overrides as Record<string, unknown>)[key];
    if (typeof fallback === 'bigint' && (typeof value === 'number' || typeof value === 'string')) return BigInt(value) as T;
    if (typeof value === typeof fallback) return value as T;
    return fallback;
  }

  private async resolveEntitlements(workspaceId: string, enforceActive: boolean): Promise<Entitlements> {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: {
        status: true,
        suspendedAt: true,
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!workspace) throw new ForbiddenException('TENANT_NOT_FOUND: Tenant does not exist.');
    if (enforceActive && (workspace.status !== 'ACTIVE' || workspace.suspendedAt)) {
      throw new ForbiddenException('TENANT_SUSPENDED: Tenant is not active.');
    }
    const subscription = workspace.subscriptions[0];
    if (!subscription) throw new ForbiddenException('SUBSCRIPTION_NOT_CONFIGURED: Tenant does not have a subscription.');
    const now = new Date();
    const lifecycleStatus = subscriptionLifecycleStatus(subscription.endAt, now);
    const effectiveStatus = lifecycleStatus === 'EXPIRED' ? 'EXPIRED' : subscription.status === 'ACTIVE' || subscription.status === 'EXPIRING' ? lifecycleStatus : subscription.status;
    if (enforceActive && subscription.startAt > now) {
      throw new ForbiddenException('SUBSCRIPTION_NOT_STARTED: Subscription is not active yet.');
    }
    if (enforceActive && (effectiveStatus === 'SUSPENDED' || effectiveStatus === 'CANCELLED')) {
      throw new ForbiddenException(`SUBSCRIPTION_${subscription.status}: Outbound operations are disabled.`);
    }
    if (enforceActive && effectiveStatus === 'EXPIRED') {
      if (subscription.status !== 'EXPIRED') {
        await this.prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED' } });
      }
      throw new ForbiddenException('SUBSCRIPTION_EXPIRED: Outbound operations are disabled.');
    }
    const { plan, overrides } = subscription;
    return {
      planCode: plan.code,
      subscriptionId: subscription.id,
      subscriptionStatus: effectiveStatus,
      subscriptionStart: subscription.startAt,
      subscriptionEnd: subscription.endAt,
      maxZaloAccounts: this.override(overrides, 'maxZaloAccounts', plan.maxZaloAccounts),
      maxUsers: this.override(overrides, 'maxUsers', plan.maxUsers),
      maxContacts: this.override(overrides, 'maxContacts', plan.maxContacts),
      maxCampaigns: this.override(overrides, 'maxCampaigns', plan.maxCampaigns),
      maxMessagesPerDay: this.override(overrides, 'maxMessagesPerDay', plan.maxMessagesPerDay),
      maxMessagesPerMonth: this.override(overrides, 'maxMessagesPerMonth', plan.maxMessagesPerMonth),
      maxStorageBytes: this.override(overrides, 'maxStorageBytes', plan.maxStorageBytes),
      automationEnabled: this.override(overrides, 'automationEnabled', plan.automationEnabled),
      analyticsEnabled: this.override(overrides, 'analyticsEnabled', plan.analyticsEnabled),
      apiEnabled: this.override(overrides, 'apiEnabled', plan.apiEnabled),
    };
  }

  async entitlements(workspaceId: string): Promise<Entitlements> {
    return this.resolveEntitlements(workspaceId, true);
  }

  async subscriptionSnapshot(workspaceId: string): Promise<Entitlements> {
    return this.resolveEntitlements(workspaceId, false);
  }

  async assertOutboundAllowed(workspaceId: string, additionalMessages = 1): Promise<Entitlements> {
    const control = await this.prisma.systemControl.findUnique({ where: { id: 'global' } });
    if (control?.outboundPaused) throw new ForbiddenException('SYSTEM_OUTBOUND_PAUSED: Outbound queues are paused by SUPER_ADMIN.');
    const limits = await this.entitlements(workspaceId);
    const now = new Date();
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [today, month] = await Promise.all([
      this.prisma.message.count({ where: { workspaceId, direction: 'OUTBOUND', createdAt: { gte: dayStart } } }),
      this.prisma.message.count({ where: { workspaceId, direction: 'OUTBOUND', createdAt: { gte: monthStart } } }),
    ]);
    if (today + additionalMessages > limits.maxMessagesPerDay) {
      throw new UnprocessableEntityException('DAILY_MESSAGE_QUOTA_EXCEEDED: Daily message quota exceeded.');
    }
    if (month + additionalMessages > limits.maxMessagesPerMonth) {
      throw new UnprocessableEntityException('MONTHLY_MESSAGE_QUOTA_EXCEEDED: Monthly message quota exceeded.');
    }
    return limits;
  }

  async assertAccountCapacity(workspaceId: string): Promise<void> {
    const limits = await this.entitlements(workspaceId);
    const current = await this.prisma.socialAccount.count({ where: { workspaceId, deletedAt: null } });
    if (current >= limits.maxZaloAccounts) throw new UnprocessableEntityException('ACCOUNT_QUOTA_EXCEEDED: Zalo account quota exceeded.');
  }

  async assertContactCapacity(workspaceId: string, additional = 1): Promise<void> {
    const limits = await this.entitlements(workspaceId);
    const current = await this.prisma.contact.count({ where: { workspaceId, deletedAt: null } });
    if (current + additional > limits.maxContacts) throw new UnprocessableEntityException('CONTACT_QUOTA_EXCEEDED: Contact quota exceeded.');
  }

  async assertCampaignCapacity(workspaceId: string): Promise<void> {
    const limits = await this.entitlements(workspaceId);
    const current = await this.prisma.campaign.count({ where: { workspaceId, deletedAt: null } });
    if (current >= limits.maxCampaigns) throw new UnprocessableEntityException('CAMPAIGN_QUOTA_EXCEEDED: Campaign quota exceeded.');
  }

  async usage(workspaceId: string): Promise<unknown> {
    const limits = await this.subscriptionSnapshot(workspaceId);
    const now = new Date();
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [users, accounts, contacts, campaigns, messagesToday, messagesMonth, storage] = await Promise.all([
      this.prisma.workspaceMember.count({ where: { workspaceId, status: { in: ['ACTIVE', 'INVITED'] } } }),
      this.prisma.socialAccount.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.contact.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.campaign.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.message.count({ where: { workspaceId, direction: 'OUTBOUND', createdAt: { gte: dayStart } } }),
      this.prisma.message.count({ where: { workspaceId, direction: 'OUTBOUND', createdAt: { gte: monthStart } } }),
      this.prisma.mediaAsset.aggregate({ where: { workspaceId, deletedAt: null }, _sum: { size: true } }),
    ]);
    return {
      plan: limits.planCode,
      subscription: { status: limits.subscriptionStatus, start: limits.subscriptionStart, end: limits.subscriptionEnd },
      users: { used: users, limit: limits.maxUsers },
      accounts: { used: accounts, limit: limits.maxZaloAccounts },
      contacts: { used: contacts, limit: limits.maxContacts },
      campaigns: { used: campaigns, limit: limits.maxCampaigns },
      messagesToday: { used: messagesToday, limit: limits.maxMessagesPerDay },
      messagesMonth: { used: messagesMonth, limit: limits.maxMessagesPerMonth },
      storage: { used: Number(storage._sum.size ?? 0n), limit: Number(limits.maxStorageBytes) },
      features: { automation: limits.automationEnabled, analytics: limits.analyticsEnabled, api: limits.apiEnabled },
    };
  }
}
