import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { QueueService } from './queue.service';

@Global()
@Module({
  providers: [PrismaService, QueueService],
  exports: [PrismaService, QueueService],
})
export class CommonModule {}
