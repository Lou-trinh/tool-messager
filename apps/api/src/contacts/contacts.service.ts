import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ConsentStatus } from '@omni/database';
import { PrismaService } from '../common/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { ContactInputDto, CreateTagDto, ImportContactsDto, UpdateConsentDto } from './contacts.dto';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) {}

  private normalizePhone(phone?: string): string | undefined {
    if (!phone) return undefined;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) throw new BadRequestException(`Invalid phone number: ${phone}`);
    if (digits.startsWith('84')) return `+${digits}`;
    if (digits.startsWith('0')) return `+84${digits.slice(1)}`;
    return `+${digits}`;
  }

  async list(userId: string, workspaceId: string, query: { search?: string; consent?: string; page?: string; limit?: string }): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId);
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
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']);
    const result = await this.prisma.$transaction((tx) => this.upsertOne(tx, workspaceId, input));
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: result.created ? 'CONTACT_CREATED' : 'CONTACT_UPDATED', resource: 'Contact', resourceId: result.id, result: 'SUCCESS', metadata: { source: input.source, consentStatus: input.consentStatus } } });
    return this.prisma.contact.findUnique({ where: { id: result.id }, include: { consents: true, tags: { include: { tag: true } } } });
  }

  async import(userId: string, workspaceId: string, input: ImportContactsDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']);
    if (input.contacts.length > 5_000) throw new BadRequestException('A single import is limited to 5,000 contacts.');
    let created = 0;
    let updated = 0;
    const ids = await this.prisma.$transaction(async (tx) => {
      const results: string[] = [];
      for (const contact of input.contacts) {
        const result = await this.upsertOne(tx, workspaceId, contact);
        if (result.created) created += 1; else updated += 1;
        results.push(result.id);
      }
      return results;
    }, { timeout: 60_000 });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'CONTACT_IMPORTED', resource: 'Contact', result: 'SUCCESS', metadata: { created, updated, total: ids.length } } });
    return { created, updated, total: ids.length, rollbackReference: ids };
  }

  async updateConsent(userId: string, workspaceId: string, contactId: string, input: UpdateConsentDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']);
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
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']);
    return this.prisma.tag.upsert({ where: { workspaceId_name: { workspaceId, name: input.name } }, update: { ...(input.color ? { color: input.color } : {}) }, create: { workspaceId, name: input.name, ...(input.color ? { color: input.color } : {}) } });
  }

  async assignTag(userId: string, workspaceId: string, contactId: string, tagId: string): Promise<void> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']);
    const [contact, tag] = await Promise.all([this.prisma.contact.findFirst({ where: { id: contactId, workspaceId } }), this.prisma.tag.findFirst({ where: { id: tagId, workspaceId } })]);
    if (!contact || !tag) throw new NotFoundException('Contact or tag not found.');
    await this.prisma.contactTag.upsert({ where: { contactId_tagId: { contactId, tagId } }, update: {}, create: { contactId, tagId } });
  }
}
