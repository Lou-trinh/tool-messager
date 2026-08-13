import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../common/prisma.service';
import type { QueueService } from '../common/queue.service';
import type { SubscriptionPolicyService } from '../common/subscription-policy.service';
import { AdminService } from './admin.service';

describe('AdminService subscription lifecycle', () => {
  it('does not reactivate an expired subscription when a tenant is unlocked', async () => {
    const updateSubscription = vi.fn().mockResolvedValue({});
    const prisma = {
      workspace: { findFirst: vi.fn().mockResolvedValue({ id: 'tenant-a' }), update: vi.fn().mockResolvedValue({ id: 'tenant-a', status: 'ACTIVE' }) },
      subscription: { findFirst: vi.fn().mockResolvedValue({ id: 'sub-1', endAt: new Date('2020-01-01') }), update: updateSubscription },
      campaign: { updateMany: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const service = new AdminService(prisma, {} as QueueService, {} as SubscriptionPolicyService);

    await service.setTenantStatus('admin-1', 'tenant-a', false);

    expect(updateSubscription).toHaveBeenCalledWith({ where: { id: 'sub-1' }, data: { status: 'EXPIRED' } });
  });

  it('merges tenant quota overrides without discarding existing limits', async () => {
    const updateSubscription = vi.fn().mockResolvedValue({ id: 'sub-1', overrides: { maxContacts: 2_000, apiEnabled: true } });
    const prisma = {
      subscription: { findFirst: vi.fn().mockResolvedValue({ id: 'sub-1', overrides: { maxContacts: 1_000, apiEnabled: true } }), update: updateSubscription },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const policy = { usage: vi.fn().mockResolvedValue({ contacts: { used: 10, limit: 2_000 } }) } as unknown as SubscriptionPolicyService;
    const service = new AdminService(prisma, {} as QueueService, policy);

    await service.updateTenantQuota('admin-1', 'tenant-a', { maxContacts: 2_000 });

    expect(updateSubscription).toHaveBeenCalledWith({ where: { id: 'sub-1' }, data: { overrides: { maxContacts: 2_000, apiEnabled: true } } });
  });
});
