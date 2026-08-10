import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContactInputDto, CreateTagDto, ImportContactsDto, UpdateConsentDto } from './contacts.dto';
import { ContactsService } from './contacts.service';

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('contacts')
  async list(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Query() query: { search?: string; consent?: string; page?: string; limit?: string }): Promise<unknown> { return { success: true, data: await this.contacts.list(user.id, workspaceId, query) }; }

  @Post('contacts')
  async create(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: ContactInputDto): Promise<unknown> { return { success: true, data: await this.contacts.create(user.id, workspaceId, body) }; }

  @Post('contacts/import')
  async import(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: ImportContactsDto): Promise<unknown> { return { success: true, data: await this.contacts.import(user.id, workspaceId, body) }; }

  @Patch('contacts/:contactId/consent')
  async consent(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: UpdateConsentDto): Promise<unknown> { return { success: true, data: await this.contacts.updateConsent(user.id, workspaceId, contactId, body) }; }

  @Post('tags')
  async createTag(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: CreateTagDto): Promise<unknown> { return { success: true, data: await this.contacts.createTag(user.id, workspaceId, body) }; }

  @Post('contacts/:contactId/tags/:tagId')
  async assignTag(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Param('tagId') tagId: string): Promise<unknown> { await this.contacts.assignTag(user.id, workspaceId, contactId, tagId); return { success: true, data: { assigned: true } }; }
}
