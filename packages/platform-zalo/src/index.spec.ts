import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZaloAdapter } from './index';

describe('Zalo OAuth v4 adapter', () => {
  beforeEach(() => {
    vi.stubEnv('ZALO_CLIENT_ID', '123456789');
    vi.stubEnv('ZALO_CLIENT_SECRET', 'zalo-secret');
    vi.stubEnv('ZALO_REDIRECT_URI', 'https://api.example.com/api/v1/platforms/zalo/oauth/callback');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('creates a PKCE authorization URL with state', () => {
    const value = new ZaloAdapter().createAuthorizationUrl({ state: 'csrf-state', codeChallenge: 'pkce-challenge' });
    const url = new URL(value);
    expect(url.origin + url.pathname).toBe('https://oauth.zaloapp.com/v4/oa/permission');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: '123456789',
      redirect_uri: 'https://api.example.com/api/v1/platforms/zalo/oauth/callback',
      code_challenge: 'pkce-challenge',
      state: 'csrf-state',
    });
  });

  it('supports a per-request callback URL used to correlate Zalo callbacks', () => {
    const value = new ZaloAdapter().createAuthorizationUrl({
      state: 'csrf-state',
      codeChallenge: 'pkce-challenge',
      redirectUri: 'https://api.example.com/api/v1/platforms/zalo/oauth/callback?oauth_state=callback-state',
    });

    expect(new URL(value).searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/api/v1/platforms/zalo/oauth/callback?oauth_state=callback-state',
    );
  });

  it('exchanges an authorization code without exposing the app secret in the body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-1', refresh_token: 'refresh-1', expires_in: '90000',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new ZaloAdapter().authenticate({ code: 'oauth-code', codeVerifier: 'verifier' });

    expect(result).toEqual({ status: 'SUCCESS', data: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 90_000 } });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('secret_key')).toBe('zalo-secret');
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const body = init?.body as URLSearchParams;
    expect(body.toString()).toContain('grant_type=authorization_code');
    expect(body.toString()).not.toContain('zalo-secret');
  });

  it('normalizes official account information', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: 0,
      message: 'Success',
      data: { oaid: '4462', name: 'OA Demo', oa_alias: 'oa-demo', is_verified: true, num_follower: 42 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const result = await new ZaloAdapter().getAccountInfo({ workspaceId: 'workspace', accountId: 'account', accessToken: 'access-1' });

    expect(result).toEqual({ status: 'SUCCESS', data: { oaid: '4462', name: 'OA Demo', oaAlias: 'oa-demo', isVerified: true, followerCount: 42 } });
  });

  it('sends an advisory text message through the official OA endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: 0,
      message: 'Success',
      data: { message_id: 'message-123', user_id: 'user-456' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new ZaloAdapter().sendMessage(
      { workspaceId: 'workspace', accountId: 'account', accessToken: 'access-1' },
      'user-456',
      'Xin chào',
    );

    expect(result).toEqual({ status: 'SUCCESS', data: { platformMessageId: 'message-123' } });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://openapi.zalo.me/v3.0/oa/message/cs');
    expect(new Headers(init?.headers).get('access_token')).toBe('access-1');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '{}')).toEqual({ recipient: { user_id: 'user-456' }, message: { text: 'Xin chào' } });
  });

  it('does not claim success when Zalo rejects a message', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: -201,
      message: 'Permission denied',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(new ZaloAdapter().sendMessage(
      { workspaceId: 'workspace', accountId: 'account', accessToken: 'access-1' },
      'user-456',
      'Xin chào',
    )).resolves.toEqual({ status: 'FAILED', errorCode: 'ZALO_API_-201', message: 'Permission denied' });
  });
});
