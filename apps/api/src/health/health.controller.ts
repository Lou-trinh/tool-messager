import { Controller, Get, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { queues } from '@omni/queue';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly queue: QueueService) {}

  @Get('health')
  health(): unknown { return { status: 'ok', service: 'omnisocial-api', timestamp: new Date().toISOString() }; }

  @Get('ready')
  async ready(): Promise<unknown> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.queue.counts(queues.messageSend);
      return { status: 'ready', database: 'ok', redis: 'ok' };
    } catch {
      throw new ServiceUnavailableException('A required dependency is unavailable.');
    }
  }

  @Get('metrics')
  async metrics(@Res() response: Response): Promise<void> {
    const counts = await this.queue.counts(queues.messageSend);
    const lines = [
      '# HELP omnisocial_queue_jobs Number of jobs by state',
      '# TYPE omnisocial_queue_jobs gauge',
      ...Object.entries(counts).map(([state, value]) => `omnisocial_queue_jobs{queue="${queues.messageSend}",state="${state}"} ${value}`),
      '# HELP omnisocial_process_uptime_seconds Process uptime',
      '# TYPE omnisocial_process_uptime_seconds counter',
      `omnisocial_process_uptime_seconds ${Math.floor(process.uptime())}`,
    ];
    response.type('text/plain; version=0.0.4').send(lines.join('\n'));
  }
}
