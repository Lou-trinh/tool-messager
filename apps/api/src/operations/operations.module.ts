import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformsModule } from '../platforms/platforms.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [AuthModule, WorkspacesModule, PlatformsModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
