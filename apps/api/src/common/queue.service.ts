import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { redisConnectionFromUrl, resilientJobOptions } from '@omni/queue';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly instances = new Map<string, Queue>();

  private queue(name: string): Queue {
    const existing = this.instances.get(name);
    if (existing) return existing;
    const created = new Queue(name, {
      connection: redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
      defaultJobOptions: resilientJobOptions,
    });
    this.instances.set(name, created);
    return created;
  }

  async add<T extends object>(queueName: string, jobName: string, data: T, jobId: string): Promise<void> {
    await this.queue(queueName).add(jobName, data, { jobId });
  }

  async counts(queueName: string): Promise<Record<string, number>> {
    return this.queue(queueName).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.instances.values()].map((queue) => queue.close()));
  }
}
