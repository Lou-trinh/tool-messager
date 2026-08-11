import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ZaloOAuthCallbackDto } from './accounts.dto';
import { ZaloOAuthService } from './zalo-oauth.service';

function queryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string');
  return undefined;
}

export function normalizeZaloOAuthCallback(query: Record<string, unknown>): ZaloOAuthCallbackDto {
  const code = queryString(query.code);
  const oaId = queryString(query.oa_id);
  const state = queryString(query.state);
  const oauthState = queryString(query.oauth_state);
  const error = queryString(query.error);
  const errorDescription = queryString(query.error_description);

  return {
    ...(code ? { code } : {}),
    ...(oaId ? { oa_id: oaId } : {}),
    ...(state ? { state } : {}),
    ...(oauthState ? { oauth_state: oauthState } : {}),
    ...(error ? { error } : {}),
    ...(errorDescription ? { error_description: errorDescription } : {}),
  };
}

@Controller('platforms/zalo/oauth')
export class ZaloOAuthController {
  constructor(private readonly oauth: ZaloOAuthService) {}

  @Get('callback')
  async callback(@Query() query: Record<string, unknown>, @Res() response: Response): Promise<void> {
    try {
      response.redirect(303, await this.oauth.complete(normalizeZaloOAuthCallback(query)));
    } catch (error) {
      response.redirect(303, this.oauth.errorRedirect(error));
    }
  }
}
