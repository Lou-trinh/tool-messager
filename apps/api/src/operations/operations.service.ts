import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@omni/database';
import { queues } from '@omni/queue';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';
import { PlatformRegistryService } from '../platforms/platform-registry.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type {
  CreateAutomationDto,
  CreatePostDto,
  CreateProxyDto,
  CreateTemplateDto,
  SchedulePostDto,
  SetAutomationStatusDto,
  UpdateTemplateDto,
} from './operations.dto';

type ManagementRole = 'OWNER' | 'ADMIN' | 'MANAGER';
const managementRoles: ManagementRole[] = ['OWNER', 'ADMIN', 'MANAGER'];

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly platforms: PlatformRegistryService,
    private readonly queue: QueueService,
  ) {}

  private json(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private async audit(workspaceId: string, userId: string, action: string, resource: string, resourceId: string, metadata?: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.auditLog.create({
      data: { workspaceId, userId, action, resource, resourceId, result: 'SUCCESS', ...(metadata ? { metadata } : {}) },
    });
  }

  async templates(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId);
    return this.prisma.messageTemplate.findMany({ where: { workspaceId, deletedAt: null }, orderBy: { updatedAt: 'desc' } });
  }

  async createTemplate(userId: string, workspaceId: string, input: CreateTemplateDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, managementRoles);
    const latest = await this.prisma.messageTemplate.findFirst({ where: { workspaceId, name: input.name }, orderBy: { version: 'desc' }, select: { version: true } });
    const template = await this.prisma.messageTemplate.create({ data: { workspaceId, name: input.name, content: input.content, variables: input.variables ?? [], version: (latest?.version ?? 0) + 1 } });
    await this.audit(workspaceId, userId, 'TEMPLATE_CREATED', 'MessageTemplate', template.id);
    return template;
  }

  async updateTemplate(userId: string, workspaceId: string, templateId: string, input: UpdateTemplateDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, managementRoles);
    const current = await this.prisma.messageTemplate.findFirst({ where: { id: templateId, workspaceId, deletedAt: null } });
    if (!current) throw new NotFoundException('Message template not found.');
    const template = await this.prisma.messageTemplate.update({ where: { id: templateId }, data: { ...(input.name ? { name: input.name } : {}), ...(input.content ? { content: input.content } : {}), ...(input.variables ? { variables: input.variables } : {}), ...(input.status ? { status: input.status } : {}) } });
    await this.audit(workspaceId, userId, 'TEMPLATE_UPDATED', 'MessageTemplate', templateId);
    return template;
  }

  async deleteTemplate(userId: string, workspaceId: string, templateId: string): Promise<void> {
    await this.workspaces.assertMembership(userId, workspaceId, managementRoles);
    const result = await this.prisma.messageTemplate.updateMany({ where: { id: templateId, workspaceId, deletedAt: null }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
    if (!result.count) throw new NotFoundException('Message template not found.');
    await this.audit(workspaceId, userId, 'TEMPLATE_ARCHIVED', 'MessageTemplate', templateId);
  }

  async automations(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId);
    return this.prisma.automation.findMany({ where: { workspaceId, deletedAt: null }, include: { triggers: true, conditions: { orderBy: { sortOrder: 'asc' } }, actions: { orderBy: { sortOrder: 'asc' } } }, orderBy: { updatedAt: 'desc' } });
  }

  async createAutomation(userId: string, workspaceId: string, input: CreateAutomationDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, managementRoles);
    const automation = await this.prisma.automation.create({
      data: {
        workspaceId,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        triggers: { create: { type: input.triggerType, config: this.json(input.triggerConfig ?? {}) } },
        actions: { create: { type: input.actionType, config: this.json(input.actionConfig ?? {}) } },
      },
      include: { triggers: true, actions: true },
    });
    await this.audit(workspaceId, userId, 'AUTOMATION_CREATED', 'Automation', automation.id);
    return automation;
  }

  async setAutomationStatus(userId: string, workspaceId: string, automationId: string, input: SetAutomationStatusDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, managementRoles);
    const automation = await this.prisma.automation.findFirst({ where: { id: automationId, workspaceId, deletedAt: null }, include: { triggers: true, actions: true } });
    if (!automation) throw new NotFoundException('Automation not found.');
    if (input.status === 'ACTIVE' && (!automation.triggers.length || !automation.actions.length)) throw new BadRequestException('An active automation requires at least one trigger and one action.');
    const updated = await this.prisma.automation.update({ where: { id: automationId }, data: { status: input.status } });
    await this.audit(workspaceId, userId, 'AUTOMATION_STATUS_CHANGED', 'Automation', automationId, { status: input.status });
    return updated;
  }

  async posts(userId: string, workspaceId: string, from?: string, to?: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId);
    return this.prisma.post.findMany({
      where: { workspaceId, deletedAt: null, ...(from || to ? { scheduledAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) },
      include: { account: { select: { displayName: true, platform: true } }, media: { include: { mediaAsset: true } } },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createPost(userId: string, workspaceId: string, input: CreatePostDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, managementRoles);
    const account = await this.prisma.socialAccount.findFirst({ where: { id: input.accountId, workspaceId, deletedAt: null } });
    if (!account) throw new NotFoundException('Social account not found.');
    if (account.platform !== input.platform) throw new BadRequestException('Post platform must match its social account.');
    const key = input.idempotencyKey ?? `post:${workspaceId}:${randomBytes(12).toString('hex')}`;
    if (await this.prisma.post.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) throw new ConflictException('This post idempotency key already exists.');
    const post = await this.prisma.post.create({ data: { workspaceId, accountId: input.accountId, platform: input.platform, content: input.content, idempotencyKey: key, ...(input.title ? { title: input.title } : {}) } });
    await this.audit(workspaceId, userId, 'POST_CREATED', 'Post', post.id, { platform: input.platform });
    return post;
  }

  async schedulePost(userId: string, workspaceId: string, postId: string, input: SchedulePostDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, managementRoles);
    const scheduledAt = new Date(input.scheduledAt);
    if (scheduledAt <= new Date()) throw new BadRequestException('scheduledAt must be in the future.');
    const post = await this.prisma.post.findFirst({ where: { id: postId, workspaceId, deletedAt: null } });
    if (!post) throw new NotFoundException('Post not found.');
    if (!['DRAFT', 'APPROVED', 'FAILED'].includes(post.status)) throw new ConflictException(`Post cannot be scheduled from ${post.status}.`);
    const updated = await this.prisma.$transaction(async (tx) => {
      const value = await tx.post.update({ where: { id: postId }, data: { status: 'SCHEDULED', scheduledAt, approvedById: userId, approvedAt: new Date() } });
      await tx.postSchedule.upsert({ where: { postId }, update: { schedule: scheduledAt.toISOString(), nextRunAt: scheduledAt, ...(input.timezone ? { timezone: input.timezone } : {}) }, create: { postId, schedule: scheduledAt.toISOString(), nextRunAt: scheduledAt, ...(input.timezone ? { timezone: input.timezone } : {}) } });
      return value;
    });
    await this.audit(workspaceId, userId, 'POST_SCHEDULED', 'Post', postId, { scheduledAt: scheduledAt.toISOString() });
    return updated;
  }

  async publishPost(userId: string, workspaceId: string, postId: string): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, managementRoles);
    const post = await this.prisma.post.findFirst({ where: { id: postId, workspaceId, deletedAt: null }, include: { account: true } });
    if (!post) throw new NotFoundException('Post not found.');
    const adapter = this.platforms.get(post.platform);
    if (!adapter.isConfigured()) throw new ServiceUnavailableException(`${post.platform} official API credentials are NOT_CONFIGURED.`);
    const capability = adapter.capabilities().POST_CREATE;
    if (capability === 'NOT_SUPPORTED') throw new UnprocessableEntityException(`${post.platform} does not expose content publishing for this integration.`);
    if (capability === 'PERMISSION_REQUIRED' && !(Array.isArray(post.account.permissions) && post.account.permissions.includes('POST_CREATE'))) throw new ForbiddenException('The connected account has not granted content publishing permission.');
    const externalId = `publish-post-${post.id}`;
    await this.prisma.$transaction([
      this.prisma.post.update({ where: { id: post.id }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() } }),
      this.prisma.backgroundJob.upsert({ where: { externalId }, update: {}, create: { workspaceId, queue: queues.postPublish, externalId, type: 'POST_PUBLISH', payload: { postId } } }),
    ]);
    await this.queue.add(queues.postPublish, 'post-publish', { postId }, externalId);
    await this.audit(workspaceId, userId, 'POST_PUBLISH_QUEUED', 'Post', postId);
    return { postId, status: 'QUEUED', jobId: externalId };
  }

  async groups(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId);
    return this.prisma.group.findMany({ where: { workspaceId, deletedAt: null }, include: { account: { select: { displayName: true } }, _count: { select: { members: true } } }, orderBy: { updatedAt: 'desc' } });
  }

  async groupMembers(userId: string, workspaceId: string, groupId: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId);
    if (!await this.prisma.group.findFirst({ where: { id: groupId, workspaceId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Group not found.');
    return this.prisma.groupMember.findMany({ where: { groupId, status: 'ACTIVE' }, include: { contact: true }, orderBy: { createdAt: 'desc' } });
  }

  async syncGroup(userId: string, workspaceId: string, groupId: string): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, [...managementRoles, 'OPERATOR']);
    const group = await this.prisma.group.findFirst({ where: { id: groupId, workspaceId, deletedAt: null } });
    if (!group || !group.accountId) throw new NotFoundException('A connected group account was not found.');
    const result = await this.platforms.get(group.platform).getGroupMembers({ workspaceId, accountId: group.accountId }, group.platformGroupId);
    await this.prisma.syncJob.create({ data: { workspaceId, accountId: group.accountId, type: 'GROUP_MEMBER_SYNC', status: result.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED', lastRunAt: new Date(), ...(result.status === 'SUCCESS' ? { recordsProcessed: result.data?.length ?? 0 } : { error: { code: result.errorCode ?? 'SYNC_FAILED', message: result.message ?? 'Group sync failed.' } }) } });
    await this.audit(workspaceId, userId, 'GROUP_SYNC_REQUESTED', 'Group', groupId, { result: result.status });
    return result;
  }

  private encryptSecret(value: string): string {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) throw new ServiceUnavailableException('ENCRYPTION_KEY is not configured.');
    const key = createHash('sha256').update(encryptionKey).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  async proxies(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER', 'VIEWER']);
    return this.prisma.proxy.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, name: true, type: true, host: true, port: true, status: true, lastCheckAt: true, latencyMs: true, createdAt: true, _count: { select: { accounts: true } } }, orderBy: { createdAt: 'desc' } });
  }

  async createProxy(userId: string, workspaceId: string, input: CreateProxyDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN']);
    const proxy = await this.prisma.proxy.create({ data: { workspaceId, name: input.name, type: input.type, host: input.host, port: input.port, ...(input.username ? { encryptedUsername: this.encryptSecret(input.username) } : {}), ...(input.password ? { encryptedPassword: this.encryptSecret(input.password) } : {}) }, select: { id: true, name: true, type: true, host: true, port: true, status: true, createdAt: true } });
    await this.audit(workspaceId, userId, 'PROXY_CREATED', 'Proxy', proxy.id, { type: input.type, host: input.host, port: input.port });
    return proxy;
  }

  async assignProxy(userId: string, workspaceId: string, proxyId: string, accountId: string): Promise<void> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN']);
    const [proxy, account] = await Promise.all([this.prisma.proxy.findFirst({ where: { id: proxyId, workspaceId, deletedAt: null } }), this.prisma.socialAccount.findFirst({ where: { id: accountId, workspaceId, deletedAt: null } })]);
    if (!proxy || !account) throw new NotFoundException('Proxy or social account not found.');
    await this.prisma.accountProxy.upsert({ where: { accountId_proxyId: { accountId, proxyId } }, update: { role: 'PRIMARY' }, create: { accountId, proxyId, role: 'PRIMARY' } });
    await this.audit(workspaceId, userId, 'PROXY_ASSIGNED', 'Proxy', proxyId, { accountId });
  }

  async deleteProxy(userId: string, workspaceId: string, proxyId: string): Promise<void> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN']);
    const result = await this.prisma.proxy.updateMany({ where: { id: proxyId, workspaceId, deletedAt: null }, data: { deletedAt: new Date(), status: 'DISABLED' } });
    if (!result.count) throw new NotFoundException('Proxy not found.');
    await this.audit(workspaceId, userId, 'PROXY_DISABLED', 'Proxy', proxyId);
  }

  async analytics(userId: string, workspaceId: string): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId);
    const [contacts, optedIn, suppressed, conversations, accounts, messageStatuses, campaignStatuses, postStatuses, activeAutomations, queueCounts] = await Promise.all([
      this.prisma.contact.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.contact.count({ where: { workspaceId, deletedAt: null, consentStatus: 'OPTED_IN', suppressed: false } }),
      this.prisma.contact.count({ where: { workspaceId, deletedAt: null, suppressed: true } }),
      this.prisma.conversation.count({ where: { workspaceId } }),
      this.prisma.socialAccount.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.message.groupBy({ by: ['status'], where: { workspaceId }, _count: { _all: true } }),
      this.prisma.campaign.groupBy({ by: ['status'], where: { workspaceId, deletedAt: null }, _count: { _all: true } }),
      this.prisma.post.groupBy({ by: ['status'], where: { workspaceId, deletedAt: null }, _count: { _all: true } }),
      this.prisma.automation.count({ where: { workspaceId, deletedAt: null, status: 'ACTIVE' } }),
      this.queue.counts(queues.messageSend),
    ]);
    return { contacts: { total: contacts, optedIn, suppressed }, conversations, accounts, activeAutomations, messages: Object.fromEntries(messageStatuses.map((item) => [item.status, item._count._all])), campaigns: Object.fromEntries(campaignStatuses.map((item) => [item.status, item._count._all])), posts: Object.fromEntries(postStatuses.map((item) => [item.status, item._count._all])), queue: queueCounts };
  }

  async exportContacts(userId: string, workspaceId: string): Promise<string> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER', 'VIEWER']);
    const contacts = await this.prisma.contact.findMany({ where: { workspaceId, deletedAt: null }, select: { displayName: true, normalizedPhone: true, email: true, source: true, consentStatus: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
    const escape = (value: string | null): string => `"${(value ?? '').replaceAll('"', '""')}"`;
    return ['displayName,phone,email,source,consentStatus,status,createdAt', ...contacts.map((contact) => [contact.displayName, contact.normalizedPhone, contact.email, contact.source, contact.consentStatus, contact.status, contact.createdAt.toISOString()].map(escape).join(','))].join('\n');
  }
}
