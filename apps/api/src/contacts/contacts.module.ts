import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ImportEngineService } from './import-engine.service';

@Module({ imports: [AuthModule, WorkspacesModule], controllers: [ContactsController], providers: [ContactsService, ImportEngineService], exports: [ContactsService, ImportEngineService] })
export class ContactsModule {}
