import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import type { CreateWorkspaceDto, InviteMemberDto } from './workspaces.dto';
import { SubscriptionPolicyService } from '../common/subscription-policy.service';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService, private readonly policy: SubscriptionPolicyService) {}

  private slug(name: string): string {
    return `${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomBytes(3).toString('hex')}`;
  }

  async list(userId: string): Promise<unknown[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, status: 'ACTIVE', workspace: { deletedAt: null } },
      select: { role: true, workspace: { select: { id: true, name: true, slug: true, timezone: true, suspendedAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { systemRole: true } });
    if (user?.systemRole !== 'SUPER_ADMIN') return memberships;
    const sessions = await this.prisma.supportSession.findMany({
      where: { adminId: userId, status: 'ACTIVE', expiresAt: { gt: new Date() }, workspace: { deletedAt: null } },
      select: { id: true, expiresAt: true, workspace: { select: { id: true, name: true, slug: true, timezone: true, suspendedAt: true } } },
      orderBy: { startedAt: 'desc' },
    });
    const memberWorkspaceIds = new Set(memberships.map((item) => item.workspace.id));
    return [...memberships, ...sessions.filter((session) => !memberWorkspaceIds.has(session.workspace.id)).map((session) => ({ role: 'SUPPORT', supportSessionId: session.id, supportExpiresAt: session.expiresAt, workspace: session.workspace }))];
  }

  async create(userId: string, input: CreateWorkspaceDto): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data: { name: input.name, slug: this.slug(input.name) } });
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId, role: 'OWNER' } });
      const freePlan = await tx.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
      await tx.subscription.create({ data: { workspaceId: workspace.id, planId: freePlan.id, startAt: new Date(), endAt: new Date(Date.now() + 30 * 86_400_000), status: 'ACTIVE' } });
      await tx.auditLog.create({ data: { workspaceId: workspace.id, userId, action: 'WORKSPACE_CREATED', resource: 'Workspace', resourceId: workspace.id, result: 'SUCCESS' } });
      return workspace;
    });
  }

  async assertMembership(userId: string, workspaceId: string, allowedRoles?: string[]): Promise<{ role: string }> {
    const membership = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { role: true, status: true, workspace: { select: { suspendedAt: true, deletedAt: true } } } });
    if (membership?.status === 'ACTIVE' && !membership.workspace.deletedAt) {
      if (allowedRoles && !allowedRoles.includes(membership.role)) throw new ForbiddenException('Workspace role does not allow this operation.');
      return { role: membership.role };
    }
    const support = await this.prisma.supportSession.findFirst({
      where: { adminId: userId, workspaceId, status: 'ACTIVE', expiresAt: { gt: new Date() }, workspace: { deletedAt: null } },
      select: { id: true },
    });
    if (!support) throw new ForbiddenException('Workspace access denied.');
    const supportRole = 'ADMIN';
    if (allowedRoles && !allowedRoles.includes(supportRole)) throw new ForbiddenException('Support mode does not allow this operation.');
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'SUPPORT_MODE_ACCESS', resource: 'SupportSession', resourceId: support.id, result: 'SUCCESS' } });
    return { role: supportRole };
  }

  async detail(userId: string, workspaceId: string): Promise<unknown> {
    await this.assertMembership(userId, workspaceId);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { _count: { select: { accounts: true, contacts: true, groups: true, conversations: true, campaigns: true, posts: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found.');
    return workspace;
  }

  async members(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.assertMembership(userId, workspaceId);
    return this.prisma.workspaceMember.findMany({ where: { workspaceId }, select: { id: true, role: true, status: true, createdAt: true, user: { select: { id: true, email: true, displayName: true, emailVerifiedAt: true } } } });
  }

  async invite(userId: string, workspaceId: string, input: InviteMemberDto): Promise<unknown> {
    await this.assertMembership(userId, workspaceId, ['OWNER', 'ADMIN']);
    const limits = await this.policy.entitlements(workspaceId);
    const memberCount = await this.prisma.workspaceMember.count({ where: { workspaceId, status: { in: ['ACTIVE', 'INVITED'] } } });
    if (memberCount >= limits.maxUsers) throw new ForbiddenException('USER_QUOTA_EXCEEDED: Workspace member quota exceeded.');
    const rawToken = randomBytes(32).toString('base64url');
    const invitation = await this.prisma.workspaceInvitation.upsert({
      where: { workspaceId_email: { workspaceId, email: input.email.toLowerCase() } },
      update: { role: input.role, tokenHash: createHash('sha256').update(rawToken).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86_400_000), invitedById: userId, acceptedAt: null },
      create: { workspaceId, email: input.email.toLowerCase(), role: input.role, tokenHash: createHash('sha256').update(rawToken).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86_400_000), invitedById: userId },
    });
    await this.prisma.auditLog.create({ data: { workspaceId, userId, action: 'MEMBER_INVITED', resource: 'WorkspaceInvitation', resourceId: invitation.id, result: 'SUCCESS', metadata: { email: input.email.toLowerCase(), role: input.role } } });
    return { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, delivery: process.env.SMTP_URL ? 'QUEUED' : 'NOT_CONFIGURED', ...(process.env.NODE_ENV !== 'production' ? { developmentToken: rawToken } : {}) };
  }

  async usage(userId: string, workspaceId: string): Promise<unknown> {
    await this.assertMembership(userId, workspaceId);
    return this.policy.usage(workspaceId);
  }

  async notifications(userId: string, workspaceId: string): Promise<unknown[]> {
    await this.assertMembership(userId, workspaceId);
    return this.prisma.notification.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async readNotification(userId: string, workspaceId: string, notificationId: string): Promise<unknown> {
    await this.assertMembership(userId, workspaceId);
    const changed = await this.prisma.notification.updateMany({ where: { id: notificationId, workspaceId }, data: { readAt: new Date() } });
    if (!changed.count) throw new NotFoundException('Notification not found.');
    return this.prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
  }
}
