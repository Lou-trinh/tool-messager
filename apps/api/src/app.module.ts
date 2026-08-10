import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AccountsModule } from './accounts/accounts.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CommonModule } from './common/common.module';
import { ContactsModule } from './contacts/contacts.module';
import { HealthModule } from './health/health.module';
import { MessagesModule } from './messages/messages.module';
import { OperationsModule } from './operations/operations.module';
import { PlatformsModule } from './platforms/platforms.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { SiteVerificationController } from './site-verification.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({ global: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 180 }]),
    CommonModule,
    AuthModule,
    WorkspacesModule,
    AccountsModule,
    ContactsModule,
    MessagesModule,
    OperationsModule,
    CampaignsModule,
    PlatformsModule,
    AuditModule,
    HealthModule,
  ],
  controllers: [SiteVerificationController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
