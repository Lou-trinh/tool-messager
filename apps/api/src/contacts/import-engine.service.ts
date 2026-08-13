import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import * as XLSX from '@e965/xlsx';
import { parse } from 'csv-parse';
import { Prisma, type ImportRowStatus, type ImportStatus } from '@omni/database';
import { queues } from '@omni/queue';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';
import { SubscriptionPolicyService } from '../common/subscription-policy.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

export const importTargets = ['displayName', 'phone', 'platformUserId', 'username', 'email', 'gender', 'source', 'consentStatus'] as const;
export type ImportTarget = typeof importTargets[number];
export type ImportMapping = Record<string, ImportTarget | 'IGNORE'>;

type RawRow = Record<string, unknown>;
type NormalizedRow = {
  platform: 'ZALO';
  displayName: string;
  phone?: string;
  normalizedPhone?: string;
  platformUserId?: string;
  username?: string;
  email?: string;
  gender?: string;
  source: string;
  consentStatus: 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT';
};

const headerAliases: Record<ImportTarget, string[]> = {
  displayName: ['name', 'fullname', 'displayname', 'ten', 'hoten', 'khachhang', 'customer'],
  phone: ['phone', 'mobile', 'telephone', 'sdt', 'sodienthoai', 'dienthoai'],
  platformUserId: ['zaloid', 'zalo', 'userid', 'uid', 'platformuserid', 'oauserid'],
  username: ['username', 'nickname', 'alias', 'user'],
  email: ['email', 'mail', 'emailaddress'],
  gender: ['gender', 'sex', 'gioitinh'],
  source: ['source', 'nguon', 'leadsource'],
  consentStatus: ['consent', 'consentstatus', 'optin', 'permission', 'dongy'],
};

function cleanHeader(value: string): string {
  return value.replace(/[đĐ]/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  if (typeof value === 'object' && 'result' in value) return cellText(value.result);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value).trim();
  return JSON.stringify(value);
}

