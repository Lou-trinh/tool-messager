import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ConsentStatus } from '@omni/database';
import { PrismaService } from '../common/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { BulkContactActionDto, ContactInputDto, CreateSuppressionDto, CreateTagDto, ImportContactsDto, SegmentInputDto, UpdateConsentDto } from './contacts.dto';
import { SubscriptionPolicyService } from '../common/subscription-policy.service';
import { QueueService } from '../common/queue.service';
import { queues } from '@omni/queue';
import { randomUUID } from 'node:crypto';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService, private readonly policy: SubscriptionPolicyService, private readonly queue: QueueService) {}

  private normalizePhone(phone?: string): string | undefined {
    if (!phone) return undefined;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) throw new BadRequestException(`Invalid phone number: ${phone}`);
    if (digits.startsWith('84')) return `+${digits}`;
    if (digits.startsWith('0')) return `+84${digits.slice(1)}`;
    return `+${digits}`;
  }

  async list(userId: string, workspaceId: string, query: { search?: string; consent?: string; page?: string; limit?: string }): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.read');
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const where: Prisma.ContactWhereInput = {
      workspaceId,
      deletedAt: null,
      ...(query.consent && ['UNKNOWN', 'OPTED_IN', 'OPTED_OUT'].includes(query.consent) ? { consentStatus: query.consent as ConsentStatus } : {}),
      ...(query.search ? { OR: [
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
        { normalizedPhone: { contains: query.search } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { platformUserId: { contains: query.search } },
      ] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({ where, include: { tags: { include: { tag: true } }, consents: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.contact.count({ where }),
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  private async upsertOne(tx: Prisma.TransactionClient, workspaceId: string, input: ContactInputDto): Promise<{ id: string; created: boolean }> {
    const normalizedPhone = this.normalizePhone(input.phone);
    const matchers: Prisma.ContactWhereInput[] = [
      ...(input.platformUserId ? [{ platform: input.platform, platformUserId: input.platformUserId }] : []),
      ...(normalizedPhone ? [{ normalizedPhone }] : []),
    ];
    const existing = matchers.length ? await tx.contact.findFirst({ where: { workspaceId, deletedAt: null, OR: matchers } }) : null;
    const data = {
      platform: input.platform,
      ...(input.platformUserId ? { platformUserId: input.platformUserId } : {}),
      displayName: input.displayName,
      ...(input.username ? { username: input.username } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(normalizedPhone ? { normalizedPhone } : {}),
      ...(input.email ? { email: input.email.toLowerCase() } : {}),
      source: input.source,
      consentStatus: input.consentStatus,
      suppressed: input.consentStatus === 'OPTED_OUT',
      status: input.consentStatus === 'OPTED_OUT' ? ('DO_NOT_CONTACT' as const) : ('ACTIVE' as const),
      deletedAt: null,
    };
    const contact = existing
      ? await tx.contact.update({ where: { id: existing.id }, data })
      : await tx.contact.create({ data: { workspaceId, ...data } });
    if (!existing || existing.consentStatus !== input.consentStatus) {
      await tx.contactConsent.create({ data: {
        contactId: contact.id,
        status: input.consentStatus,
        source: input.consentSource ?? input.source,
        consentAt: input.consentStatus === 'OPTED_IN' ? new Date() : null,
        optOutAt: input.consentStatus === 'OPTED_OUT' ? new Date() : null,
      } });
    }
    return { id: contact.id, created: !existing };
  }

  async create(userId: string, workspaceId: string, input: ContactInputDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const normalizedPhone = this.normalizePhone(input.phone);
    const matchers: Prisma.ContactWhereInput[] = [
      ...(input.platformUserId ? [{ platform: input.platform, platformUserId: input.platformUserId }] : []),
      ...(normalizedPhone ? [{ normalizedPhone }] : []),
    ];
    const existing = matchers.length ? await this.prisma.contact.findFirst({ where: { workspaceId, deletedAt: null, OR: matchers }, select: { id: true } }) : null;
    if (!existing) await this.policy.assertContactCapacity(workspaceId);
    const result = await this.prisma.$transaction((tx) => this.upsertOne(tx, workspaceId, input));
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: result.created ? 'CONTACT_CREATED' : 'CONTACT_UPDATED', resource: 'Contact', resourceId: result.id, result: 'SUCCESS', metadata: { source: input.source, consentStatus: input.consentStatus } } });
    return this.prisma.contact.findUnique({ where: { id: result.id }, include: { consents: true, tags: { include: { tag: true } } } });
  }

  async import(userId: string, workspaceId: string, input: ImportContactsDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    if (input.contacts.length > 5_000) throw new BadRequestException('A single import is limited to 5,000 contacts.');
    await this.policy.assertContactCapacity(workspaceId, input.contacts.length);
    const externalId = `contact-import-${workspaceId}-${randomUUID()}`;
    await this.prisma.backgroundJob.create({ data: { workspaceId, queue: queues.contactImport, externalId, type: 'CONTACT_IMPORT', status: 'PENDING', payload: { workspaceId, userId, contacts: input.contacts } as unknown as Prisma.InputJsonValue } });
    await this.queue.add(queues.contactImport, 'contact-import', { externalId }, externalId);
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'CONTACT_IMPORT_QUEUED', resource: 'BackgroundJob', resourceId: externalId, result: 'SUCCESS', metadata: { total: input.contacts.length } } });
    return { status: 'QUEUED', jobId: externalId, total: input.contacts.length };
  }

  async updateConsent(userId: string, workspaceId: string, contactId: string, input: UpdateConsentDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, workspaceId, deletedAt: null } });
    if (!contact) throw new NotFoundException('Contact not found.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.contact.update({ where: { id: contactId }, data: { consentStatus: input.status, suppressed: input.status === 'OPTED_OUT', status: input.status === 'OPTED_OUT' ? 'DO_NOT_CONTACT' : 'ACTIVE' } });
      await tx.contactConsent.create({ data: { contactId, status: input.status, source: input.source, ...(input.legalBasis ? { legalBasis: input.legalBasis } : {}), consentAt: input.status === 'OPTED_IN' ? new Date() : null, optOutAt: input.status === 'OPTED_OUT' ? new Date() : null } });
      return current;
    });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: input.status === 'OPTED_OUT' ? 'CONTACT_OPTED_OUT' : 'CONTACT_CONSENT_UPDATED', resource: 'Contact', resourceId: contactId, result: 'SUCCESS', metadata: { status: input.status, source: input.source } } });
    return updated;
  }

  async createTag(userId: string, workspaceId: string, input: CreateTagDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    return this.prisma.tag.upsert({ where: { workspaceId_name: { workspaceId, name: input.name } }, update: { ...(input.color ? { color: input.color } : {}) }, create: { workspaceId, name: input.name, ...(input.color ? { color: input.color } : {}) } });
  }

  async assignTag(userId: string, workspaceId: string, contactId: string, tagId: string): Promise<void> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const [contact, tag] = await Promise.all([this.prisma.contact.findFirst({ where: { id: contactId, workspaceId } }), this.prisma.tag.findFirst({ where: { id: tagId, workspaceId } })]);
    if (!contact || !tag) throw new NotFoundException('Contact or tag not found.');
    await this.prisma.contactTag.upsert({ where: { contactId_tagId: { contactId, tagId } }, update: {}, create: { contactId, tagId } });
  }

  async tags(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.read');
    return this.prisma.tag.findMany({ where: { workspaceId }, include: { _count: { select: { contacts: true } } }, orderBy: { name: 'asc' } });
  }

  private segmentWhere(workspaceId: string, filter: SegmentInputDto['filter']): Prisma.ContactWhereInput {
    return {
      workspaceId,
      deletedAt: null,
      ...(filter.platform ? { platform: filter.platform } : {}),
      ...(filter.consentStatus ? { consentStatus: filter.consentStatus } : {}),
      ...(typeof filter.suppressed === 'boolean' ? { suppressed: filter.suppressed } : {}),
      ...(filter.tagId ? { tags: { some: { tagId: filter.tagId } } } : {}),
      ...(filter.source ? { source: { contains: filter.source, mode: 'insensitive' } } : {}),
      ...(filter.search ? { OR: [
        { displayName: { contains: filter.search, mode: 'insensitive' } },
        { normalizedPhone: { contains: filter.search } },
        { platformUserId: { contains: filter.search } },
        { email: { contains: filter.search, mode: 'insensitive' } },
      ] } : {}),
    };
  }

  async segments(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.read');
    return this.prisma.segment.findMany({ where: { workspaceId }, orderBy: { updatedAt: 'desc' } });
  }

  async createSegment(userId: string, workspaceId: string, input: SegmentInputDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const estimatedSize = await this.prisma.contact.count({ where: this.segmentWhere(workspaceId, input.filter) });
    const segment = await this.prisma.segment.create({ data: { workspaceId, name: input.name.trim(), ...(input.description ? { description: input.description.trim() } : {}), filter: input.filter, estimatedSize, lastEvaluated: new Date() } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'SEGMENT_CREATED', resource: 'Segment', resourceId: segment.id, result: 'SUCCESS', metadata: { estimatedSize } } });
    return segment;
  }

  async updateSegment(userId: string, workspaceId: string, segmentId: string, input: SegmentInputDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const existing = await this.prisma.segment.findFirst({ where: { id: segmentId, workspaceId } });
    if (!existing) throw new NotFoundException('Segment not found.');
    const estimatedSize = await this.prisma.contact.count({ where: this.segmentWhere(workspaceId, input.filter) });
    return this.prisma.segment.update({ where: { id: segmentId }, data: { name: input.name.trim(), ...(input.description !== undefined ? { description: input.description.trim() || null } : {}), filter: input.filter, estimatedSize, lastEvaluated: new Date() } });
  }

  async previewSegment(userId: string, workspaceId: string, segmentId: string): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.read');
    const segment = await this.prisma.segment.findFirst({ where: { id: segmentId, workspaceId } });
    if (!segment) throw new NotFoundException('Segment not found.');
    const filter = segment.filter as SegmentInputDto['filter'];
    const where = this.segmentWhere(workspaceId, filter);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({ where, select: { id: true, displayName: true, platform: true, normalizedPhone: true, platformUserId: true, consentStatus: true, suppressed: true }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      this.prisma.contact.count({ where }),
    ]);
    await this.prisma.segment.update({ where: { id: segmentId }, data: { estimatedSize: total, lastEvaluated: new Date() } });
    return { items, total };
  }

  async deleteSegment(userId: string, workspaceId: string, segmentId: string): Promise<void> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const result = await this.prisma.segment.deleteMany({ where: { id: segmentId, workspaceId } });
    if (!result.count) throw new NotFoundException('Segment not found.');
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'SEGMENT_DELETED', resource: 'Segment', resourceId: segmentId, result: 'SUCCESS' } });
  }

  async bulkAction(userId: string, workspaceId: string, input: BulkContactActionDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const ids = [...new Set(input.contactIds)];
    if (!ids.length || ids.length > 10_000) throw new BadRequestException('Bulk action requires 1–10,000 contacts.');
    const contacts = await this.prisma.contact.findMany({ where: { workspaceId, id: { in: ids }, deletedAt: null }, select: { id: true } });
    if (contacts.length !== ids.length) throw new BadRequestException('One or more contacts are invalid.');
    if (input.operation === 'TAG') {
      if (!input.tagId || !await this.prisma.tag.findFirst({ where: { id: input.tagId, workspaceId } })) throw new BadRequestException('A valid tagId is required.');
      await this.prisma.contactTag.createMany({ data: ids.map((contactId) => ({ contactId, tagId: input.tagId! })), skipDuplicates: true });
    } else if (input.operation === 'ARCHIVE') {
      await this.prisma.contact.updateMany({ where: { workspaceId, id: { in: ids } }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
    } else {
      const status = input.operation === 'OPT_IN' ? 'OPTED_IN' : input.operation === 'OPT_OUT' ? 'OPTED_OUT' : undefined;
      await this.prisma.$transaction(async (tx) => {
        await tx.contact.updateMany({ where: { workspaceId, id: { in: ids } }, data: status ? { consentStatus: status, suppressed: status === 'OPTED_OUT', status: status === 'OPTED_OUT' ? 'DO_NOT_CONTACT' : 'ACTIVE' } : { suppressed: true, status: 'DO_NOT_CONTACT' } });
        if (status) await tx.contactConsent.createMany({ data: ids.map((contactId) => ({ contactId, status, source: 'BULK_ADMIN_ACTION', consentAt: status === 'OPTED_IN' ? new Date() : null, optOutAt: status === 'OPTED_OUT' ? new Date() : null })) });
      });
    }
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: `CONTACT_BULK_${input.operation}`, resource: 'Contact', result: 'SUCCESS', metadata: { count: ids.length, tagId: input.tagId ?? null } } });
    return { affected: ids.length };
  }

  async suppressions(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.read');
    return this.prisma.suppressionEntry.findMany({ where: { workspaceId, scope: 'TENANT' }, orderBy: { createdAt: 'desc' } });
  }

  async suppress(userId: string, workspaceId: string, input: CreateSuppressionDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const normalizedPhone = this.normalizePhone(input.phone);
    if (!normalizedPhone && !input.platformUserId) throw new BadRequestException('A phone or platformUserId is required.');
    if (input.platformUserId && !input.platform) throw new BadRequestException('platform is required with platformUserId.');
    const entry = await this.prisma.suppressionEntry.create({ data: { workspaceId, scope: 'TENANT', ...(input.platform ? { platform: input.platform } : {}), ...(input.platformUserId ? { platformUserId: input.platformUserId } : {}), ...(normalizedPhone ? { normalizedPhone } : {}), reason: input.reason, source: input.source, createdById: userId } });
    await this.prisma.contact.updateMany({ where: { workspaceId, deletedAt: null, OR: [...(normalizedPhone ? [{ normalizedPhone }] : []), ...(input.platformUserId && input.platform ? [{ platform: input.platform, platformUserId: input.platformUserId }] : [])] }, data: { suppressed: true, status: 'DO_NOT_CONTACT' } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'SUPPRESSION_ADDED', resource: 'SuppressionEntry', resourceId: entry.id, result: 'SUCCESS' } });
    return entry;
  }

  async unsuppress(userId: string, workspaceId: string, entryId: string): Promise<void> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    const result = await this.prisma.suppressionEntry.deleteMany({ where: { id: entryId, workspaceId, scope: 'TENANT' } });
    if (!result.count) throw new NotFoundException('Suppression entry not found.');
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'SUPPRESSION_REMOVED', resource: 'SuppressionEntry', resourceId: entryId, result: 'SUCCESS' } });
  }
}
