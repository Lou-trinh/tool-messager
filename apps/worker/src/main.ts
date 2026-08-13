import 'dotenv/config';
import { createServer } from 'node:http';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { DelayedError, Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@omni/database';
import type { PlatformAdapter } from '@omni/platform-core';
import { FacebookAdapter } from '@omni/platform-facebook';
import { TikTokAdapter } from '@omni/platform-tiktok';
import { ZaloAdapter } from '@omni/platform-zalo';
import { queues, redisConnectionFromUrl, resilientJobOptions } from '@omni/queue';
import { evaluateMessageSafety, type Platform } from '@omni/shared';

type ImportContact = { platform: Platform; platformUserId?: string; displayName: string; username?: string; phone?: string; email?: string; source: string; consentStatus: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT'; consentSource?: string };
type StagedImportContact = ImportContact & { normalizedPhone?: string; gender?: string };
type ContactImportJob = { externalId: string; importJobId?: never } | { externalId: string; importJobId: string };
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type ZaloWebhook = { event_name?: string; timestamp?: string | number; sender?: { id?: string | number; display_name?: string }; recipient?: { id?: string | number; display_name?: string }; message?: { msg_id?: string | number; text?: string; attachments?: JsonValue[] } };

const prisma = new PrismaClient();
const connection = redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
const rateRedis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const messageQueue = new Queue(queues.messageSend, { connection, defaultJobOptions: resilientJobOptions });
const deadLetterQueue = new Queue(queues.deadLetter, { connection, defaultJobOptions: { removeOnComplete: false, removeOnFail: false } });
const adapters = new Map<Platform, PlatformAdapter>([
  ['ZALO', new ZaloAdapter()],
  ['FACEBOOK', new FacebookAdapter()],
  ['TIKTOK', new TikTokAdapter()],
]);
let healthy = true;
const refreshingTokens = new Map<string, Promise<string>>();

function adapterFor(platform: Platform): PlatformAdapter {
  const adapter = adapters.get(platform);
  if (!adapter) throw new Error(`No adapter for ${platform}`);
  return adapter;
}

function encryptionKey(): Buffer {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error('ENCRYPTION_KEY_NOT_CONFIGURED');
  return createHash('sha256').update(value).digest();
}

function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptSecret(value: string): string {
  const [ivValue, tagValue, encryptedValue, ...extra] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue || extra.length) throw new Error('ENCRYPTED_SECRET_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}

async function accessTokenFor(account: {
  id: string;
  platform: Platform;
  tokenExpiresAt: Date | null;
  credential: { encryptedAccessToken: string; encryptedRefreshToken: string | null } | null;
}): Promise<string> {
  if (!account.credential) throw new Error('PLATFORM_CREDENTIAL_MISSING');
  if (account.platform !== 'ZALO' || !account.tokenExpiresAt || account.tokenExpiresAt.getTime() > Date.now() + 5 * 60_000) {
    return decryptSecret(account.credential.encryptedAccessToken);
  }
  const activeRefresh = refreshingTokens.get(account.id);
  if (activeRefresh) return activeRefresh;
  const task = (async (): Promise<string> => {
    if (!account.credential?.encryptedRefreshToken) throw new Error('ZALO_REFRESH_TOKEN_MISSING');
    const adapter = adapterFor('ZALO');
    if (!(adapter instanceof ZaloAdapter)) throw new Error('ZALO_ADAPTER_UNAVAILABLE');
    const result = await adapter.refreshAccessToken(decryptSecret(account.credential.encryptedRefreshToken));
    if (result.status !== 'SUCCESS' || !result.data) {
      await prisma.socialAccount.update({ where: { id: account.id }, data: { status: 'REAUTH_REQUIRED', lastErrorCode: result.errorCode ?? 'ZALO_REFRESH_FAILED' } });
      throw new Error(`${result.errorCode ?? 'ZALO_REFRESH_FAILED'}: ${result.message ?? 'Zalo token refresh failed.'}`);
    }
    await prisma.$transaction([
      prisma.platformCredential.update({
        where: { accountId: account.id },
        data: {
          encryptedAccessToken: encryptSecret(result.data.accessToken),
          encryptedRefreshToken: encryptSecret(result.data.refreshToken),
          tokenVersion: { increment: 1 },
        },
      }),
      prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: 'CONNECTED', lastErrorCode: null, tokenExpiresAt: new Date(Date.now() + result.data.expiresIn * 1_000) },
      }),
    ]);
    return result.data.accessToken;
  })().finally(() => refreshingTokens.delete(account.id));
  refreshingTokens.set(account.id, task);
  return task;
}

