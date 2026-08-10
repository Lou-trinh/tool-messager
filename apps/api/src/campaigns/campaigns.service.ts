import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateCampaignDto, ScheduleCampaignDto } from './campaigns.dto';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly messages: MessagesService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertMembership(userId, workspaceId);
    return this.prisma.campaign.findMany({ where: { workspaceId, deletedAt: null }, include: { account: { select: { displayName: true, platform: true } }, template: { select: { name: true, version: true } }, _count: { select: { audience: true, messages: true } } }, orderBy: { updatedAt: 'desc' } });
  }

  async create(userId: string, workspaceId: string, input: CreateCampaignDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER']);
    const [account, template, contacts] = await Promise.all([
      this.prisma.socialAccount.findFirst({ where: { id: input.accountId, workspaceId, deletedAt: null } }),
      this.prisma.messageTemplate.findFirst({ where: { id: input.templateId, workspaceId, deletedAt: null } }),
      this.prisma.contact.findMany({ where: { id: { in: input.contactIds }, workspaceId, deletedAt: null }, select: { id: true, consentStatus: true, suppressed: true } }),
    ]);
    if (!account || !template) throw new NotFoundException('Account or template not found.');
    if (contacts.length !== new Set(input.contactIds).size) throw new BadRequestException('One or more audience contacts are invalid.');
    const campaign = await this.prisma.campaign.create({
      data: {
        workspaceId,
        accountId: account.id,
        templateId: template.id,
        name: input.name,
        platform: account.platform,
        promotional: input.promotional ?? true,
        audienceDefinition: { type: 'STATIC', count: contacts.length },
        statistics: { queued: 0, sent: 0, failed: 0, blocked: 0 },
        audience: { create: contacts.map((contact) => ({ contactId: contact.id, status: contact.suppressed || ((input.promotional ?? true) && contact.consentStatus !== 'OPTED_IN') ? 'EXCLUDED' : 'INCLUDED', ...(contact.suppressed ? { excludedReason: 'CONTACT_SUPPRESSED' } : (input.promotional ?? true) && contact.consentStatus !== 'OPTED_IN' ? { excludedReason: 'CONSENT_REQUIRED' } : {}) })) },
      },
      include: { _count: { select: { audience: true } } },
    });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'CAMPAIGN_CREATED', resource: 'Campaign', resourceId: campaign.id, result: 'SUCCESS', metadata: { audienceCount: contacts.length } } });
    return campaign;
  }

  async approve(userId: string, workspaceId: string, campaignId: string): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER']);
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, workspaceId, deletedAt: null } });
    if (!campaign) throw new NotFoundException('Campaign not found.');
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(campaign.status)) throw new BadRequestException('Campaign cannot be approved from its current status.');
    const updated = await this.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'CAMPAIGN_APPROVED', resource: 'Campaign', resourceId: campaignId, result: 'SUCCESS' } });
    return updated;
  }

  async schedule(userId: string, workspaceId: string, campaignId: string, input: ScheduleCampaignDto): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER']);
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, workspaceId, status: 'APPROVED', deletedAt: null } });
    if (!campaign) throw new BadRequestException('Only approved campaigns can be scheduled.');
    if (input.scheduledAt <= new Date()) throw new BadRequestException('Schedule time must be in the future.');
    return this.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'SCHEDULED', scheduledAt: input.scheduledAt } });
  }

  async launch(userId: string, workspaceId: string, campaignId: string): Promise<unknown> {
    await this.workspaces.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN', 'MANAGER']);
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, workspaceId, deletedAt: null }, include: { account: true, template: true, audience: { include: { contact: true } } } });
    if (!campaign || !campaign.account || !campaign.template) throw new NotFoundException('Campaign, account or template not found.');
    if (!['APPROVED', 'SCHEDULED', 'PAUSED'].includes(campaign.status)) throw new BadRequestException('Campaign must be approved before launch.');
    await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } });
    let queued = 0;
    let blocked = 0;
    for (const member of campaign.audience) {
      const idempotencyKey = `campaign:${campaign.id}:contact:${member.contactId}`;
      const content = campaign.template.content.replaceAll('{{firstName}}', member.contact.displayName.split(/\s+/)[0] ?? member.contact.displayName);
      await this.messages.send(userId, workspaceId, { accountId: campaign.account.id, contactId: member.contactId, content, promotional: campaign.promotional, idempotencyKey });
      const message = await this.prisma.message.findUnique({ where: { idempotencyKey } });
      if (message) {
        await this.prisma.campaignMessage.upsert({ where: { campaignId_contactId: { campaignId: campaign.id, contactId: member.contactId } }, update: { messageId: message.id, status: message.status, errorCode: message.errorCode }, create: { campaignId: campaign.id, contactId: member.contactId, messageId: message.id, status: message.status, errorCode: message.errorCode } });
        if (message.status === 'QUEUED') queued += 1; else blocked += 1;
      }
    }
    const status = queued > 0 ? 'RUNNING' : 'FAILED';
    const updated = await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status, statistics: { queued, sent: 0, failed: 0, blocked } } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'CAMPAIGN_LAUNCHED', resource: 'Campaign', resourceId: campaign.id, result: queued > 0 ? 'SUCCESS' : 'BLOCKED', metadata: { queued, blocked } } });
    return updated;
  }
}
