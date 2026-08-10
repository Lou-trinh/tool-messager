import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformsModule } from '../platforms/platforms.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { ZaloOAuthController } from './zalo-oauth.controller';
import { ZaloOAuthService } from './zalo-oauth.service';

@Module({
  imports: [AuthModule, WorkspacesModule, PlatformsModule],
  controllers: [AccountsController, ZaloOAuthController],
  providers: [AccountsService, ZaloOAuthService],
})
export class AccountsModule {}
