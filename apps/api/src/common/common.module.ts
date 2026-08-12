import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { QueueService } from './queue.service';
import { SecretEncryptionService } from './secret-encryption.service';
import { SubscriptionPolicyService } from './subscription-policy.service';

@Global()
@Module({
  providers: [PrismaService, QueueService, SecretEncryptionService, SubscriptionPolicyService],
  exports: [PrismaService, QueueService, SecretEncryptionService, SubscriptionPolicyService],
})
export class CommonModule {}
