import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { queues } from '@omni/queue';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';

export type ZaloWebhookPayload = {
  app_id?: string | number;
  oa_id?: string | number;
  event_name?: string;
  timestamp?: string | number;
  sender?: { id?: string | number };
  recipient?: { id?: string | number };
  message?: { msg_id?: string | number };
};

@Injectable()
export class ZaloWebhookService {
  constructor(private readonly prisma: PrismaService, private readonly queue: QueueService) {}

  async accept(rawBody: Buffer | undefined, signature: string | undefined, payload: ZaloWebhookPayload): Promise<{ accepted: true; duplicate?: true; probe?: true }> {
    // Zalo Developers checks reachability with an unsigned POST before it lets an
    // operator save the webhook URL. Acknowledge that probe without persisting or
    // queueing anything; every actual event below still requires a valid signature.
    if (!signature) return { accepted: true, probe: true };
    const secret = process.env.ZALO_OA_SECRET_KEY?.trim();
    const appId = process.env.ZALO_CLIENT_ID?.trim();
    if (!secret || !appId) throw new ServiceUnavailableException('ZALO_OA_SECRET_KEY or ZALO_CLIENT_ID is NOT_CONFIGURED.');
    if (!rawBody?.length || !signature || !payload.app_id || !payload.timestamp || !payload.event_name) throw new BadRequestException('Invalid Zalo webhook envelope.');
    if (String(payload.app_id) !== appId) throw new UnauthorizedException('Zalo webhook app_id mismatch.');
    const timestamp = Number(payload.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 10 * 60_000) throw new UnauthorizedException('Zalo webhook timestamp is outside the replay window.');
    const expected = `mac=${createHash('sha256').update(`${appId}${rawBody.toString('utf8')}${String(payload.timestamp)}${secret}`).digest('hex')}`;
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throw new UnauthorizedException('Invalid Zalo webhook signature.');
    const oaId = payload.oa_id ?? (payload.event_name.startsWith('user_') ? payload.recipient?.id : payload.sender?.id);
    if (!oaId) throw new BadRequestException('Zalo webhook does not identify its OA.');
    const account = await this.prisma.socialAccount.findFirst({ where: { platform: 'ZALO', platformAccountId: String(oaId), deletedAt: null }, select: { id: true, workspaceId: true } });
    if (!account) throw new BadRequestException('Zalo OA is not connected to this platform.');
    const eventKey = String(payload.message?.msg_id ?? `${payload.event_name}:${payload.timestamp}`);
    const externalId = `zalo-webhook-${account.id}-${createHash('sha256').update(eventKey).digest('hex').slice(0, 32)}`;
    if (await this.prisma.backgroundJob.findUnique({ where: { externalId }, select: { id: true } })) return { accepted: true, duplicate: true };
    const event = await this.prisma.$transaction(async (tx) => {
      const webhook = await tx.webhookEvent.create({ data: { workspaceId: account.workspaceId, direction: 'INBOUND', eventType: payload.event_name!, payload, signature, status: 'PENDING' } });
      await tx.backgroundJob.create({ data: { workspaceId: account.workspaceId, queue: queues.webhookProcess, externalId, type: 'ZALO_WEBHOOK', payload: { eventId: webhook.id, accountId: account.id } } });
      return webhook;
    });
    await this.queue.add(queues.webhookProcess, 'zalo-webhook', { eventId: event.id, accountId: account.id }, externalId);
    return { accepted: true };
  }
}
