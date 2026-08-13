import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diskStorage } from 'multer';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BulkContactActionDto, ContactInputDto, CreateSuppressionDto, CreateTagDto, ImportContactsDto, ImportMappingDto, SegmentInputDto, UpdateConsentDto } from './contacts.dto';
import { ContactsService } from './contacts.service';
import { ImportEngineService } from './import-engine.service';

const importTempDirectory = join(tmpdir(), 'zalohub-imports');
mkdirSync(importTempDirectory, { recursive: true });

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId')
export class ContactsController {
  constructor(private readonly contacts: ContactsService, private readonly imports: ImportEngineService) {}

  @Get('contacts')
  async list(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Query() query: { search?: string; consent?: string; page?: string; limit?: string }): Promise<unknown> { return { success: true, data: await this.contacts.list(user.id, workspaceId, query) }; }

  @Post('contacts')
  async create(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: ContactInputDto): Promise<unknown> { return { success: true, data: await this.contacts.create(user.id, workspaceId, body) }; }

  @Post('contacts/import')
  async import(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: ImportContactsDto): Promise<unknown> { return { success: true, data: await this.contacts.import(user.id, workspaceId, body) }; }

  @Post('imports/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({ destination: importTempDirectory, filename: (_request, file, callback) => callback(null, `${Date.now()}-${randomUUID()}.${file.originalname.split('.').pop() ?? 'bin'}`) }),
    limits: { fileSize: Number(process.env.IMPORT_MAX_FILE_BYTES ?? 100 * 1024 * 1024), files: 1 },
    fileFilter: (_request, file, callback) => callback(/\.(csv|xlsx|xls|json)$/i.test(file.originalname) ? null : new BadRequestException('Chỉ hỗ trợ CSV, XLSX, XLS hoặc JSON.'), /\.(csv|xlsx|xls|json)$/i.test(file.originalname)),
  }))
  async uploadImport(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @UploadedFile() file: Express.Multer.File): Promise<unknown> { return { success: true, data: await this.imports.upload(user.id, workspaceId, file) }; }

  @Get('imports')
  async importHistory(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Query('page') page?: string): Promise<unknown> { return { success: true, data: await this.imports.history(user.id, workspaceId, page) }; }

  @Get('imports/:importId')
  async importDetail(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('importId') importId: string): Promise<unknown> { return { success: true, data: await this.imports.detail(user.id, workspaceId, importId) }; }

  @Get('imports/:importId/preview')
  async importPreview(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('importId') importId: string, @Query('page') page?: string, @Query('status') status?: string): Promise<unknown> { return { success: true, data: await this.imports.preview(user.id, workspaceId, importId, page, status) }; }

  @Patch('imports/:importId/mapping')
  async importMapping(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('importId') importId: string, @Body() body: ImportMappingDto): Promise<unknown> { return { success: true, data: await this.imports.updateMapping(user.id, workspaceId, importId, body.mapping) }; }

  @Post('imports/:importId/commit')
  async commitImport(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('importId') importId: string): Promise<unknown> { return { success: true, data: await this.imports.commit(user.id, workspaceId, importId) }; }

  @Post('imports/:importId/cancel')
  async cancelImport(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('importId') importId: string): Promise<unknown> { return { success: true, data: await this.imports.cancel(user.id, workspaceId, importId) }; }

  @Get('imports/:importId/errors.csv')
  async importErrors(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('importId') importId: string, @Res() response: Response): Promise<void> {
    const csv = await this.imports.errorCsv(user.id, workspaceId, importId);
    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader('content-disposition', `attachment; filename="import-${importId}-errors.csv"`);
    response.send(csv);
  }

  @Patch('contacts/:contactId/consent')
  async consent(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Body() body: UpdateConsentDto): Promise<unknown> { return { success: true, data: await this.contacts.updateConsent(user.id, workspaceId, contactId, body) }; }

  @Post('tags')
  async createTag(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: CreateTagDto): Promise<unknown> { return { success: true, data: await this.contacts.createTag(user.id, workspaceId, body) }; }

  @Get('tags')
  async tags(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.contacts.tags(user.id, workspaceId) }; }

  @Post('contacts/:contactId/tags/:tagId')
  async assignTag(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('contactId') contactId: string, @Param('tagId') tagId: string): Promise<unknown> { await this.contacts.assignTag(user.id, workspaceId, contactId, tagId); return { success: true, data: { assigned: true } }; }

  @Post('contacts/bulk')
  async bulk(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: BulkContactActionDto): Promise<unknown> { return { success: true, data: await this.contacts.bulkAction(user.id, workspaceId, body) }; }

  @Get('segments')
  async segments(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.contacts.segments(user.id, workspaceId) }; }

  @Post('segments')
  async createSegment(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: SegmentInputDto): Promise<unknown> { return { success: true, data: await this.contacts.createSegment(user.id, workspaceId, body) }; }

  @Patch('segments/:segmentId')
  async updateSegment(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('segmentId') segmentId: string, @Body() body: SegmentInputDto): Promise<unknown> { return { success: true, data: await this.contacts.updateSegment(user.id, workspaceId, segmentId, body) }; }

  @Get('segments/:segmentId/preview')
  async previewSegment(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('segmentId') segmentId: string): Promise<unknown> { return { success: true, data: await this.contacts.previewSegment(user.id, workspaceId, segmentId) }; }

  @Delete('segments/:segmentId')
  async deleteSegment(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('segmentId') segmentId: string): Promise<unknown> { await this.contacts.deleteSegment(user.id, workspaceId, segmentId); return { success: true, data: { removed: true } }; }

  @Get('suppressions')
  async suppressions(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.contacts.suppressions(user.id, workspaceId) }; }

  @Post('suppressions')
  async suppress(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: CreateSuppressionDto): Promise<unknown> { return { success: true, data: await this.contacts.suppress(user.id, workspaceId, body) }; }

  @Delete('suppressions/:entryId')
  async unsuppress(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('entryId') entryId: string): Promise<unknown> { await this.contacts.unsuppress(user.id, workspaceId, entryId); return { success: true, data: { removed: true } }; }
}
