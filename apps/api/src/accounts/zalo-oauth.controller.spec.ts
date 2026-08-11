import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { normalizeZaloOAuthCallback, ZaloOAuthController } from './zalo-oauth.controller';
import type { ZaloOAuthService } from './zalo-oauth.service';

describe('ZaloOAuthController', () => {
  it('keeps supported callback values and ignores provider-specific extras', () => {
    expect(normalizeZaloOAuthCallback({
      code: 'authorization-code',
      oa_id: 'oa-123',
      oauth_state: 'callback-state',
      scope: 'oa.info',
    })).toEqual({
      code: 'authorization-code',
      oa_id: 'oa-123',
      oauth_state: 'callback-state',
    });
  });

  it('redirects a callback containing extra query parameters instead of rejecting it', async () => {
    const complete = vi.fn().mockResolvedValue('https://app.example.com/accounts/?connection=zalo&status=success');
    const oauth = {
      complete,
      errorRedirect: vi.fn(),
    } as unknown as ZaloOAuthService;
    const redirect = vi.fn();
    const response = { redirect } as unknown as Response;
    const controller = new ZaloOAuthController(oauth);

    await controller.callback({
      code: 'authorization-code',
      oa_id: 'oa-123',
      oauth_state: 'callback-state',
      unexpected_zalo_parameter: 'ignored',
    }, response);

    expect(complete).toHaveBeenCalledWith({
      code: 'authorization-code',
      oa_id: 'oa-123',
      oauth_state: 'callback-state',
    });
    expect(redirect).toHaveBeenCalledWith(303, 'https://app.example.com/accounts/?connection=zalo&status=success');
  });
});
