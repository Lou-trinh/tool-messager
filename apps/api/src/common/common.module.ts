import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { QueueService } from './queue.service';
import { SecretEncryptionService } from './secret-encryption.service';

@Global()
@Module({
  providers: [PrismaService, QueueService, SecretEncryptionService],
  exports: [PrismaService, QueueService, SecretEncryptionService],
})
export class CommonModule {}
