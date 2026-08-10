import argon2 from 'argon2';
import { PrismaClient, type Platform } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await argon2.hash('DemoPass!2026');
  const user = await prisma.user.upsert({
    where: { email: 'owner@demo.local' },
    update: { displayName: 'Demo Owner', passwordHash },
    create: {
      id: 'demo-owner',
      email: 'owner@demo.local',
      displayName: 'Demo Owner',
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'demo-workspace' },
    update: { name: 'Demo Workspace' },
    create: {
      id: 'demo-workspace',
      name: 'Demo Workspace',
      slug: 'demo-workspace',
      timezone: 'Asia/Ho_Chi_Minh',
    },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { role: 'OWNER', status: 'ACTIVE' },
    create: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
  });

  const permissionKeys = [
    'workspace.read', 'workspace.manage', 'member.invite', 'account.read', 'account.manage',
    'contact.read', 'contact.manage', 'contact.export', 'message.read', 'message.send',
    'campaign.read', 'campaign.manage', 'campaign.approve', 'post.read', 'post.manage',
    'post.publish', 'proxy.manage', 'audit.read',
  ];
  await prisma.permission.createMany({
    data: permissionKeys.map((key) => ({ key, description: `Allows ${key}` })),
    skipDuplicates: true,
  });

  const platforms: Platform[] = ['ZALO', 'FACEBOOK', 'TIKTOK'];
  for (const [index, platform] of platforms.entries()) {
    await prisma.socialAccount.upsert({
      where: {
        workspaceId_platform_platformAccountId: {
          workspaceId: workspace.id,
          platform,
          platformAccountId: `demo-${platform.toLowerCase()}`,
        },
      },
      update: {},
      create: {
        id: `demo-account-${index + 1}`,
        workspaceId: workspace.id,
        platform,
        platformAccountId: `demo-${platform.toLowerCase()}`,
        displayName: `Demo ${platform}`,
        username: `demo_${platform.toLowerCase()}`,
        status: 'DISCONNECTED',
        lastErrorCode: 'NOT_CONFIGURED',
      },
    });
  }

  await prisma.contact.createMany({
    data: Array.from({ length: 100 }, (_, index) => ({
      id: `demo-contact-${String(index + 1).padStart(3, '0')}`,
      workspaceId: workspace.id,
      platform: platforms[index % platforms.length] ?? 'ZALO',
      platformUserId: `synthetic-user-${index + 1}`,
      displayName: `Demo Contact ${index + 1}`,
      email: `contact${index + 1}@example.invalid`,
      source: 'SYNTHETIC_SEED',
      consentStatus: index % 4 === 0 ? 'OPTED_IN' : index % 9 === 0 ? 'OPTED_OUT' : 'UNKNOWN',
      suppressed: index % 9 === 0,
    })),
    skipDuplicates: true,
  });

  await prisma.tag.createMany({
    data: [
      { id: 'demo-tag-lead', workspaceId: workspace.id, name: 'Lead', color: '#38bdf8' },
      { id: 'demo-tag-vip', workspaceId: workspace.id, name: 'VIP', color: '#fbbf24' },
      { id: 'demo-tag-opted-in', workspaceId: workspace.id, name: 'Opted in', color: '#4ade80' },
    ],
    skipDuplicates: true,
  });

  await prisma.group.createMany({
    data: Array.from({ length: 10 }, (_, index) => ({
      id: `demo-group-${String(index + 1).padStart(2, '0')}`,
      workspaceId: workspace.id,
      accountId: `demo-account-${(index % 3) + 1}`,
      platform: platforms[index % platforms.length] ?? 'ZALO',
      platformGroupId: `synthetic-group-${index + 1}`,
      name: `Demo Group ${index + 1}`,
      memberCount: 10,
      metadata: { synthetic: true },
    })),
    skipDuplicates: true,
  });

  await prisma.conversation.createMany({
    data: Array.from({ length: 20 }, (_, index) => ({
      id: `demo-conversation-${String(index + 1).padStart(2, '0')}`,
      workspaceId: workspace.id,
      accountId: `demo-account-${(index % 3) + 1}`,
      contactId: `demo-contact-${String(index + 1).padStart(3, '0')}`,
      platformConversationId: `synthetic-conversation-${index + 1}`,
      title: `Demo conversation ${index + 1}`,
      lastMessageAt: new Date(Date.now() - index * 60_000),
    })),
    skipDuplicates: true,
  });

  await prisma.message.createMany({
    data: Array.from({ length: 100 }, (_, index) => {
      const conversationNumber = (index % 20) + 1;
      const accountNumber = ((conversationNumber - 1) % 3) + 1;
      const direction = index % 2 === 0 ? 'INBOUND' : 'OUTBOUND';
      return {
        id: `demo-message-${String(index + 1).padStart(3, '0')}`,
        workspaceId: workspace.id,
        conversationId: `demo-conversation-${String(conversationNumber).padStart(2, '0')}`,
        accountId: `demo-account-${accountNumber}`,
        platform: platforms[(accountNumber - 1) % platforms.length] ?? 'ZALO',
        idempotencyKey: `seed-message-${String(index + 1).padStart(3, '0')}`,
        senderId: direction === 'INBOUND' ? `synthetic-user-${conversationNumber}` : `demo-account-${accountNumber}`,
        receiverId: direction === 'INBOUND' ? `demo-account-${accountNumber}` : `synthetic-user-${conversationNumber}`,
        content: `Synthetic demo message ${index + 1}`,
        direction,
        status: direction === 'INBOUND' ? 'READ' : 'DELIVERED',
        timestamp: new Date(Date.now() - index * 120_000),
        metadata: { synthetic: true },
      } as const;
    }),
    skipDuplicates: true,
  });

  await prisma.messageTemplate.createMany({
    data: Array.from({ length: 10 }, (_, index) => ({
      id: `demo-template-${index + 1}`,
      workspaceId: workspace.id,
      name: `Demo Template ${index + 1}`,
      content: `Xin chào {{firstName}}, đây là nội dung mẫu số ${index + 1}.`,
      variables: ['firstName'],
    })),
    skipDuplicates: true,
  });

  await prisma.campaign.createMany({
    data: Array.from({ length: 5 }, (_, index) => ({
      id: `demo-campaign-${index + 1}`,
      workspaceId: workspace.id,
      accountId: `demo-account-${(index % 3) + 1}`,
      templateId: `demo-template-${index + 1}`,
      name: `Demo Campaign ${index + 1}`,
      platform: platforms[index % platforms.length] ?? 'ZALO',
      status: index === 0 ? 'RUNNING' : index === 1 ? 'SCHEDULED' : 'DRAFT',
      promotional: true,
      audienceDefinition: { synthetic: true, consentStatus: 'OPTED_IN' },
      statistics: { queued: 0, sent: 0, failed: 0, blocked: 0 },
    })),
    skipDuplicates: true,
  });

  await prisma.post.createMany({
    data: Array.from({ length: 20 }, (_, index) => ({
      id: `demo-post-${String(index + 1).padStart(2, '0')}`,
      workspaceId: workspace.id,
      accountId: `demo-account-${(index % 3) + 1}`,
      title: `Demo Post ${index + 1}`,
      content: `Synthetic post content ${index + 1}`,
      platform: platforms[index % platforms.length] ?? 'ZALO',
      status: index < 5 ? 'PUBLISHED' : index < 10 ? 'SCHEDULED' : 'DRAFT',
      idempotencyKey: `seed-post-${String(index + 1).padStart(2, '0')}`,
    })),
    skipDuplicates: true,
  });

  await prisma.automation.createMany({
    data: Array.from({ length: 5 }, (_, index) => ({
      id: `demo-automation-${index + 1}`,
      workspaceId: workspace.id,
      name: `Demo Automation ${index + 1}`,
      description: 'Synthetic automation, disabled until an official adapter is configured.',
      status: index === 0 ? 'ACTIVE' : 'DRAFT',
    })),
    skipDuplicates: true,
  });

  console.log('Seeded Demo Workspace with synthetic data only.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
