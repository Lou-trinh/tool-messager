import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../common/prisma.service';
import type { QueueService } from '../common/queue.service';
import { ZaloWebhookService, type ZaloWebhookPayload } from './zalo-webhook.service';

describe('ZaloWebhookService', () => {
  const originalClientId = process.env.ZALO_CLIENT_ID;
  const originalClientSecret = process.env.ZALO_CLIENT_SECRET;
  const originalSecret = process.env.ZALO_OA_SECRET_KEY;
  const originalSetupMode = process.env.ZALO_WEBHOOK_SETUP_MODE;

  beforeEach(() => {
    process.env.ZALO_CLIENT_ID = 'zalo-app-1';
    process.env.ZALO_OA_SECRET_KEY = 'oa-secret';
  });

  afterEach(() => {
    process.env.ZALO_CLIENT_ID = originalClientId;
    process.env.ZALO_CLIENT_SECRET = originalClientSecret;
    process.env.ZALO_OA_SECRET_KEY = originalSecret;
    process.env.ZALO_WEBHOOK_SETUP_MODE = originalSetupMode;
    vi.restoreAllMocks();
  });

  it('acknowledges an unsigned Zalo reachability probe without configuration or side effects', async () => {
    delete process.env.ZALO_CLIENT_ID;
    delete process.env.ZALO_OA_SECRET_KEY;
    const queueAdd = vi.fn();
    const service = new ZaloWebhookService({} as PrismaService, { add: queueAdd } as unknown as QueueService);

    await expect(service.accept(Buffer.from('{}'), undefined, {})).resolves.toEqual({ accepted: true, probe: true });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('uses the existing Zalo app secret when no separate OA secret is configured', async () => {
    delete process.env.ZALO_OA_SECRET_KEY;
    process.env.ZALO_CLIENT_SECRET = 'app-secret';
    const payload: ZaloWebhookPayload = { app_id: 'zalo-app-1', oa_id: 'oa-1', event_name: 'user_send_text', timestamp: Date.now(), message: { msg_id: 'message-2' } };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = `mac=${createHash('sha256').update(`zalo-app-1${rawBody.toString('utf8')}${payload.timestamp}app-secret`).digest('hex')}`;
    const prisma = {
      socialAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'account-1', workspaceId: 'tenant-1' }) },
      backgroundJob: { findUnique: vi.fn().mockResolvedValue({ id: 'job-1' }) },
    } as unknown as PrismaService;
    const service = new ZaloWebhookService(prisma, { add: vi.fn() } as unknown as QueueService);

    await expect(service.accept(rawBody, signature, payload)).resolves.toEqual({ accepted: true, duplicate: true });
  });

  it('rejects a webhook whose Zalo signature is invalid', async () => {
    const service = new ZaloWebhookService({} as PrismaService, {} as QueueService);
    const payload: ZaloWebhookPayload = { app_id: 'zalo-app-1', oa_id: 'oa-1', event_name: 'user_send_text', timestamp: Date.now() };
    const rawBody = Buffer.from(JSON.stringify(payload));
    await expect(service.accept(rawBody, 'mac=invalid', payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('acknowledges but never persists an invalid setup probe while setup mode is explicitly enabled', async () => {
    process.env.ZALO_WEBHOOK_SETUP_MODE = 'true';
    const prisma = { socialAccount: { findFirst: vi.fn() } } as unknown as PrismaService;
    const queueAdd = vi.fn();
    const service = new ZaloWebhookService(prisma, { add: queueAdd } as unknown as QueueService);
    const payload: ZaloWebhookPayload = { app_id: 'zalo-app-1', oa_id: 'oa-1', event_name: 'user_send_text', timestamp: Date.now() };
    const rawBody = Buffer.from(JSON.stringify(payload));

    await expect(service.accept(rawBody, 'mac=invalid', payload)).resolves.toEqual({ accepted: true, probe: true });
    expect(prisma.socialAccount.findFirst).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('accepts a correctly signed duplicate without queueing it twice', async () => {
    const payload: ZaloWebhookPayload = { app_id: 'zalo-app-1', oa_id: 'oa-1', event_name: 'user_send_text', timestamp: Date.now(), message: { msg_id: 'message-1' } };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = `mac=${createHash('sha256').update(`zalo-app-1${rawBody.toString('utf8')}${payload.timestamp}oa-secret`).digest('hex')}`;
    const prisma = {
      socialAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'account-1', workspaceId: 'tenant-1' }) },
      backgroundJob: { findUnique: vi.fn().mockResolvedValue({ id: 'job-1' }) },
    } as unknown as PrismaService;
    const queueAdd = vi.fn();
    const queue = { add: queueAdd } as unknown as QueueService;
    const service = new ZaloWebhookService(prisma, queue);

    await expect(service.accept(rawBody, signature, payload)).resolves.toEqual({ accepted: true, duplicate: true });
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
