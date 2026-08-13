import { Body, Controller, Headers, HttpCode, HttpStatus, Post, RawBodyRequest, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ZaloWebhookService, type ZaloWebhookPayload } from './zalo-webhook.service';

@Controller('platforms/zalo/webhook')
export class ZaloWebhookController {
  constructor(private readonly webhooks: ZaloWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  async receive(@Req() request: RawBodyRequest<Request>, @Headers('x-zevent-signature') signature: string | undefined, @Body() body: ZaloWebhookPayload): Promise<unknown> {
    return { success: true, data: await this.webhooks.accept(request.rawBody, signature, body) };
  }
}
