import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PlatformRegistryService } from '../platforms/platform-registry.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateAccountDto } from './accounts.dto';
import { ZaloOAuthService } from './zalo-oauth.service';
import { SubscriptionPolicyService } from '../common/subscription-policy.service';

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly platforms: PlatformRegistryService,
    private readonly zaloOAuth: ZaloOAuthService,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId);
    await this.zaloOAuth.refreshExpiringForWorkspace(userId, workspaceId);
    const accounts = await this.prisma.socialAccount.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, platform: true, platformAccountId: true, username: true, displayName: true, avatarUrl: true, status: true, permissions: true, tokenExpiresAt: true, lastSyncAt: true, lastErrorCode: true, createdAt: true } });
    return accounts.map((account) => ({ ...account, capabilities: this.platforms.get(account.platform).capabilities() }));
  }

  async create(userId: string, workspaceId: string, input: CreateAccountDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER']);
    const existing = await this.prisma.socialAccount.findUnique({ where: { workspaceId_platform_platformAccountId: { workspaceId, platform: input.platform, platformAccountId: input.platformAccountId } }, select: { id: true } });
    if (!existing) await this.policy.assertAccountCapacity(workspaceId);
    const adapter = this.platforms.get(input.platform);
    const account = await this.prisma.socialAccount.upsert({
      where: { workspaceId_platform_platformAccountId: { workspaceId, platform: input.platform, platformAccountId: input.platformAccountId } },
      update: { displayName: input.displayName, ...(input.username ? { username: input.username } : {}), deletedAt: null },
      create: { workspaceId, platform: input.platform, platformAccountId: input.platformAccountId, displayName: input.displayName, ...(input.username ? { username: input.username } : {}), status: 'DISCONNECTED', lastErrorCode: 'NOT_CONFIGURED' },
    });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'ACCOUNT_CREATED', resource: 'SocialAccount', resourceId: account.id, result: 'SUCCESS', metadata: { platform: input.platform } } });
    return { ...account, capabilities: adapter.capabilities(), authentication: await adapter.authenticate({}) };
  }

  async disconnect(userId: string, workspaceId: string, accountId: string): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER']);
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, workspaceId, deletedAt: null } });
    if (!account) throw new NotFoundException('Social account not found.');
    await this.prisma.platformCredential.deleteMany({ where: { accountId } });
    const updated = await this.prisma.socialAccount.update({ where: { id: accountId }, data: { status: 'DISCONNECTED', tokenExpiresAt: null, lastErrorCode: null } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'ACCOUNT_DISCONNECTED', resource: 'SocialAccount', resourceId: accountId, result: 'SUCCESS' } });
    return updated;
  }

  async sync(userId: string, workspaceId: string, accountId: string): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']);
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, workspaceId, deletedAt: null } });
    if (!account) throw new NotFoundException('Social account not found.');
    const result = await this.platforms.get(account.platform).refreshData({ workspaceId, accountId });
    await this.prisma.syncJob.create({
      data: {
        workspaceId,
        accountId,
        type: 'ACCOUNT_SYNC',
        status: result.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED',
        lastRunAt: new Date(),
        ...(result.status === 'SUCCESS'
          ? {}
          : { error: { code: result.errorCode ?? 'SYNC_FAILED', message: result.message ?? 'Account sync failed.' } }),
      },
    });
    return result;
  }
}
