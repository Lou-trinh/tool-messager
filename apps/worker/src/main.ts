import 'dotenv/config';
import { createServer } from 'node:http';
import { Queue, Worker, type Job } from 'bullmq';
import { PrismaClient } from '@omni/database';
import type { PlatformAdapter } from '@omni/platform-core';
import { FacebookAdapter } from '@omni/platform-facebook';
import { TikTokAdapter } from '@omni/platform-tiktok';
import { ZaloAdapter } from '@omni/platform-zalo';
import { queues, redisConnectionFromUrl, resilientJobOptions } from '@omni/queue';
import { evaluateMessageSafety, type Platform } from '@omni/shared';

const prisma = new PrismaClient();
const connection = redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
const messageQueue = new Queue(queues.messageSend, { connection, defaultJobOptions: resilientJobOptions });
const adapters = new Map<Platform, PlatformAdapter>([
  ['ZALO', new ZaloAdapter()],
  ['FACEBOOK', new FacebookAdapter()],
  ['TIKTOK', new TikTokAdapter()],
]);
let healthy = true;

function adapterFor(platform: Platform): PlatformAdapter {
  const adapter = adapters.get(platform);
  if (!adapter) throw new Error(`No adapter for ${platform}`);
  return adapter;
}

async function processMessage(job: Job<{ messageId: string }>): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: job.data.messageId },
    include: { account: true, conversation: { include: { contact: true } } },
  });
  if (!message || ['SENT', 'DELIVERED', 'READ', 'BLOCKED'].includes(message.status)) return;
  const contact = message.conversation.contact;
  if (!contact) throw new Error('Message contact is unavailable.');
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
    suppressed: contact.suppressed || contact.status === 'DO_NOT_CONTACT',
    hasPermission: declared !== 'PERMISSION_REQUIRED' || permissions.includes('MESSAGING'),
    capability,
    withinRateLimit: true,
    promotional: metadata.promotional === true,
  });
  if (!decision.allowed) {
    await prisma.message.update({ where: { id: message.id }, data: { status: 'BLOCKED', errorCode: decision.code, metadata: { ...metadata, blockReason: decision.reason } } });
    await prisma.backgroundJob.updateMany({ where: { externalId: message.id }, data: { status: 'FAILED', error: { code: decision.code, message: decision.reason }, completedAt: new Date() } });
    return;
  }

  await prisma.message.update({ where: { id: message.id }, data: { status: 'SENDING' } });
  await prisma.backgroundJob.updateMany({ where: { externalId: message.id }, data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date() } });
  const result = await adapter.sendMessage(
    { workspaceId: message.workspaceId, accountId: message.accountId },
    message.receiverId,
    message.content,
  );
  if (result.status !== 'SUCCESS' || !result.data) {
    throw new Error(`${result.errorCode ?? 'MESSAGE_SEND_FAILED'}: ${result.message ?? 'Platform send failed.'}`);
  }
  await prisma.$transaction([
    prisma.message.update({ where: { id: message.id }, data: { status: 'SENT', platformMessageId: result.data.platformMessageId, errorCode: null } }),
    prisma.backgroundJob.updateMany({ where: { externalId: message.id }, data: { status: 'COMPLETED', result: { platformMessageId: result.data.platformMessageId }, completedAt: new Date() } }),
  ]);
}

