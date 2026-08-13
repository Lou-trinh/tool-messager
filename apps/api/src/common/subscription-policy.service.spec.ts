import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from './prisma.service';
import { SubscriptionPolicyService } from './subscription-policy.service';

const activeWorkspace = {
  status: 'ACTIVE', suspendedAt: null,
  subscriptions: [{ id: 'sub-1', status: 'ACTIVE', startAt: new Date('2026-01-01'), endAt: new Date('2099-01-01'), overrides: {}, plan: { code: 'BASIC', maxZaloAccounts: 2, maxUsers: 3, maxContacts: 5000, maxCampaigns: 25, maxMessagesPerDay: 10, maxMessagesPerMonth: 100, maxStorageBytes: 1000n, automationEnabled: false, analyticsEnabled: true, apiEnabled: false } }],
};

describe('SubscriptionPolicyService', () => {
  it('blocks all outbound work when the global kill switch is active', async () => {
    const prisma = { systemControl: { findUnique: vi.fn().mockResolvedValue({ outboundPaused: true }) } } as unknown as PrismaService;
    const policy = new SubscriptionPolicyService(prisma);
    await expect(policy.assertOutboundAllowed('tenant-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks an expired subscription while preserving read/login access elsewhere', async () => {
    const prisma = { workspace: { findFirst: vi.fn().mockResolvedValue({ ...activeWorkspace, subscriptions: [{ ...activeWorkspace.subscriptions[0], status: 'EXPIRED' }] }) } } as unknown as PrismaService;
    const policy = new SubscriptionPolicyService(prisma);
    await expect(policy.entitlements('tenant-a')).rejects.toThrow('SUBSCRIPTION_EXPIRED');
    await expect(policy.subscriptionSnapshot('tenant-a')).resolves.toMatchObject({ subscriptionStatus: 'EXPIRED', planCode: 'BASIC' });
  });

  it('blocks a subscription that has not started yet', async () => {
    const prisma = { workspace: { findFirst: vi.fn().mockResolvedValue({ ...activeWorkspace, subscriptions: [{ ...activeWorkspace.subscriptions[0], startAt: new Date('2098-01-01'), endAt: new Date('2099-01-01') }] }) } } as unknown as PrismaService;
    const policy = new SubscriptionPolicyService(prisma);
    await expect(policy.entitlements('tenant-a')).rejects.toThrow('SUBSCRIPTION_NOT_STARTED');
  });

  it('enforces the daily quota before a job is queued', async () => {
    const prisma = {
      systemControl: { findUnique: vi.fn().mockResolvedValue({ outboundPaused: false }) },
      workspace: { findFirst: vi.fn().mockResolvedValue(activeWorkspace) },
      message: { count: vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(50) },
    } as unknown as PrismaService;
    const policy = new SubscriptionPolicyService(prisma);
    await expect(policy.assertOutboundAllowed('tenant-a')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
