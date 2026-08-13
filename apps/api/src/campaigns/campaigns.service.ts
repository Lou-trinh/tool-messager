import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@omni/database';
import { queues } from '@omni/queue';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateCampaignDto, ScheduleCampaignDto } from './campaigns.dto';
import { SubscriptionPolicyService } from '../common/subscription-policy.service';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly queue: QueueService,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.workspaces.assertPermission(userId, workspaceId, 'campaign.read');
    return this.prisma.campaign.findMany({ where: { workspaceId, deletedAt: null }, include: { account: { select: { displayName: true, platform: true } }, template: { select: { name: true, version: true } }, _count: { select: { audience: true, messages: true } } }, orderBy: { updatedAt: 'desc' } });
  }

  async detail(userId: string, workspaceId: string, campaignId: string): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'campaign.read');
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId, deletedAt: null },
      include: { account: true, template: true, audience: { include: { contact: true }, orderBy: { createdAt: 'asc' } }, messages: { include: { message: true }, orderBy: { createdAt: 'desc' } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found.');
    return campaign;
  }

  async create(userId: string, workspaceId: string, input: CreateCampaignDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'campaign.manage');
    await this.policy.assertCampaignCapacity(workspaceId);
    if (!input.contactIds?.length && !input.segmentId) throw new BadRequestException('A static audience or segmentId is required.');
    const segment = input.segmentId ? await this.prisma.segment.findFirst({ where: { id: input.segmentId, workspaceId } }) : null;
    if (input.segmentId && !segment) throw new NotFoundException('Segment not found.');
    const filter = segment?.filter && typeof segment.filter === 'object' && !Array.isArray(segment.filter) ? segment.filter as Record<string, unknown> : {};
    const segmentWhere: Prisma.ContactWhereInput = segment ? {
      workspaceId,
      deletedAt: null,
      ...(typeof filter.platform === 'string' ? { platform: filter.platform as 'ZALO' | 'FACEBOOK' | 'TIKTOK' } : {}),
      ...(typeof filter.consentStatus === 'string' ? { consentStatus: filter.consentStatus as 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT' } : {}),
      ...(typeof filter.suppressed === 'boolean' ? { suppressed: filter.suppressed } : {}),
      ...(typeof filter.tagId === 'string' ? { tags: { some: { tagId: filter.tagId } } } : {}),
      ...(typeof filter.source === 'string' ? { source: { contains: filter.source, mode: 'insensitive' } } : {}),
      ...(typeof filter.search === 'string' ? { OR: [{ displayName: { contains: filter.search, mode: 'insensitive' } }, { normalizedPhone: { contains: filter.search } }, { platformUserId: { contains: filter.search } }] } : {}),
    } : { id: { in: input.contactIds ?? [] }, workspaceId, deletedAt: null };
    const [account, template, contacts] = await Promise.all([
      this.prisma.socialAccount.findFirst({ where: { id: input.accountId, workspaceId, deletedAt: null } }),
      this.prisma.messageTemplate.findFirst({ where: { id: input.templateId, workspaceId, deletedAt: null } }),
      this.prisma.contact.findMany({ where: segmentWhere, select: { id: true, consentStatus: true, suppressed: true }, take: 50_000 }),
    ]);
    if (!account || !template) throw new NotFoundException('Account or template not found.');
    if (input.contactIds && contacts.length !== new Set(input.contactIds).size) throw new BadRequestException('One or more audience contacts are invalid.');
    if (!contacts.length) throw new BadRequestException('Audience is empty.');
    const campaign = await this.prisma.campaign.create({
      data: {
        workspaceId,
        accountId: account.id,
        templateId: template.id,
        name: input.name,
        platform: account.platform,
        promotional: input.promotional ?? true,
        audienceDefinition: segment ? { type: 'SEGMENT', segmentId: segment.id, segmentName: segment.name, count: contacts.length } : { type: 'STATIC', count: contacts.length },
        statistics: { queued: 0, sent: 0, failed: 0, blocked: 0 },
        audience: { create: contacts.map((contact) => ({ contactId: contact.id, status: contact.suppressed || ((input.promotional ?? true) && contact.consentStatus !== 'OPTED_IN') ? 'EXCLUDED' : 'INCLUDED', ...(contact.suppressed ? { excludedReason: 'CONTACT_SUPPRESSED' } : (input.promotional ?? true) && contact.consentStatus !== 'OPTED_IN' ? { excludedReason: 'CONSENT_REQUIRED' } : {}) })) },
      },
      include: { _count: { select: { audience: true } } },
    });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'CAMPAIGN_CREATED', resource: 'Campaign', resourceId: campaign.id, result: 'SUCCESS', metadata: { audienceCount: contacts.length } } });
    return campaign;
  }

  async approve(userId: string, workspaceId: string, campaignId: string): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'campaign.approve');
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, workspaceId, deletedAt: null } });
    if (!campaign) throw new NotFoundException('Campaign not found.');
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(campaign.status)) throw new BadRequestException('Campaign cannot be approved from its current status.');
    const updated = await this.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'CAMPAIGN_APPROVED', resource: 'Campaign', resourceId: campaignId, result: 'SUCCESS' } });
    return updated;
  }

  async schedule(userId: string, workspaceId: string, campaignId: string, input: ScheduleCampaignDto): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'campaign.manage');
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, workspaceId, status: 'APPROVED', deletedAt: null } });
    if (!campaign) throw new BadRequestException('Only approved campaigns can be scheduled.');
    if (input.scheduledAt <= new Date()) throw new BadRequestException('Schedule time must be in the future.');
    return this.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'SCHEDULED', scheduledAt: input.scheduledAt } });
  }

  async launch(userId: string, workspaceId: string, campaignId: string): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'campaign.manage');
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, workspaceId, deletedAt: null }, include: { account: true, template: true, audience: { include: { contact: true } } } });
    if (!campaign || !campaign.account || !campaign.template) throw new NotFoundException('Campaign, account or template not found.');
    if (!['APPROVED', 'SCHEDULED', 'PAUSED'].includes(campaign.status)) throw new BadRequestException('Campaign must be approved before launch.');
    await this.policy.assertOutboundAllowed(workspaceId, campaign.audience.filter((member) => member.status === 'INCLUDED').length);
    const externalId = `launch-campaign-${campaign.id}`;
    const updated = await this.prisma.$transaction(async (tx) => {
      const value = await tx.campaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } });
      await tx.backgroundJob.upsert({ where: { externalId }, update: { status: 'PENDING', error: {}, completedAt: null }, create: { workspaceId, queue: queues.automationExecute, externalId, type: 'CAMPAIGN_START', payload: { campaignId: campaign.id } } });
      await tx.auditLog.create({ data: { workspaceId, userId, action: 'CAMPAIGN_QUEUED', resource: 'Campaign', resourceId: campaign.id, result: 'SUCCESS', metadata: { eligible: campaign.audience.filter((member) => member.status === 'INCLUDED').length } } });
      return value;
    });
    await this.queue.add(queues.automationExecute, 'campaign-start', { campaignId: campaign.id }, externalId);
    return updated;
  }

  async setStatus(userId: string, workspaceId: string, campaignId: string, action: 'pause' | 'resume' | 'cancel'): Promise<unknown> {
    await this.workspaces.assertPermission(userId, workspaceId, 'campaign.manage');
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, workspaceId, deletedAt: null } });
    if (!campaign) throw new NotFoundException('Campaign not found.');
    const allowed = action === 'pause' ? ['RUNNING', 'SCHEDULED'] : action === 'resume' ? ['PAUSED'] : ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'RUNNING', 'PAUSED'];
    if (!allowed.includes(campaign.status)) throw new BadRequestException(`Campaign cannot ${action} from ${campaign.status}.`);
    if (action === 'resume') await this.policy.assertOutboundAllowed(workspaceId);
    const status = action === 'pause' ? 'PAUSED' : action === 'resume' ? 'RUNNING' : 'CANCELLED';
    const updated = await this.prisma.campaign.update({ where: { id: campaignId }, data: { status } });
    if (action === 'resume') {
      const externalId = `resume-campaign-${campaignId}-${Date.now()}`;
      await this.prisma.backgroundJob.create({ data: { workspaceId, queue: queues.automationExecute, externalId, type: 'CAMPAIGN_RESUME', payload: { campaignId } } });
      await this.queue.add(queues.automationExecute, 'campaign-resume', { campaignId }, externalId);
    }
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: `CAMPAIGN_${status}`, resource: 'Campaign', resourceId: campaignId, result: 'SUCCESS' } });
    return updated;
  }
}