async function accountRateAllowed(accountId: string): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rate:message:${accountId}:${minute}`;
  const count = await rateRedis.incr(key);
  if (count === 1) await rateRedis.expire(key, 90);
  return count <= Number(process.env.MESSAGE_RATE_PER_ACCOUNT_PER_MINUTE ?? 20);
}

async function outboundBlockReason(workspaceId: string, additionalMessages = 1): Promise<string | null> {
  const [control, workspace] = await Promise.all([
    prisma.systemControl.findUnique({ where: { id: 'global' } }),
    prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { status: true, suspendedAt: true, subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
  ]);
  if (control?.outboundPaused) return 'SYSTEM_OUTBOUND_PAUSED';
  if (!workspace || workspace.status !== 'ACTIVE' || workspace.suspendedAt) return 'TENANT_SUSPENDED';
  const subscription = workspace.subscriptions[0];
  if (!subscription) return 'SUBSCRIPTION_NOT_CONFIGURED';
  if (['SUSPENDED', 'CANCELLED', 'EXPIRED'].includes(subscription.status) || subscription.endAt <= new Date()) return 'SUBSCRIPTION_EXPIRED';
  const overrides = subscription.overrides && typeof subscription.overrides === 'object' && !Array.isArray(subscription.overrides) ? subscription.overrides as Record<string, unknown> : {};
  const dailyLimit = typeof overrides.maxMessagesPerDay === 'number' ? overrides.maxMessagesPerDay : subscription.plan.maxMessagesPerDay;
  const monthlyLimit = typeof overrides.maxMessagesPerMonth === 'number' ? overrides.maxMessagesPerMonth : subscription.plan.maxMessagesPerMonth;
  const now = new Date(); const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0); const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [daily, monthly] = await Promise.all([
    prisma.message.count({ where: { workspaceId, direction: 'OUTBOUND', createdAt: { gte: dayStart } } }),
    prisma.message.count({ where: { workspaceId, direction: 'OUTBOUND', createdAt: { gte: monthStart } } }),
  ]);
  if (daily + additionalMessages > dailyLimit) return 'DAILY_MESSAGE_QUOTA_EXCEEDED';
  if (monthly + additionalMessages > monthlyLimit) return 'MONTHLY_MESSAGE_QUOTA_EXCEEDED';
  return null;
}

async function blockMessage(messageId: string, reason: string): Promise<void> {
  const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { workspaceId: true } });
  await prisma.$transaction([
    prisma.message.update({ where: { id: messageId }, data: { status: 'BLOCKED', errorCode: reason } }),
    prisma.messageEvent.create({ data: { workspaceId: message.workspaceId, messageId, type: 'BLOCKED', payload: { reason } } }),
    prisma.backgroundJob.updateMany({ where: { externalId: messageId }, data: { status: 'FAILED', error: { code: reason, message: reason }, completedAt: new Date() } }),
  ]);
  await updateCampaignProgress(messageId, 'BLOCKED', reason);
}

async function updateCampaignProgress(messageId: string, status: 'SENT' | 'FAILED' | 'BLOCKED', errorCode?: string): Promise<void> {
  const linked = await prisma.campaignMessage.findUnique({ where: { messageId }, include: { campaign: true } });
  if (!linked) return;
  await prisma.campaignMessage.update({ where: { id: linked.id }, data: { status, errorCode: errorCode ?? null } });
  const grouped = await prisma.campaignMessage.groupBy({ by: ['status'], where: { campaignId: linked.campaignId }, _count: { _all: true } });
  const counts = Object.fromEntries(grouped.map((item) => [item.status, item._count._all]));
  const pending = (counts.QUEUED ?? 0) + (counts.SENDING ?? 0);
  const statistics = { queued: counts.QUEUED ?? 0, sent: (counts.SENT ?? 0) + (counts.DELIVERED ?? 0) + (counts.READ ?? 0), failed: counts.FAILED ?? 0, blocked: counts.BLOCKED ?? 0 };
  if (pending === 0) {
    const completed = await prisma.campaign.updateMany({ where: { id: linked.campaignId, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, data: { status: 'COMPLETED', statistics } });
    if (completed.count) await prisma.notification.create({ data: { workspaceId: linked.campaign.workspaceId, event: 'CAMPAIGN_COMPLETED', title: 'Chiến dịch đã hoàn tất', body: `${linked.campaign.name} đã xử lý xong hàng đợi.`, metadata: { campaignId: linked.campaignId, statistics } } });
  } else await prisma.campaign.update({ where: { id: linked.campaignId }, data: { statistics } });
}

async function processMessage(job: Job<{ messageId: string }>): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: job.data.messageId },
    include: { account: { include: { credential: true } }, conversation: { include: { contact: true } } },
  });
  if (!message || ['SENT', 'DELIVERED', 'READ', 'BLOCKED'].includes(message.status)) return;
  const campaignLink = await prisma.campaignMessage.findUnique({ where: { messageId: message.id }, include: { campaign: { select: { status: true } } } });
  if (campaignLink?.campaign.status === 'PAUSED') {
    if (!job.token) throw new Error('CAMPAIGN_PAUSED');
    await job.moveToDelayed(Date.now() + 30_000, job.token);
    throw new DelayedError();
  }
  if (campaignLink?.campaign.status === 'CANCELLED') { await blockMessage(message.id, 'CAMPAIGN_CANCELLED'); return; }
  if (message.account.status !== 'CONNECTED') { await blockMessage(message.id, `ACCOUNT_${message.account.status}`); return; }
  const policyBlock = await outboundBlockReason(message.workspaceId, 0);
  if (policyBlock) { await blockMessage(message.id, policyBlock); return; }
  const contact = message.conversation.contact;
  if (!contact) throw new Error('Message contact is unavailable.');
  const suppressionMatchers = [
    ...(contact.normalizedPhone ? [{ normalizedPhone: contact.normalizedPhone }] : []),
    ...(contact.platformUserId ? [{ platform: contact.platform, platformUserId: contact.platformUserId }] : []),
  ];
  const suppression = suppressionMatchers.length ? await prisma.suppressionEntry.findFirst({ where: { OR: [{ scope: 'GLOBAL' }, { scope: 'TENANT', workspaceId: message.workspaceId }], AND: [{ OR: suppressionMatchers }] }, select: { id: true } }) : null;
  const adapter = adapterFor(message.platform);
  const permissions = Array.isArray(message.account.permissions)
    ? message.account.permissions.filter((value): value is string => typeof value === 'string')
    : [];
  const declared = adapter.capabilities().MESSAGING;
  const capability = !adapter.isConfigured()
    ? 'NOT_CONFIGURED'
    : declared === 'PERMISSION_REQUIRED' && permissions.includes('MESSAGING')
      ? 'SUPPORTED'
      : declared;
  const metadata = typeof message.metadata === 'object' && message.metadata !== null ? message.metadata as Record<string, unknown> : {};
  const decision = evaluateMessageSafety({
    consentStatus: contact.consentStatus,
    suppressed: Boolean(suppression) || contact.suppressed || contact.status === 'DO_NOT_CONTACT',
    hasPermission: declared !== 'PERMISSION_REQUIRED' || permissions.includes('MESSAGING'),
    capability,
    withinRateLimit: true,
    promotional: metadata.promotional === true,
  });
  if (!decision.allowed) {
    await prisma.message.update({ where: { id: message.id }, data: { status: 'BLOCKED', errorCode: decision.code, metadata: { ...metadata, blockReason: decision.reason } } });
    await prisma.backgroundJob.updateMany({ where: { externalId: message.id }, data: { status: 'FAILED', error: { code: decision.code, message: decision.reason }, completedAt: new Date() } });
    await prisma.messageEvent.create({ data: { workspaceId: message.workspaceId, messageId: message.id, type: 'BLOCKED', payload: { code: decision.code, reason: decision.reason } } });
    await updateCampaignProgress(message.id, 'BLOCKED', decision.code);
    return;
  }

  if (!await accountRateAllowed(message.accountId)) {
    if (!job.token) throw new Error('ACCOUNT_RATE_LIMIT_EXCEEDED');
    await job.moveToDelayed(Date.now() + (60_000 - (Date.now() % 60_000)) + 250, job.token);
    throw new DelayedError();
  }

  await prisma.message.update({ where: { id: message.id }, data: { status: 'SENDING' } });
  await prisma.backgroundJob.updateMany({ where: { externalId: message.id }, data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date() } });
  const accessToken = await accessTokenFor(message.account);
  const result = await adapter.sendMessage(
    { workspaceId: message.workspaceId, accountId: message.accountId, accessToken },
    message.receiverId,
    message.content,
  );
  if (result.status !== 'SUCCESS' || !result.data) {
    throw new Error(`${result.errorCode ?? 'MESSAGE_SEND_FAILED'}: ${result.message ?? 'Platform send failed.'}`);
  }
  await prisma.$transaction([
    prisma.message.update({ where: { id: message.id }, data: { status: 'SENT', platformMessageId: result.data.platformMessageId, errorCode: null } }),
    prisma.messageEvent.create({ data: { workspaceId: message.workspaceId, messageId: message.id, type: 'SENT', payload: { platformMessageId: result.data.platformMessageId } } }),
    prisma.backgroundJob.updateMany({ where: { externalId: message.id }, data: { status: 'COMPLETED', result: { platformMessageId: result.data.platformMessageId }, completedAt: new Date() } }),
  ]);
  await updateCampaignProgress(message.id, 'SENT');
}

async function processCampaign(job: Job<{ campaignId: string }>): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id: job.data.campaignId }, include: { account: true, template: true, audience: { include: { contact: true } } } });
  if (!campaign || !campaign.account || !campaign.template || !['APPROVED', 'SCHEDULED', 'RUNNING'].includes(campaign.status)) return;
  if (job.id) await prisma.backgroundJob.updateMany({ where: { externalId: String(job.id) }, data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date() } });
  const policyBlock = await outboundBlockReason(campaign.workspaceId, campaign.audience.filter((member) => member.status === 'INCLUDED').length);
  if (policyBlock) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'PAUSED', statistics: { blockedReason: policyBlock } } });
    if (job.id) await prisma.backgroundJob.updateMany({ where: { externalId: String(job.id) }, data: { status: 'FAILED', error: { code: policyBlock, message: policyBlock }, completedAt: new Date() } });
    return;
  }
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } });
  let queued = 0;
  let blocked = 0;
  for (const member of campaign.audience) {
    if (member.status !== 'INCLUDED') {
      await prisma.campaignMessage.upsert({ where: { campaignId_contactId: { campaignId: campaign.id, contactId: member.contactId } }, update: { status: 'BLOCKED', errorCode: member.excludedReason ?? 'AUDIENCE_EXCLUDED' }, create: { campaignId: campaign.id, contactId: member.contactId, status: 'BLOCKED', errorCode: member.excludedReason ?? 'AUDIENCE_EXCLUDED' } });
      blocked += 1;
      continue;
    }
    const key = `campaign:${campaign.id}:contact:${member.contactId}`;
    const existing = await prisma.message.findUnique({ where: { idempotencyKey: key } });
    if (existing) continue;
    const contact = member.contact;
    const validPlatformRecipient = contact.platform === campaign.platform && Boolean(contact.platformUserId?.trim());
    const allowed = validPlatformRecipient && !contact.suppressed && contact.status !== 'DO_NOT_CONTACT' && (!campaign.promotional || contact.consentStatus === 'OPTED_IN');
    const blockedReason = !validPlatformRecipient ? 'INVALID_PLATFORM_RECIPIENT' : contact.suppressed || contact.status === 'DO_NOT_CONTACT' ? 'CONTACT_SUPPRESSED' : 'CONSENT_REQUIRED';
    const conversation = await prisma.conversation.upsert({ where: { accountId_platformConversationId: { accountId: campaign.account.id, platformConversationId: `contact:${contact.id}` } }, update: { lastMessageAt: new Date() }, create: { workspaceId: campaign.workspaceId, accountId: campaign.account.id, contactId: contact.id, platformConversationId: `contact:${contact.id}`, title: contact.displayName, lastMessageAt: new Date() } });
    const message = await prisma.message.create({ data: { workspaceId: campaign.workspaceId, conversationId: conversation.id, accountId: campaign.account.id, platform: campaign.platform, idempotencyKey: key, senderId: campaign.account.platformAccountId, receiverId: contact.platformUserId ?? `invalid:${contact.id}`, content: campaign.template.content.replaceAll('{{firstName}}', contact.displayName.split(/\s+/)[0] ?? contact.displayName), direction: 'OUTBOUND', status: allowed ? 'QUEUED' : 'BLOCKED', metadata: { promotional: campaign.promotional }, ...(!allowed ? { errorCode: blockedReason } : {}) } });
    await prisma.campaignMessage.create({ data: { campaignId: campaign.id, contactId: contact.id, messageId: message.id, status: message.status, errorCode: message.errorCode } });
    if (allowed) {
      await prisma.backgroundJob.create({ data: { workspaceId: campaign.workspaceId, queue: queues.messageSend, externalId: message.id, type: 'SEND_MESSAGE', payload: { messageId: message.id } } });
      await messageQueue.add('send', { messageId: message.id }, { jobId: message.id });
      queued += 1;
    } else blocked += 1;
  }
  const grouped = await prisma.campaignMessage.groupBy({ by: ['status'], where: { campaignId: campaign.id }, _count: { _all: true } });
  const counts = Object.fromEntries(grouped.map((item) => [item.status, item._count._all]));
  const pending = (counts.QUEUED ?? 0) + (counts.SENDING ?? 0);
  const status = pending > 0 ? 'RUNNING' : (counts.SENT ?? 0) + (counts.DELIVERED ?? 0) + (counts.READ ?? 0) > 0 ? 'COMPLETED' : 'FAILED';
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status, statistics: { queued: counts.QUEUED ?? queued, sent: (counts.SENT ?? 0) + (counts.DELIVERED ?? 0) + (counts.READ ?? 0), failed: counts.FAILED ?? 0, blocked: counts.BLOCKED ?? blocked } } });
  if (job.id) await prisma.backgroundJob.updateMany({ where: { externalId: String(job.id) }, data: { status: 'COMPLETED', result: { queued, blocked }, completedAt: new Date() } });
}

async function processPost(job: Job<{ postId: string }>): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: job.data.postId }, include: { account: true, media: { include: { mediaAsset: true } } } });
  if (!post || post.status === 'PUBLISHED') return;
  const adapter = adapterFor(post.platform);
  const result = await adapter.createPost({ workspaceId: post.workspaceId, accountId: post.accountId }, { content: post.content, media: post.media.map(({ mediaAsset }) => mediaAsset.objectKey) });
  if (result.status !== 'SUCCESS') throw new Error(`${result.errorCode ?? 'POST_PUBLISH_FAILED'}: ${result.message ?? 'Publish failed.'}`);
  await prisma.post.update({ where: { id: post.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
}

function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) throw new Error(`INVALID_PHONE:${phone}`);
  if (digits.startsWith('84')) return `+${digits}`;
  if (digits.startsWith('0')) return `+84${digits.slice(1)}`;
  return `+${digits}`;
}

async function processContactImport(job: Job<{ externalId: string }>): Promise<void> {
  const record = await prisma.backgroundJob.findUnique({ where: { externalId: job.data.externalId } });
  if (!record || record.status === 'COMPLETED') return;
  const payload = record.payload as { workspaceId: string; userId: string; contacts: ImportContact[] };
  const workspace = await prisma.workspace.findFirst({ where: { id: payload.workspaceId, deletedAt: null }, select: { status: true, suspendedAt: true, subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 } } });
  const subscription = workspace?.subscriptions[0];
  if (!workspace || workspace.status !== 'ACTIVE' || workspace.suspendedAt || !subscription || ['EXPIRED', 'SUSPENDED', 'CANCELLED'].includes(subscription.status) || subscription.endAt <= new Date()) throw new Error('SUBSCRIPTION_BLOCKED');
  const overrides = subscription.overrides && typeof subscription.overrides === 'object' && !Array.isArray(subscription.overrides) ? subscription.overrides as Record<string, unknown> : {};
  const contactLimit = typeof overrides.maxContacts === 'number' ? overrides.maxContacts : subscription.plan.maxContacts;
  const current = await prisma.contact.count({ where: { workspaceId: payload.workspaceId, deletedAt: null } });
  if (current + payload.contacts.length > contactLimit) throw new Error('CONTACT_QUOTA_EXCEEDED');
  await prisma.backgroundJob.update({ where: { id: record.id }, data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date() } });
  let created = 0; let updated = 0;
  const ids = await prisma.$transaction(async (tx) => {
    const imported: string[] = [];
    for (const input of payload.contacts) {
      const normalizedPhone = normalizePhone(input.phone);
      const existing = input.platformUserId ? await tx.contact.findUnique({ where: { workspaceId_platform_platformUserId: { workspaceId: payload.workspaceId, platform: input.platform, platformUserId: input.platformUserId } } }) : normalizedPhone ? await tx.contact.findFirst({ where: { workspaceId: payload.workspaceId, normalizedPhone, deletedAt: null } }) : null;
      const data = { platform: input.platform, ...(input.platformUserId ? { platformUserId: input.platformUserId } : {}), displayName: input.displayName, ...(input.username ? { username: input.username } : {}), ...(input.phone ? { phone: input.phone } : {}), ...(normalizedPhone ? { normalizedPhone } : {}), ...(input.email ? { email: input.email.toLowerCase() } : {}), source: input.source, consentStatus: input.consentStatus, suppressed: input.consentStatus === 'OPTED_OUT', status: input.consentStatus === 'OPTED_OUT' ? ('DO_NOT_CONTACT' as const) : ('ACTIVE' as const), deletedAt: null };
      const contact = existing ? await tx.contact.update({ where: { id: existing.id }, data }) : await tx.contact.create({ data: { workspaceId: payload.workspaceId, ...data } });
      if (!existing || existing.consentStatus !== input.consentStatus) await tx.contactConsent.create({ data: { contactId: contact.id, status: input.consentStatus, source: input.consentSource ?? input.source, consentAt: input.consentStatus === 'OPTED_IN' ? new Date() : null, optOutAt: input.consentStatus === 'OPTED_OUT' ? new Date() : null } });
      if (existing) updated += 1; else created += 1;
      imported.push(contact.id);
    }
    return imported;
  }, { timeout: 60_000 });
  await prisma.$transaction([
    prisma.backgroundJob.update({ where: { id: record.id }, data: { status: 'COMPLETED', result: { created, updated, total: ids.length, rollbackReference: ids }, completedAt: new Date() } }),
    prisma.auditLog.create({ data: { workspaceId: payload.workspaceId, userId: payload.userId, action: 'CONTACT_IMPORTED', resource: 'BackgroundJob', resourceId: record.id, result: 'SUCCESS', metadata: { created, updated, total: ids.length } } }),
  ]);
}

async function processStagedContactImport(job: Job<ContactImportJob & { importJobId: string }>): Promise<void> {
  const [importJob, background] = await Promise.all([
    prisma.importJob.findUnique({ where: { id: job.data.importJobId } }),
    prisma.backgroundJob.findUnique({ where: { externalId: job.data.externalId } }),
  ]);
  if (!importJob || !background || ['COMPLETED', 'PARTIAL'].includes(importJob.status)) return;
  const workspace = await prisma.workspace.findFirst({ where: { id: importJob.workspaceId, deletedAt: null }, select: { status: true, suspendedAt: true, subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 } } });
  const subscription = workspace?.subscriptions[0];
  if (!workspace || workspace.status !== 'ACTIVE' || workspace.suspendedAt || !subscription || ['EXPIRED', 'SUSPENDED', 'CANCELLED'].includes(subscription.status) || subscription.endAt <= new Date()) throw new Error('SUBSCRIPTION_BLOCKED');
  const overrides = subscription.overrides && typeof subscription.overrides === 'object' && !Array.isArray(subscription.overrides) ? subscription.overrides as Record<string, unknown> : {};
  const contactLimit = typeof overrides.maxContacts === 'number' ? overrides.maxContacts : subscription.plan.maxContacts;
  const current = await prisma.contact.count({ where: { workspaceId: importJob.workspaceId, deletedAt: null } });
  if (current + importJob.validRows > contactLimit) throw new Error('CONTACT_QUOTA_EXCEEDED');

  await prisma.$transaction([
    prisma.importJob.update({ where: { id: importJob.id }, data: { status: 'PROCESSING', progress: 0, startedAt: new Date(), importedRows: 0, failedRows: 0 } }),
    prisma.backgroundJob.update({ where: { id: background.id }, data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date() } }),
  ]);
  let lastRow = 0;
  let imported = 0;
  let failed = 0;
  let raceSkipped = 0;
  while (true) {
    const rows = await prisma.importRow.findMany({ where: { importJobId: importJob.id, status: 'VALID', rowNumber: { gt: lastRow } }, orderBy: { rowNumber: 'asc' }, take: 500 });
    if (!rows.length) break;
    for (const row of rows) {
      lastRow = row.rowNumber;
      try {
        const input = row.normalized as StagedImportContact;
        const matchers = [
          ...(input.platformUserId ? [{ platform: input.platform, platformUserId: input.platformUserId }] : []),
          ...(input.normalizedPhone ? [{ normalizedPhone: input.normalizedPhone }] : []),
        ];
        const existing = matchers.length
          ? await prisma.contact.findFirst({ where: { workspaceId: importJob.workspaceId, deletedAt: null, OR: matchers } })
          : null;
        if (existing) {
          await prisma.importRow.update({ where: { id: row.id }, data: { status: 'SKIPPED', errors: ['Bản ghi xuất hiện trong danh bạ sau bước preview.'], contactId: existing.id } });
          raceSkipped += 1;
          continue;
        }
        const contact = await prisma.$transaction(async (tx) => {
          const created = await tx.contact.create({ data: { workspaceId: importJob.workspaceId, platform: input.platform, ...(input.platformUserId ? { platformUserId: input.platformUserId } : {}), displayName: input.displayName, ...(input.username ? { username: input.username } : {}), ...(input.phone ? { phone: input.phone } : {}), ...(input.normalizedPhone ? { normalizedPhone: input.normalizedPhone } : {}), ...(input.email ? { email: input.email } : {}), ...(input.gender ? { gender: input.gender } : {}), source: input.source, consentStatus: input.consentStatus, suppressed: input.consentStatus === 'OPTED_OUT', status: input.consentStatus === 'OPTED_OUT' ? 'DO_NOT_CONTACT' : 'ACTIVE' } });
          await tx.contactConsent.create({ data: { contactId: created.id, status: input.consentStatus, source: input.source, consentAt: input.consentStatus === 'OPTED_IN' ? new Date() : null, optOutAt: input.consentStatus === 'OPTED_OUT' ? new Date() : null, proof: { importJobId: importJob.id, rowNumber: row.rowNumber } } });
          await tx.importRow.update({ where: { id: row.id }, data: { status: 'IMPORTED', contactId: created.id } });
          return created;
        });
        if (contact.id) imported += 1;
      } catch (error) {
        failed += 1;
        await prisma.importRow.update({ where: { id: row.id }, data: { status: 'FAILED', errors: [error instanceof Error ? error.message : 'Không thể import dòng dữ liệu.'] } });
      }
    }
    const processed = imported + failed + raceSkipped;
    await prisma.importJob.update({ where: { id: importJob.id }, data: { importedRows: imported, failedRows: failed, skippedRows: importJob.skippedRows + raceSkipped, progress: Math.min(99, Math.round(processed / Math.max(1, importJob.validRows) * 100)) } });
  }
  const status = failed ? 'PARTIAL' : 'COMPLETED';
  await prisma.$transaction([
    prisma.importJob.update({ where: { id: importJob.id }, data: { status, importedRows: imported, failedRows: failed, skippedRows: importJob.skippedRows + raceSkipped, progress: 100, completedAt: new Date() } }),
    prisma.backgroundJob.update({ where: { id: background.id }, data: { status: 'COMPLETED', result: { importJobId: importJob.id, imported, failed, skipped: raceSkipped, invalid: importJob.invalidRows, duplicate: importJob.duplicateRows }, completedAt: new Date() } }),
    prisma.auditLog.create({ data: { workspaceId: importJob.workspaceId, userId: importJob.uploadedById, action: 'DATA_IMPORTED', resource: 'ImportJob', resourceId: importJob.id, result: failed ? 'PARTIAL' : 'SUCCESS', metadata: { imported, failed, skipped: raceSkipped, invalid: importJob.invalidRows, duplicate: importJob.duplicateRows } } }),
  ]);
}

async function routeContactImport(job: Job<ContactImportJob>): Promise<void> {
  if ('importJobId' in job.data && job.data.importJobId) return processStagedContactImport(job as Job<ContactImportJob & { importJobId: string }>);
  return processContactImport(job as Job<{ externalId: string }>);
}

async function processZaloWebhook(job: Job<{ eventId: string; accountId: string }>): Promise<void> {
  const [event, account] = await Promise.all([
    prisma.webhookEvent.findUnique({ where: { id: job.data.eventId } }),
    prisma.socialAccount.findFirst({ where: { id: job.data.accountId, platform: 'ZALO', deletedAt: null } }),
  ]);
  if (!event || !account || event.status === 'COMPLETED') return;
  if (job.id) await prisma.backgroundJob.updateMany({ where: { externalId: String(job.id) }, data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date() } });
  await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'RUNNING', attempts: { increment: 1 }, lastAttemptAt: new Date() } });
  const payload = event.payload as ZaloWebhook;
  const eventName = payload.event_name ?? event.eventType;
  const inbound = eventName.startsWith('user_');
  const userId = String((inbound ? payload.sender?.id : payload.recipient?.id) ?? '');
  if (!userId) throw new Error('ZALO_WEBHOOK_USER_MISSING');
  const displayName = (inbound ? payload.sender?.display_name : payload.recipient?.display_name)?.trim();
  const contact = await prisma.contact.upsert({
    where: { workspaceId_platform_platformUserId: { workspaceId: account.workspaceId, platform: 'ZALO', platformUserId: userId } },
    update: { lastInteractionAt: new Date(), ...(displayName ? { displayName } : {}) },
    create: { workspaceId: account.workspaceId, platform: 'ZALO', platformUserId: userId, displayName: displayName || `Zalo ${userId.slice(-6)}`, source: 'ZALO_WEBHOOK', consentStatus: 'UNKNOWN', lastInteractionAt: new Date() },
  });
  if (['user_unfollow', 'user_withdraw'].includes(eventName)) {
    const existingSuppression = await prisma.suppressionEntry.findFirst({ where: { workspaceId: account.workspaceId, platform: 'ZALO', platformUserId: userId } });
    await prisma.$transaction([
      prisma.contact.update({ where: { id: contact.id }, data: { consentStatus: 'OPTED_OUT', suppressed: true, status: 'DO_NOT_CONTACT' } }),
      prisma.contactConsent.create({ data: { contactId: contact.id, status: 'OPTED_OUT', source: `ZALO_WEBHOOK:${eventName}`, optOutAt: new Date(), proof: { webhookEventId: event.id } } }),
      ...(existingSuppression ? [] : [prisma.suppressionEntry.create({ data: { workspaceId: account.workspaceId, scope: 'TENANT', platform: 'ZALO', platformUserId: userId, reason: eventName === 'user_withdraw' ? 'Zalo data-subject withdrawal' : 'User unfollowed Zalo OA', source: 'ZALO_WEBHOOK' } })]),
    ]);
  }
  if (eventName.includes('_send_')) {
    const platformMessageId = String(payload.message?.msg_id ?? `${eventName}:${payload.timestamp ?? Date.now()}`);
    const existing = await prisma.message.findFirst({ where: { accountId: account.id, platformMessageId } });
    if (existing) {
      await prisma.message.update({ where: { id: existing.id }, data: { status: inbound ? 'DELIVERED' : 'SENT', timestamp: new Date(Number(payload.timestamp ?? Date.now())) } });
    } else {
      const conversation = await prisma.conversation.upsert({
        where: { accountId_platformConversationId: { accountId: account.id, platformConversationId: `zalo:${userId}` } },
        update: { contactId: contact.id, lastMessageAt: new Date(), title: contact.displayName },
        create: { workspaceId: account.workspaceId, accountId: account.id, contactId: contact.id, platformConversationId: `zalo:${userId}`, title: contact.displayName, lastMessageAt: new Date() },
      });
      const message = await prisma.message.create({ data: { workspaceId: account.workspaceId, conversationId: conversation.id, accountId: account.id, platform: 'ZALO', platformMessageId, idempotencyKey: `zalo-webhook:${account.id}:${platformMessageId}`, senderId: inbound ? userId : account.platformAccountId, receiverId: inbound ? account.platformAccountId : userId, content: payload.message?.text ?? `[${eventName}]`, messageType: eventName.replace(/^(user|oa)_send_/, '').toUpperCase(), direction: inbound ? 'INBOUND' : 'OUTBOUND', status: inbound ? 'DELIVERED' : 'SENT', timestamp: new Date(Number(payload.timestamp ?? Date.now())), metadata: { webhookEventId: event.id, attachments: payload.message?.attachments ?? [] } } });
      await prisma.messageEvent.create({ data: { workspaceId: account.workspaceId, messageId: message.id, type: inbound ? 'RECEIVED' : 'SENT', payload: { webhookEventId: event.id } } });
      if (inbound) await prisma.notification.create({ data: { workspaceId: account.workspaceId, event: 'ZALO_MESSAGE_RECEIVED', title: `Tin nhắn mới từ ${contact.displayName}`, body: payload.message?.text ?? `Đã nhận sự kiện ${eventName}.`, metadata: { conversationId: conversation.id, messageId: message.id } } });
    }
  }
  await prisma.$transaction([
    prisma.socialAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date(), lastErrorCode: null } }),
    prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'COMPLETED' } }),
    prisma.backgroundJob.updateMany({ where: { externalId: String(job.id) }, data: { status: 'COMPLETED', result: { eventName }, completedAt: new Date() } }),
  ]);
}

const messageWorker = new Worker(queues.messageSend, processMessage, { connection, concurrency: Number(process.env.MESSAGE_WORKER_CONCURRENCY ?? 10), limiter: { max: Number(process.env.MESSAGE_WORKER_RATE_MAX ?? 30), duration: 60_000 } });
const automationWorker = new Worker(queues.automationExecute, processCampaign, { connection, concurrency: 2 });
const postWorker = new Worker(queues.postPublish, processPost, { connection, concurrency: 3 });
const contactImportWorker = new Worker<ContactImportJob>(queues.contactImport, routeContactImport, { connection, concurrency: 2 });
const webhookWorker = new Worker(queues.webhookProcess, processZaloWebhook, { connection, concurrency: 5 });

for (const worker of [messageWorker, automationWorker, postWorker, contactImportWorker, webhookWorker]) {
  worker.on('error', (error) => { healthy = false; console.error(JSON.stringify({ level: 'error', service: 'worker', message: error.message, timestamp: new Date().toISOString() })); });
  worker.on('completed', () => { healthy = true; });
  worker.on('failed', async (job, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    await deadLetterQueue.add('terminal-failure', { sourceQueue: worker.name, sourceJobId: String(job.id), jobName: job.name, data: job.data, attemptsMade: job.attemptsMade, error: error.message, failedAt: new Date().toISOString() });
  });
}
messageWorker.on('failed', async (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  await prisma.message.updateMany({ where: { id: job.data.messageId, status: { in: ['QUEUED', 'SENDING'] } }, data: { status: 'FAILED', errorCode: 'MESSAGE_SEND_FAILED', metadata: { workerError: error.message } } });
  await prisma.backgroundJob.updateMany({ where: { externalId: job.data.messageId }, data: { status: 'FAILED', error: { message: error.message }, completedAt: new Date() } });
  const message = await prisma.message.findUnique({ where: { id: job.data.messageId }, select: { workspaceId: true } });
  if (message) await prisma.messageEvent.create({ data: { workspaceId: message.workspaceId, messageId: job.data.messageId, type: 'FAILED', payload: { message: error.message } } });
  await updateCampaignProgress(job.data.messageId, 'FAILED', 'MESSAGE_SEND_FAILED');
});
postWorker.on('failed', async (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  await prisma.post.updateMany({ where: { id: job.data.postId, status: { not: 'PUBLISHED' } }, data: { status: 'FAILED', rejectionNote: error.message } });
  await prisma.backgroundJob.updateMany({ where: { externalId: { in: [`publish-post-${job.data.postId}`, `schedule-post-${job.data.postId}`] } }, data: { status: 'FAILED', error: { message: error.message }, completedAt: new Date() } });
});
contactImportWorker.on('failed', async (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  await prisma.backgroundJob.updateMany({ where: { externalId: job.data.externalId }, data: { status: 'FAILED', error: { message: error.message }, completedAt: new Date() } });
  if ('importJobId' in job.data && job.data.importJobId) await prisma.importJob.updateMany({ where: { id: job.data.importJobId, status: { in: ['QUEUED', 'PROCESSING'] } }, data: { status: 'FAILED', errorSummary: { message: error.message }, completedAt: new Date() } });
});
webhookWorker.on('failed', async (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  await prisma.webhookEvent.updateMany({ where: { id: job.data.eventId }, data: { status: 'FAILED' } });
  await prisma.backgroundJob.updateMany({ where: { externalId: String(job.id) }, data: { status: 'FAILED', error: { message: error.message }, completedAt: new Date() } });
});

const healthServer = createServer((_request, response) => {
  response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', service: 'omnisocial-worker' }));
});
healthServer.listen(
  Number(process.env.WORKER_HEALTH_PORT ?? 4101),
  process.env.AUX_HEALTH_HOST ?? '0.0.0.0',
);

async function shutdown(): Promise<void> {
  await Promise.all([messageWorker.close(), automationWorker.close(), postWorker.close(), contactImportWorker.close(), webhookWorker.close(), messageQueue.close(), deadLetterQueue.close()]);
  await rateRedis.quit();
  await prisma.$disconnect();
  healthServer.close();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
