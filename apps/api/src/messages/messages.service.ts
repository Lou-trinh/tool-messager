import { Injectable, NotFoundException } from '@nestjs/common';
import type { CapabilityStatus } from '@omni/shared';
import { evaluateMessageSafety } from '@omni/shared';
import { queues } from '@omni/queue';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';
import { PlatformRegistryService } from '../platforms/platform-registry.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { SendMessageDto } from './messages.dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly registry: PlatformRegistryService,
    private readonly queue: QueueService,
  ) {}

  async conversations(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId);
    return this.prisma.conversation.findMany({ where: { workspaceId }, include: { account: { select: { platform: true, displayName: true } }, contact: { select: { displayName: true, avatarUrl: true, consentStatus: true, suppressed: true } }, messages: { orderBy: { timestamp: 'desc' }, take: 1 } }, orderBy: { lastMessageAt: 'desc' }, take: 100 });
  }

  async history(userId: string, workspaceId: string, conversationId: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId);
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, workspaceId } });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return this.prisma.message.findMany({ where: { conversationId, workspaceId }, include: { attachments: true }, orderBy: { timestamp: 'asc' }, take: 500 });
  }

  async send(userId: string, workspaceId: string, input: SendMessageDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']);
    const existing = await this.prisma.message.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { message: existing, duplicatePrevented: true };
    const [account, contact] = await Promise.all([
      this.prisma.socialAccount.findFirst({ where: { id: input.accountId, workspaceId, deletedAt: null } }),
      this.prisma.contact.findFirst({ where: { id: input.contactId, workspaceId, deletedAt: null } }),
    ]);
    if (!account || !contact) throw new NotFoundException('Account or contact not found.');

    const adapter = this.registry.get(account.platform);
    const declaredCapability = adapter.capabilities().MESSAGING;
    const permissions = Array.isArray(account.permissions) ? account.permissions.filter((value): value is string => typeof value === 'string') : [];
    const capability: CapabilityStatus = !adapter.isConfigured()
      ? 'NOT_CONFIGURED'
      : declaredCapability === 'PERMISSION_REQUIRED' && permissions.includes('MESSAGING')
        ? 'SUPPORTED'
        : declaredCapability;
    const recentMessages = await this.prisma.message.count({ where: { accountId: account.id, direction: 'OUTBOUND', timestamp: { gte: new Date(Date.now() - 60_000) } } });
    const decision = evaluateMessageSafety({
      consentStatus: contact.consentStatus,
      suppressed: contact.suppressed || contact.status === 'DO_NOT_CONTACT',
      hasPermission: declaredCapability !== 'PERMISSION_REQUIRED' || permissions.includes('MESSAGING'),
      capability,
      withinRateLimit: recentMessages < Number(process.env.ACCOUNT_MESSAGES_PER_MINUTE ?? 30),
      promotional: input.promotional ?? false,
    });

    const conversation = await this.prisma.conversation.upsert({
      where: { accountId_platformConversationId: { accountId: account.id, platformConversationId: `contact:${contact.id}` } },
      update: { contactId: contact.id, lastMessageAt: new Date() },
      create: { workspaceId, accountId: account.id, contactId: contact.id, platformConversationId: `contact:${contact.id}`, title: contact.displayName, lastMessageAt: new Date() },
    });
    const message = await this.prisma.message.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        accountId: account.id,
        platform: account.platform,
        idempotencyKey: input.idempotencyKey,
        senderId: account.platformAccountId,
        receiverId: contact.platformUserId ?? contact.id,
        content: input.content,
        direction: 'OUTBOUND',
        status: decision.allowed ? 'QUEUED' : 'BLOCKED',
        metadata: { promotional: input.promotional ?? false, ...(!decision.allowed ? { blockReason: decision.reason } : {}) },
        ...(!decision.allowed ? { errorCode: decision.code } : {}),
      },
    });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: decision.allowed ? 'MESSAGE_QUEUED' : 'MESSAGE_BLOCKED', resource: 'Message', resourceId: message.id, result: decision.allowed ? 'SUCCESS' : 'BLOCKED', metadata: decision.allowed ? {} : { code: decision.code, reason: decision.reason } } });
    if (!decision.allowed) return { message, safety: decision };

    await this.prisma.backgroundJob.create({ data: { workspaceId, queue: queues.messageSend, externalId: message.id, type: 'SEND_MESSAGE', status: 'PENDING', payload: { messageId: message.id } } });
    await this.queue.add(queues.messageSend, 'send', { messageId: message.id }, message.id);
    return { message, safety: decision };
  }
}
