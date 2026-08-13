import type { JobsOptions } from 'bullmq';

export const queues = {
  messageSend: 'message.send',
  messageRetry: 'message.retry',
  postPublish: 'post.publish',
  contactSync: 'contact.sync',
  groupSync: 'group.sync',
  accountSync: 'account.sync',
  contactImport: 'contact.import',
  campaignExecute: 'campaign.execute',
  notificationSend: 'notification.send',
  webhookProcess: 'webhook.process',
  analyticsSync: 'analytics.sync',
  mediaProcess: 'media.process',
  automationExecute: 'automation.execute',
  deadLetter: 'dead-letter',
} as const;

export const resilientJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: { age: 604_800, count: 25_000 },
};

export function redisConnectionFromUrl(redisUrl: string): {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
} {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    maxRetriesPerRequest: null,
  };
}
