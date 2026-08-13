import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../common/prisma.service';
import type { SubscriptionPolicyService } from '../common/subscription-policy.service';
import { WorkspacesService } from './workspaces.service';

describe('tenant isolation', () => {
  it('denies Tenant A user before querying a Tenant B resource', async () => {
    const memberFindUnique = vi.fn().mockResolvedValue(null);
    const workspaceFindUnique = vi.fn();
    const prisma = {
      workspaceMember: { findUnique: memberFindUnique },
      supportSession: { findFirst: vi.fn().mockResolvedValue(null) },
      workspace: { findUnique: workspaceFindUnique },
    } as unknown as PrismaService;
    const service = new WorkspacesService(prisma, {} as SubscriptionPolicyService);

    await expect(service.detail('tenant-a-user', 'tenant-b')).rejects.toBeInstanceOf(ForbiddenException);
    expect(workspaceFindUnique).not.toHaveBeenCalled();
    expect(memberFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_userId: { workspaceId: 'tenant-b', userId: 'tenant-a-user' } },
    }));
  });

  it('allows only an active, unexpired audited support session', async () => {
    const supportFindFirst = vi.fn<(args: { where: { adminId: string; workspaceId: string; status: string } }) => Promise<{ id: string } | null>>().mockResolvedValue({ id: 'support-1' });
    const auditCreate = vi.fn<(args: { data: { action: string; resourceId: string } }) => Promise<object>>().mockResolvedValue({});
    const prisma = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
      supportSession: { findFirst: supportFindFirst },
      auditLog: { create: auditCreate },
      workspace: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-b' }) },
    } as unknown as PrismaService;
    const service = new WorkspacesService(prisma, {} as SubscriptionPolicyService);

    await expect(service.detail('super-admin', 'tenant-b')).resolves.toEqual({ id: 'tenant-b' });
    expect(supportFindFirst.mock.calls[0]?.[0].where).toMatchObject({ adminId: 'super-admin', workspaceId: 'tenant-b', status: 'ACTIVE' });
    expect(auditCreate.mock.calls[0]?.[0].data).toMatchObject({ action: 'SUPPORT_MODE_ACCESS', resourceId: 'support-1' });
  });

  it('allows an active member and always scopes the resource query to the requested workspace', async () => {
    const workspaceFindUnique = vi.fn().mockResolvedValue({ id: 'tenant-a' });
    const prisma = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'VIEWER', status: 'ACTIVE', workspace: { suspendedAt: null, deletedAt: null } }) },
      workspace: { findUnique: workspaceFindUnique },
    } as unknown as PrismaService;
    const service = new WorkspacesService(prisma, {} as SubscriptionPolicyService);

    await expect(service.detail('tenant-a-user', 'tenant-a')).resolves.toEqual({ id: 'tenant-a' });
    expect(workspaceFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'tenant-a' } }));
  });

  it('denies a member when the tenant is suspended', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER', status: 'ACTIVE', workspace: { suspendedAt: new Date(), deletedAt: null } }) },
      supportSession: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new WorkspacesService(prisma, {} as SubscriptionPolicyService);

    await expect(service.assertMembership('tenant-user', 'suspended-tenant')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces declared permissions instead of trusting a client role', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'VIEWER', status: 'ACTIVE', workspace: { suspendedAt: null, deletedAt: null } }) },
    } as unknown as PrismaService;
    const service = new WorkspacesService(prisma, {} as SubscriptionPolicyService);

    await expect(service.assertPermission('viewer', 'tenant-a', 'contact.read')).resolves.toMatchObject({ role: 'VIEWER' });
    await expect(service.assertPermission('viewer', 'tenant-a', 'contact.manage')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
