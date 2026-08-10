import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformsModule } from '../platforms/platforms.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({ imports: [AuthModule, WorkspacesModule, PlatformsModule], controllers: [MessagesController], providers: [MessagesService], exports: [MessagesService] })
export class MessagesModule {}
