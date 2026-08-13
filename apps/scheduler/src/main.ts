import 'dotenv/config';
import { createServer } from 'node:http';
import { Queue } from 'bullmq';
import { PrismaClient } from '@omni/database';
import { queues, redisConnectionFromUrl, resilientJobOptions } from '@omni/queue';
import { subscriptionNotificationKey, subscriptionWarningDays, subscriptionWarningThreshold } from '@omni/shared';

const prisma = new PrismaClient();
const connection = redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
const campaignQueue = new Queue(queues.automationExecute, { connection, defaultJobOptions: resilientJobOptions });
const postQueue = new Queue(queues.postPublish, { connection, defaultJobOptions: resilientJobOptions });
let healthy = true;
let running = false;
let lastMaintenanceAt = 0;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const control = await prisma.systemControl.findUnique({ where: { id: 'global' } });
    const now = new Date();
    const warningDate = new Date(now.getTime() + subscriptionWarningDays[0] * 86_400_000);
    const [campaigns, posts, expiredSubscriptions, expiringSubscriptions] = await Promise.all([
      prisma.campaign.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now }, deletedAt: null }, select: { id: true, workspaceId: true } }),
      prisma.post.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now }, deletedAt: null }, select: { id: true, workspaceId: true } }),
      prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'EXPIRING'] }, endAt: { lte: now } }, select: { id: true, workspaceId: true, endAt: true } }),
      prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'EXPIRING'] }, endAt: { gt: now, lte: warningDate } }, select: { id: true, workspaceId: true, endAt: true } }),
    ]);
    for (const subscription of expiredSubscriptions) {
      const changed = await prisma.subscription.updateMany({ where: { id: subscription.id, status: { in: ['ACTIVE', 'EXPIRING'] } }, data: { status: 'EXPIRED' } });
      if (changed.count) {
        await prisma.campaign.updateMany({ where: { workspaceId: subscription.workspaceId, status: { in: ['RUNNING', 'SCHEDULED'] } }, data: { status: 'PAUSED' } });
        await prisma.notification.upsert({
          where: { dedupeKey: subscriptionNotificationKey(subscription.id, subscription.endAt, 'expired') },
          update: {},
          create: { dedupeKey: subscriptionNotificationKey(subscription.id, subscription.endAt, 'expired'), workspaceId: subscription.workspaceId, event: 'SUBSCRIPTION_EXPIRED', title: 'Gói thuê đã hết hạn', body: 'Outbound campaign, gửi tin và xuất bản đã bị tạm khóa.', metadata: { subscriptionId: subscription.id, endAt: subscription.endAt.toISOString() } },
        });
      }
    }
    for (const subscription of expiringSubscriptions) {
      await prisma.subscription.updateMany({ where: { id: subscription.id, status: 'ACTIVE' }, data: { status: 'EXPIRING' } });
      const warningDay = subscriptionWarningThreshold(subscription.endAt, now);
      if (warningDay) {
        const dedupeKey = subscriptionNotificationKey(subscription.id, subscription.endAt, `warning-${warningDay}`);
        await prisma.notification.upsert({
          where: { dedupeKey },
          update: {},
          create: { dedupeKey, workspaceId: subscription.workspaceId, event: 'SUBSCRIPTION_EXPIRING', title: `Gói thuê còn ${warningDay} ngày`, body: `Tài khoản sẽ hết hạn sau ${warningDay} ngày. Vui lòng liên hệ quản trị viên để gia hạn.`, metadata: { subscriptionId: subscription.id, endAt: subscription.endAt.toISOString(), daysRemaining: warningDay } },
        });
      }
    }
    if (!control?.outboundPaused) {
      for (const campaign of campaigns) {
        const externalId = `schedule-campaign-${campaign.id}`;
        await prisma.backgroundJob.upsert({ where: { externalId }, update: {}, create: { workspaceId: campaign.workspaceId, queue: queues.automationExecute, externalId, type: 'CAMPAIGN_START', payload: { campaignId: campaign.id } } });
        await campaignQueue.add('campaign-start', { campaignId: campaign.id }, { jobId: externalId });
      }
      for (const post of posts) {
        const externalId = `schedule-post-${post.id}`;
        await prisma.backgroundJob.upsert({ where: { externalId }, update: {}, create: { workspaceId: post.workspaceId, queue: queues.postPublish, externalId, type: 'POST_PUBLISH', payload: { postId: post.id } } });
        await postQueue.add('post-publish', { postId: post.id }, { jobId: externalId });
      }
    }
    if (Date.now() - lastMaintenanceAt >= Number(process.env.MAINTENANCE_INTERVAL_MS ?? 21_600_000)) {
      const day = 86_400_000;
      const [jobs, webhooks, imports, notifications, oauthStates] = await prisma.$transaction([
        prisma.backgroundJob.deleteMany({ where: { status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] }, completedAt: { lt: new Date(Date.now() - Number(process.env.JOB_RETENTION_DAYS ?? 30) * day) } } }),
        prisma.webhookEvent.deleteMany({ where: { status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] }, createdAt: { lt: new Date(Date.now() - Number(process.env.WEBHOOK_RETENTION_DAYS ?? 30) * day) } } }),
        prisma.importJob.deleteMany({ where: { status: { in: ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'] }, createdAt: { lt: new Date(Date.now() - Number(process.env.IMPORT_RETENTION_DAYS ?? 90) * day) } } }),
        prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 180) * day) } } }),
        prisma.platformOAuthState.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - day) } } }),
      ]);
      console.info(JSON.stringify({ level: 'info', service: 'scheduler', message: 'Retention maintenance completed', removed: { jobs: jobs.count, webhooks: webhooks.count, imports: imports.count, notifications: notifications.count, oauthStates: oauthStates.count }, timestamp: new Date().toISOString() }));
      lastMaintenanceAt = Date.now();
    }
    healthy = true;
  } catch (error: unknown) {
    healthy = false;
    console.error(JSON.stringify({ level: 'error', service: 'scheduler', message: error instanceof Error ? error.message : 'Unknown scheduler error', timestamp: new Date().toISOString() }));
  } finally {
    running = false;
  }
}

const interval = setInterval(() => void tick(), Number(process.env.SCHEDULER_INTERVAL_MS ?? 30_000));
void tick();

const healthServer = createServer((_request, response) => {
  response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', service: 'omnisocial-scheduler' }));
});
healthServer.listen(
  Number(process.env.SCHEDULER_HEALTH_PORT ?? 4102),
  process.env.AUX_HEALTH_HOST ?? '0.0.0.0',
);

async function shutdown(): Promise<void> {
  clearInterval(interval);
  await Promise.all([campaignQueue.close(), postQueue.close()]);
  await prisma.$disconnect();
  healthServer.close();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
