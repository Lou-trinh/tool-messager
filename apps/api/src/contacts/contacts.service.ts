import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ConsentStatus } from '@omni/database';
import { PrismaService } from '../common/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { ContactInputDto, CreateSuppressionDto, CreateTagDto, ImportContactsDto, UpdateConsentDto } from './contacts.dto';
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
    const existing = input.platformUserId
      ? await tx.contact.findUnique({ where: { workspaceId_platform_platformUserId: { workspaceId, platform: input.platform, platformUserId: input.platformUserId } } })
      : normalizedPhone
        ? await tx.contact.findFirst({ where: { workspaceId, normalizedPhone, deletedAt: null } })
        : null;
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
    const existing = input.platformUserId
      ? await this.prisma.contact.findUnique({ where: { workspaceId_platform_platformUserId: { workspaceId, platform: input.platform, platformUserId: input.platformUserId } }, select: { id: true } })
      : normalizedPhone
        ? await this.prisma.contact.findFirst({ where: { workspaceId, normalizedPhone, deletedAt: null }, select: { id: true } })
        : null;
    if (!existing) await this.policy.assertContactCapacity(workspaceId);
    const result = await this.prisma.$transaction((tx) => this.upsertOne(tx, workspaceId, input));
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: result.created ? 'CONTACT_CREATED' : 'CONTACT_UPDATED', resource: 'Contact', resourceId: result.id, result: 'SUCCESS', metadata: { source: input.source, consentStatus: input.consentStatus } } });
    return this.prisma.contact.findUnique({ where: { id: result.id }, include: { consents: true, tags: { include: { tag: true } } } });
  }

  async import(userId: string, workspaceId: string, input: ImportContactsDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'contact.manage');
    if (input.contacts.length > 5_000) throw new BadRequestException('A single import is limited to 5,000 contacts.');
    await this.policy.assertContactCapacity(workspaceId, input.contacts.length);
    const externalId = `contact-import:${workspaceId}:${randomUUID()}`;
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
