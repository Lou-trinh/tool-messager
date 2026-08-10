import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

@Module({ imports: [AuthModule, WorkspacesModule], controllers: [ContactsController], providers: [ContactsService], exports: [ContactsService] })
export class ContactsModule {}