function normalizePhone(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) throw new Error('Số điện thoại phải có 9–15 chữ số.');
  if (digits.startsWith('84')) return `+${digits}`;
  if (digits.startsWith('0')) return `+84${digits.slice(1)}`;
  return `+${digits}`;
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Injectable()
export class ImportEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly policy: SubscriptionPolicyService,
    private readonly queue: QueueService,
  ) {}

  async upload(userId: string, workspaceId: string, file: Express.Multer.File): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    await this.policy.entitlements(workspaceId);
    if (!file) throw new BadRequestException('Vui lòng chọn tệp dữ liệu.');
    const extension = extname(file.originalname).toLowerCase();
    if (!['.csv', '.xlsx', '.xls', '.json'].includes(extension)) throw new BadRequestException('Chỉ hỗ trợ CSV, XLSX, XLS hoặc JSON.');
    const maxBytes = Number(process.env.IMPORT_MAX_FILE_BYTES ?? 100 * 1024 * 1024);
    if (file.size > maxBytes) throw new BadRequestException(`Tệp vượt giới hạn ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    if (extension === '.json' && file.size > Number(process.env.IMPORT_MAX_JSON_BYTES ?? 20 * 1024 * 1024)) throw new BadRequestException('JSON được giới hạn 20 MB để bảo vệ bộ nhớ; hãy dùng CSV/XLSX cho dữ liệu lớn.');
    if (extension === '.xlsx' && file.size > Number(process.env.IMPORT_MAX_XLSX_BYTES ?? 50 * 1024 * 1024)) throw new BadRequestException('XLSX được giới hạn 50 MB; hãy dùng CSV cho dữ liệu rất lớn để được parse streaming.');
    if (extension === '.xls' && file.size > Number(process.env.IMPORT_MAX_XLS_BYTES ?? 20 * 1024 * 1024)) throw new BadRequestException('XLS legacy được giới hạn 20 MB; hãy Save As XLSX cho tệp lớn.');

    const checksum = await this.checksum(file.path);
    const duplicate = await this.prisma.importJob.findUnique({ where: { workspaceId_checksum: { workspaceId, checksum } } });
    if (duplicate) {
      await unlink(file.path).catch(() => undefined);
      return this.serialize(duplicate);
    }

    const job = await this.prisma.importJob.create({
      data: {
        workspaceId,
        uploadedById: userId,
        fileName: basename(file.originalname).slice(0, 240),
        mimeType: file.mimetype || 'application/octet-stream',
        format: extension.slice(1).toUpperCase(),
        sizeBytes: BigInt(file.size),
        checksum,
        status: 'UPLOADED',
      },
    });

    try {
      const { columns, total } = await this.stageFile(job.id, file.path, extension);
      if (!total) throw new BadRequestException('Tệp không có dòng dữ liệu.');
      const mapping = this.autoMapping(columns);
      await this.prisma.importJob.update({ where: { id: job.id }, data: { detectedColumns: columns, mapping, totalRows: total, status: 'MAPPING' } });
      await this.applyMapping(workspaceId, job.id, mapping);
      await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'IMPORT_FILE_UPLOADED', resource: 'ImportJob', resourceId: job.id, result: 'SUCCESS', metadata: { fileName: job.fileName, size: file.size, rows: total } } });
      return this.detail(userId, workspaceId, job.id);
    } catch (error) {
      await this.prisma.importJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorSummary: { message: error instanceof Error ? error.message : 'Không thể đọc tệp.' }, completedAt: new Date() } });
      throw error;
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  async history(userId: string, workspaceId: string, pageValue?: string): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.read');
    const page = Math.max(1, Number(pageValue ?? 1));
    const limit = 20;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.importJob.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.importJob.count({ where: { workspaceId } }),
    ]);
    return { items: items.map((item) => this.serialize(item)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async detail(userId: string, workspaceId: string, importId: string): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.read');
    const job = await this.prisma.importJob.findFirst({ where: { id: importId, workspaceId } });
    if (!job) throw new NotFoundException('Không tìm thấy phiên import.');
    return this.serialize(job);
  }

  async preview(userId: string, workspaceId: string, importId: string, pageValue?: string, statusValue?: string): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.read');
    await this.requireJob(workspaceId, importId);
    const page = Math.max(1, Number(pageValue ?? 1));
    const limit = 50;
    const allowed: ImportRowStatus[] = ['PENDING', 'VALID', 'INVALID', 'DUPLICATE', 'IMPORTED', 'SKIPPED', 'FAILED'];
    const status = allowed.includes(statusValue as ImportRowStatus) ? statusValue as ImportRowStatus : undefined;
    const where = { importJobId: importId, ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.importRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.importRow.count({ where }),
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async updateMapping(userId: string, workspaceId: string, importId: string, mapping: ImportMapping): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const job = await this.requireJob(workspaceId, importId);
    if (['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'CANCELLED'].includes(job.status)) throw new ConflictException('Không thể đổi mapping sau khi import đã bắt đầu.');
    const columns = Array.isArray(job.detectedColumns) ? job.detectedColumns.map(String) : [];
    const invalidColumn = Object.keys(mapping).find((column) => !columns.includes(column));
    const invalidTarget = Object.values(mapping).find((target) => target !== 'IGNORE' && !importTargets.includes(target));
    if (invalidColumn || invalidTarget) throw new BadRequestException('Mapping chứa cột hoặc trường đích không hợp lệ.');
    if (!Object.values(mapping).includes('displayName')) throw new BadRequestException('Mapping bắt buộc có trường Tên.');
    if (!Object.values(mapping).some((value) => value === 'phone' || value === 'platformUserId')) throw new BadRequestException('Mapping cần ít nhất Số điện thoại hoặc Zalo ID.');
    await this.applyMapping(workspaceId, importId, mapping);
    await this.prisma.importJob.update({ where: { id: importId }, data: { mapping } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'IMPORT_MAPPING_UPDATED', resource: 'ImportJob', resourceId: importId, result: 'SUCCESS', metadata: mapping } });
    return this.detail(userId, workspaceId, importId);
  }

  async commit(userId: string, workspaceId: string, importId: string): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const job = await this.requireJob(workspaceId, importId);
    if (job.status !== 'READY') throw new ConflictException('Phiên import chưa sẵn sàng hoặc đã được xử lý.');
    if (!job.validRows) throw new BadRequestException('Không có dòng hợp lệ để import.');
    await this.policy.assertContactCapacity(workspaceId, job.validRows);
    const externalId = `file-import-${job.id}`;
    await this.prisma.$transaction([
      this.prisma.importJob.update({ where: { id: job.id }, data: { status: 'QUEUED', progress: 0 } }),
      this.prisma.backgroundJob.upsert({ where: { externalId }, update: { status: 'PENDING', error: Prisma.JsonNull, completedAt: null }, create: { workspaceId, queue: queues.contactImport, externalId, type: 'FILE_CONTACT_IMPORT', payload: { importJobId: job.id, workspaceId, userId } } }),
      this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'IMPORT_QUEUED', resource: 'ImportJob', resourceId: job.id, result: 'SUCCESS', metadata: { validRows: job.validRows } } }),
    ]);
    try {
      await this.queue.add(queues.contactImport, 'file-contact-import', { importJobId: job.id, externalId }, externalId);
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.importJob.update({ where: { id: job.id }, data: { status: 'READY', progress: 100 } }),
        this.prisma.backgroundJob.update({ where: { externalId }, data: { status: 'FAILED', error: { message: error instanceof Error ? error.message : 'QUEUE_UNAVAILABLE' }, completedAt: new Date() } }),
      ]);
      throw new ServiceUnavailableException('Hàng đợi import tạm thời chưa sẵn sàng. Vui lòng thử lại.');
    }
    return this.detail(userId, workspaceId, importId);
  }

  async cancel(userId: string, workspaceId: string, importId: string): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const job = await this.requireJob(workspaceId, importId);
    if (['PROCESSING', 'COMPLETED', 'PARTIAL'].includes(job.status)) throw new ConflictException('Không thể hủy phiên import đang chạy hoặc đã hoàn tất.');
    const updated = await this.prisma.importJob.update({ where: { id: importId }, data: { status: 'CANCELLED', completedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'IMPORT_CANCELLED', resource: 'ImportJob', resourceId: importId, result: 'SUCCESS' } });
    return this.serialize(updated);
  }

  async errorCsv(userId: string, workspaceId: string, importId: string): Promise<string> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.read');
    await this.requireJob(workspaceId, importId);
    const rows = await this.prisma.importRow.findMany({ where: { importJobId: importId, status: { in: ['INVALID', 'FAILED'] } }, orderBy: { rowNumber: 'asc' } });
    const output = ['row,status,errors,raw'];
    for (const row of rows) output.push([row.rowNumber, row.status, JSON.stringify(row.errors), JSON.stringify(row.raw)].map(escapeCsv).join(','));
    return `\uFEFF${output.join('\r\n')}`;
  }

  private async applyMapping(workspaceId: string, importId: string, mapping: ImportMapping): Promise<void> {
    await this.prisma.importJob.update({ where: { id: importId }, data: { status: 'MAPPING', progress: 0, validRows: 0, invalidRows: 0, duplicateRows: 0 } });
    const seen = new Set<string>();
    let cursor: string | undefined;
    let valid = 0;
    let invalid = 0;
    let duplicate = 0;
    let processed = 0;
    while (true) {
      const rows = await this.prisma.importRow.findMany({ where: { importJobId: importId }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!rows.length) break;
      const normalized = rows.map((row) => {
        try {
          const value = this.normalizeRow(row.raw as RawRow, mapping, importId);
          const keys = [
            ...(value.platformUserId ? [`zalo:${value.platformUserId}`] : []),
            ...(value.normalizedPhone ? [`phone:${value.normalizedPhone}`] : []),
          ];
          return { row, value, keys, errors: [] as string[] };
        } catch (error) {
          return { row, value: undefined, keys: [] as string[], errors: [error instanceof Error ? error.message : 'Dòng dữ liệu không hợp lệ.'] };
        }
      });
      const phones = normalized.flatMap((item) => item.value?.normalizedPhone ? [item.value.normalizedPhone] : []);
      const platformIds = normalized.flatMap((item) => item.value?.platformUserId ? [item.value.platformUserId] : []);
      const existing = phones.length || platformIds.length ? await this.prisma.contact.findMany({ where: { workspaceId, deletedAt: null, OR: [...(phones.length ? [{ normalizedPhone: { in: phones } }] : []), ...(platformIds.length ? [{ platform: 'ZALO' as const, platformUserId: { in: platformIds } }] : [])] }, select: { normalizedPhone: true, platformUserId: true } }) : [];
      const existingKeys = new Set(existing.flatMap((contact) => [contact.normalizedPhone ? `phone:${contact.normalizedPhone}` : '', contact.platformUserId ? `zalo:${contact.platformUserId}` : '']).filter(Boolean));
      for (const item of normalized) {
        let status: ImportRowStatus;
        let errors = item.errors;
        if (!item.value || errors.length) {
          status = 'INVALID';
          invalid += 1;
        } else if (item.keys.some((key) => seen.has(key) || existingKeys.has(key))) {
          status = 'DUPLICATE';
          errors = [item.keys.some((key) => existingKeys.has(key)) ? 'Đã tồn tại trong danh bạ.' : 'Trùng trong cùng tệp.'];
          duplicate += 1;
        } else {
          status = 'VALID';
          valid += 1;
          for (const key of item.keys) seen.add(key);
        }
        await this.prisma.importRow.update({ where: { id: item.row.id }, data: { status, normalized: item.value ? item.value as Prisma.InputJsonObject : Prisma.JsonNull, dedupeKey: item.keys[0] ?? null, errors } });
        processed += 1;
      }
      cursor = rows.at(-1)?.id;
      const total = await this.prisma.importRow.count({ where: { importJobId: importId } });
      await this.prisma.importJob.update({ where: { id: importId }, data: { validRows: valid, invalidRows: invalid, duplicateRows: duplicate, progress: Math.min(99, Math.round(processed / Math.max(1, total) * 100)) } });
    }
    await this.prisma.importJob.update({ where: { id: importId }, data: { status: 'READY', validRows: valid, invalidRows: invalid, duplicateRows: duplicate, skippedRows: invalid + duplicate, progress: 100 } });
  }

  private normalizeRow(raw: RawRow, mapping: ImportMapping, importId: string): NormalizedRow {
    const values: Partial<Record<ImportTarget, string>> = {};
    for (const [column, target] of Object.entries(mapping)) if (target !== 'IGNORE') values[target] = cellText(raw[column]);
    const displayName = values.displayName?.trim();
    if (!displayName) throw new Error('Thiếu tên liên hệ.');
    const normalizedPhone = normalizePhone(values.phone ?? '');
    const platformUserId = values.platformUserId?.trim() || undefined;
    if (!normalizedPhone && !platformUserId) throw new Error('Thiếu số điện thoại hoặc Zalo ID.');
    const email = values.email?.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email không hợp lệ.');
    const consentRaw = cleanHeader(values.consentStatus ?? '');
    const consentStatus = ['optedin', 'yes', 'true', '1', 'dongy', 'consent'].includes(consentRaw) ? 'OPTED_IN' : ['optedout', 'no', 'false', '0', 'tuchoi'].includes(consentRaw) ? 'OPTED_OUT' : 'UNKNOWN';
    return {
      platform: 'ZALO',
      displayName,
      ...(values.phone ? { phone: values.phone } : {}),
      ...(normalizedPhone ? { normalizedPhone } : {}),
      ...(platformUserId ? { platformUserId } : {}),
      ...(values.username ? { username: values.username } : {}),
      ...(email ? { email } : {}),
      ...(values.gender ? { gender: values.gender } : {}),
      source: values.source || `IMPORT:${importId}`,
      consentStatus,
    };
  }

  private autoMapping(columns: string[]): ImportMapping {
    const mapping: ImportMapping = {};
    const used = new Set<ImportTarget>();
    for (const column of columns) {
      const normalized = cleanHeader(column);
      const target = importTargets.find((candidate) => !used.has(candidate) && headerAliases[candidate].includes(normalized));
      mapping[column] = target ?? 'IGNORE';
      if (target) used.add(target);
    }
    return mapping;
  }

  private async stageFile(importJobId: string, path: string, extension: string): Promise<{ columns: string[]; total: number }> {
    const rows = extension === '.csv' ? this.csvRows(path) : extension === '.xlsx' ? this.xlsxRows(path) : extension === '.json' ? this.jsonRows(path) : this.legacyXlsRows(path);
    let columns: string[] = [];
    let total = 0;
    let batch: Prisma.ImportRowCreateManyInput[] = [];
    for await (const raw of rows) {
      if (!columns.length) columns = Object.keys(raw).filter(Boolean).slice(0, 200);
      const sanitized = Object.fromEntries(columns.map((column) => [column, cellText(raw[column]).slice(0, 10_000)]));
      total += 1;
      batch.push({ importJobId, rowNumber: total, raw: sanitized });
      if (batch.length >= 500) {
        await this.prisma.importRow.createMany({ data: batch });
        batch = [];
      }
      if (total > Number(process.env.IMPORT_MAX_ROWS ?? 1_000_000)) throw new BadRequestException('Tệp vượt giới hạn số dòng cho phép.');
    }
    if (batch.length) await this.prisma.importRow.createMany({ data: batch });
    return { columns, total };
  }

  private async *csvRows(path: string): AsyncGenerator<RawRow> {
    const parser = createReadStream(path).pipe(parse({ columns: true, bom: true, skip_empty_lines: true, trim: true, relax_column_count: true, relax_quotes: true }));
    for await (const record of parser) yield record as RawRow;
  }

  private async *xlsxRows(path: string): AsyncGenerator<RawRow> {
    const buffer = await readFile(path);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
    const firstName = workbook.SheetNames[0];
    const sheet = firstName ? workbook.Sheets[firstName] : undefined;
    if (!sheet) throw new BadRequestException('Workbook XLSX không có worksheet.');
    for (const row of XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '', raw: false })) yield row;
  }

  private async *jsonRows(path: string): AsyncGenerator<RawRow> {
    const staticallyLimited = await readFile(path, 'utf8');
    const parsed = JSON.parse(staticallyLimited) as unknown;
    const nested = typeof parsed === 'object' && parsed !== null && 'contacts' in parsed ? (parsed as { contacts?: unknown }).contacts : undefined;
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(nested) ? nested : undefined;
    if (!rows) throw new BadRequestException('JSON phải là mảng hoặc object có contacts[].');
    for (const row of rows) if (row && typeof row === 'object' && !Array.isArray(row)) yield row as RawRow;
  }

  private async *legacyXlsRows(path: string): AsyncGenerator<RawRow> {
    const buffer = await readFile(path);
    const text = buffer.toString('utf8');
    if (/^\s*</.test(text) && /<table|<Workbook/i.test(text)) {
      const rows = [...text.matchAll(/<Row[^>]*>([\s\S]*?)<\/Row>|<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => [...(match[1] ?? match[2] ?? '').matchAll(/<(?:Data|td|th)[^>]*>([\s\S]*?)<\/(?:Data|td|th)>/gi)].map((cell) => (cell[1] ?? '').replace(/<[^>]+>/g, '').trim()));
      const [headers, ...data] = rows;
      if (!headers) return;
      for (const values of data) yield Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, values[index] ?? '']));
      return;
    }
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
    const firstName = workbook.SheetNames[0];
    if (!firstName) throw new BadRequestException('Workbook XLS không có worksheet.');
    const sheet = workbook.Sheets[firstName];
    if (!sheet) throw new BadRequestException('Không thể đọc worksheet đầu tiên của XLS.');
    const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '', raw: false });
    for (const row of rows) yield row;
  }

  private async checksum(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('hex');
  }

  private async requireJob(workspaceId: string, importId: string): Promise<{ id: string; status: ImportStatus; detectedColumns: Prisma.JsonValue; validRows: number }> {
    const job = await this.prisma.importJob.findFirst({ where: { id: importId, workspaceId }, select: { id: true, status: true, detectedColumns: true, validRows: true } });
    if (!job) throw new NotFoundException('Không tìm thấy phiên import.');
    return job;
  }

  private serialize<T extends { sizeBytes: bigint }>(job: T): Omit<T, 'sizeBytes'> & { sizeBytes: number } {
    return { ...job, sizeBytes: Number(job.sizeBytes) };
  }
}
