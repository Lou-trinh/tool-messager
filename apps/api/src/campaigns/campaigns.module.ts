import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({ imports: [AuthModule, WorkspacesModule], controllers: [CampaignsController], providers: [CampaignsService] })
export class CampaignsModule {}