async function processCampaign(job: Job<{ campaignId: string }>): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id: job.data.campaignId }, include: { account: true, template: true, audience: { include: { contact: true } } } });
  if (!campaign || !campaign.account || !campaign.template || !['APPROVED', 'SCHEDULED', 'PAUSED', 'RUNNING'].includes(campaign.status)) return;
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } });
  let queued = 0;
  let blocked = 0;
  for (const member of campaign.audience) {
    const key = `campaign:${campaign.id}:contact:${member.contactId}`;
    const existing = await prisma.message.findUnique({ where: { idempotencyKey: key } });
    if (existing) continue;
    const contact = member.contact;
    const allowed = !contact.suppressed && contact.status !== 'DO_NOT_CONTACT' && (!campaign.promotional || contact.consentStatus === 'OPTED_IN');
    const conversation = await prisma.conversation.upsert({ where: { accountId_platformConversationId: { accountId: campaign.account.id, platformConversationId: `contact:${contact.id}` } }, update: { lastMessageAt: new Date() }, create: { workspaceId: campaign.workspaceId, accountId: campaign.account.id, contactId: contact.id, platformConversationId: `contact:${contact.id}`, title: contact.displayName, lastMessageAt: new Date() } });
    const message = await prisma.message.create({ data: { workspaceId: campaign.workspaceId, conversationId: conversation.id, accountId: campaign.account.id, platform: campaign.platform, idempotencyKey: key, senderId: campaign.account.platformAccountId, receiverId: contact.platformUserId ?? contact.id, content: campaign.template.content.replaceAll('{{firstName}}', contact.displayName.split(/\s+/)[0] ?? contact.displayName), direction: 'OUTBOUND', status: allowed ? 'QUEUED' : 'BLOCKED', metadata: { promotional: campaign.promotional }, ...(!allowed ? { errorCode: contact.suppressed ? 'CONTACT_SUPPRESSED' : 'CONSENT_REQUIRED' } : {}) } });
    await prisma.campaignMessage.create({ data: { campaignId: campaign.id, contactId: contact.id, messageId: message.id, status: message.status, errorCode: message.errorCode } });
    if (allowed) {
      await prisma.backgroundJob.create({ data: { workspaceId: campaign.workspaceId, queue: queues.messageSend, externalId: message.id, type: 'SEND_MESSAGE', payload: { messageId: message.id } } });
      await messageQueue.add('send', { messageId: message.id }, { jobId: message.id });
      queued += 1;
    } else blocked += 1;
  }
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: queued > 0 ? 'RUNNING' : 'FAILED', statistics: { queued, sent: 0, failed: 0, blocked } } });
}

async function processPost(job: Job<{ postId: string }>): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: job.data.postId }, include: { account: true, media: { include: { mediaAsset: true } } } });
  if (!post || post.status === 'PUBLISHED') return;
  const adapter = adapterFor(post.platform);
  const result = await adapter.createPost({ workspaceId: post.workspaceId, accountId: post.accountId }, { content: post.content, media: post.media.map(({ mediaAsset }) => mediaAsset.objectKey) });
  if (result.status !== 'SUCCESS') throw new Error(`${result.errorCode ?? 'POST_PUBLISH_FAILED'}: ${result.message ?? 'Publish failed.'}`);
  await prisma.post.update({ where: { id: post.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
}

const messageWorker = new Worker(queues.messageSend, processMessage, { connection, concurrency: Number(process.env.MESSAGE_WORKER_CONCURRENCY ?? 10), limiter: { max: Number(process.env.MESSAGE_WORKER_RATE_MAX ?? 30), duration: 60_000 } });
const automationWorker = new Worker(queues.automationExecute, processCampaign, { connection, concurrency: 2 });
const postWorker = new Worker(queues.postPublish, processPost, { connection, concurrency: 3 });

for (const worker of [messageWorker, automationWorker, postWorker]) {
  worker.on('error', (error) => { healthy = false; console.error(JSON.stringify({ level: 'error', service: 'worker', message: error.message, timestamp: new Date().toISOString() })); });
  worker.on('completed', () => { healthy = true; });
}
messageWorker.on('failed', async (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  await prisma.message.updateMany({ where: { id: job.data.messageId, status: { in: ['QUEUED', 'SENDING'] } }, data: { status: 'FAILED', errorCode: 'MESSAGE_SEND_FAILED', metadata: { workerError: error.message } } });
  await prisma.backgroundJob.updateMany({ where: { externalId: job.data.messageId }, data: { status: 'FAILED', error: { message: error.message }, completedAt: new Date() } });
});
postWorker.on('failed', async (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  await prisma.post.updateMany({ where: { id: job.data.postId, status: { not: 'PUBLISHED' } }, data: { status: 'FAILED', rejectionNote: error.message } });
  await prisma.backgroundJob.updateMany({ where: { externalId: { in: [`publish-post-${job.data.postId}`, `schedule-post-${job.data.postId}`] } }, data: { status: 'FAILED', error: { message: error.message }, completedAt: new Date() } });
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
  await Promise.all([messageWorker.close(), automationWorker.close(), postWorker.close(), messageQueue.close()]);
  await prisma.$disconnect();
  healthServer.close();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
