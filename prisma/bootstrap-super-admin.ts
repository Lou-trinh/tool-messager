import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  if (!email && !password) return;
  if (!email || !password) throw new Error('Both BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_PASSWORD are required.');
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z\d]/.test(password)) {
    throw new Error('BOOTSTRAP_SUPER_ADMIN_PASSWORD must contain at least 12 characters, including upper, lower, number and symbol.');
  }
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { systemRole: 'SUPER_ADMIN' } })
    : await prisma.user.create({ data: { email, displayName: process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim() || 'Platform Administrator', passwordHash: await argon2.hash(password), systemRole: 'SUPER_ADMIN' } });
  const membership = await prisma.workspaceMember.findFirst({ where: { userId: user.id, status: 'ACTIVE' }, select: { id: true } });
  if (!membership) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'ENTERPRISE' } });
    const suffix = user.id.slice(-8).toLowerCase();
    await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data: { name: 'Platform Administration', slug: `platform-admin-${suffix}`, status: 'ACTIVE' } });
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' } });
      await tx.subscription.create({ data: { workspaceId: workspace.id, planId: plan.id, status: 'ACTIVE', startAt: new Date(), endAt: new Date('2099-12-31T23:59:59.000Z') } });
      await tx.auditLog.create({ data: { workspaceId: workspace.id, userId: user.id, action: 'SUPER_ADMIN_BOOTSTRAPPED', resource: 'User', resourceId: user.id, result: 'SUCCESS' } });
    });
  }
  console.log(`SUPER_ADMIN ready: ${email}`);
}

void main().finally(async () => prisma.$disconnect());
