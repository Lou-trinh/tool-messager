import 'dotenv/config';
import { createServer } from 'node:http';
import { Queue } from 'bullmq';
import { PrismaClient } from '@omni/database';
import { queues, redisConnectionFromUrl, resilientJobOptions } from '@omni/queue';

const prisma = new PrismaClient();
const connection = redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
const campaignQueue = new Queue(queues.automationExecute, { connection, defaultJobOptions: resilientJobOptions });
const postQueue = new Queue(queues.postPublish, { connection, defaultJobOptions: resilientJobOptions });
let healthy = true;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const control = await prisma.systemControl.findUnique({ where: { id: 'global' } });
    if (control?.outboundPaused) { healthy = true; return; }
    const now = new Date();
    const warningDate = new Date(now.getTime() + 7 * 86_400_000);
    const [campaigns, posts, expiredSubscriptions, expiringSubscriptions] = await Promise.all([
      prisma.campaign.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now }, deletedAt: null }, select: { id: true, workspaceId: true } }),
      prisma.post.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now }, deletedAt: null }, select: { id: true, workspaceId: true } }),
      prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'EXPIRING'] }, endAt: { lte: now } }, select: { id: true, workspaceId: true, endAt: true } }),
      prisma.subscription.findMany({ where: { status: 'ACTIVE', endAt: { gt: now, lte: warningDate } }, select: { id: true, workspaceId: true, endAt: true } }),
    ]);
    for (const subscription of expiredSubscriptions) {
      const changed = await prisma.subscription.updateMany({ where: { id: subscription.id, status: { in: ['ACTIVE', 'EXPIRING'] } }, data: { status: 'EXPIRED' } });
      if (changed.count) {
        await prisma.campaign.updateMany({ where: { workspaceId: subscription.workspaceId, status: { in: ['RUNNING', 'SCHEDULED'] } }, data: { status: 'PAUSED' } });
        await prisma.notification.create({ data: { workspaceId: subscription.workspaceId, event: 'SUBSCRIPTION_EXPIRED', title: 'Gói thuê đã hết hạn', body: 'Outbound campaign, gửi tin và xuất bản đã bị tạm khóa.', metadata: { subscriptionId: subscription.id, endAt: subscription.endAt.toISOString() } } });
      }
    }
    for (const subscription of expiringSubscriptions) {
      const changed = await prisma.subscription.updateMany({ where: { id: subscription.id, status: 'ACTIVE' }, data: { status: 'EXPIRING' } });
      if (changed.count) await prisma.notification.create({ data: { workspaceId: subscription.workspaceId, event: 'SUBSCRIPTION_EXPIRING', title: 'Gói thuê sắp hết hạn', body: `Gói thuê sẽ hết hạn vào ${subscription.endAt.toISOString()}.`, metadata: { subscriptionId: subscription.id } } });
    }
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
