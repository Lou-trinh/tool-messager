import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Query('cursor') cursor?: string): Promise<unknown> {
    await this.workspaces.assertPermission(user.id, workspaceId, 'audit.read');
    const items = await this.prisma.auditLog.findMany({ where: { workspaceId }, take: 100, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { createdAt: 'desc' }, include: { user: { select: { displayName: true, email: true } } } });
    return { success: true, data: { items, nextCursor: items.at(-1)?.id ?? null } };
  }
}
