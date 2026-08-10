import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuditController } from './audit.controller';

@Module({ imports: [AuthModule, WorkspacesModule], controllers: [AuditController] })
export class AuditModule {}
