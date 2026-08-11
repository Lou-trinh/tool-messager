import {
  OfficialApiAdapter,
  type AdapterContext,
  type CapabilityMatrix,
  type PlatformOperationResult,
} from '@omni/platform-core';

const authorizeEndpoint = 'https://oauth.zaloapp.com/v4/oa/permission';
const tokenEndpoint = 'https://oauth.zaloapp.com/v4/oa/access_token';
const oaInfoEndpoint = 'https://openapi.zalo.me/v2.0/oa/getoa';

export interface ZaloTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ZaloOaInfo {
  oaid: string;
  name: string;
  oaAlias?: string;
  avatar?: string;
  cover?: string;
  description?: string;
  isVerified?: boolean;
  oaType?: number;
  categoryName?: string;
  followerCount?: number;
  packageName?: string;
  packageValidThroughDate?: string;
  packageAutoRenewDate?: string;
  linkedZca?: string;
}

interface ZaloTokenPayload {
  access_token?: string;
  refresh_token?: string;
  expires_in?: string | number;
  error?: number | string;
  error_name?: string;
  error_description?: string;
  message?: string;
}

interface ZaloEnvelope<T> {
  data?: T;
  error?: number;
  message?: string;
}

interface ZaloRawOaInfo {
  oaid?: string | number;
  oa_id?: string | number;
  name?: string;
  oa_alias?: string;
  avatar?: string;
  cover?: string;
  description?: string;
  is_verified?: boolean;
  oa_type?: number;
  cate_name?: string;
  num_follower?: number;
  package_name?: string;
  package_valid_through_date?: string;
  package_auto_renew_date?: string;
  linked_ZCA?: string;
  linked_zca?: string;
}

export class ZaloAdapter extends OfficialApiAdapter {
  readonly platform = 'ZALO' as const;
  protected readonly matrix: CapabilityMatrix = {
    AUTHENTICATE: 'SUPPORTED',
    CONTACTS: 'PERMISSION_REQUIRED',
    FRIENDS: 'NOT_SUPPORTED',
    GROUPS: 'PERMISSION_REQUIRED',
    GROUP_MEMBERS: 'PERMISSION_REQUIRED',
    MESSAGING: 'SUPPORTED',
    MEDIA: 'SUPPORTED',
    POST_CREATE: 'PERMISSION_REQUIRED',
    POST_UPDATE: 'PERMISSION_REQUIRED',
    POST_DELETE: 'PERMISSION_REQUIRED',
    MESSAGE_HISTORY: 'PERMISSION_REQUIRED',
    GROUP_CREATE: 'NOT_SUPPORTED',
    GROUP_MEMBER_MANAGE: 'PERMISSION_REQUIRED',
    ANALYTICS: 'PERMISSION_REQUIRED',
  };

  protected configured(): boolean {
    return Boolean(
      process.env.ZALO_CLIENT_ID
      && process.env.ZALO_CLIENT_SECRET
      && process.env.ZALO_REDIRECT_URI,
    );
  }

  callbackUrl(): string | null {
    return process.env.ZALO_REDIRECT_URI?.trim() || null;
  }

  createAuthorizationUrl(input: { state: string; codeChallenge: string; redirectUri?: string }): string {
    const appId = process.env.ZALO_CLIENT_ID?.trim();
    const redirectUri = input.redirectUri?.trim() || this.callbackUrl();
    if (!appId || !redirectUri) throw new Error('Zalo OAuth is not configured.');
    const url = new URL(authorizeEndpoint);
    url.searchParams.set('app_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  override async authenticate(input: Readonly<Record<string, string>>): Promise<PlatformOperationResult<ZaloTokenSet>> {
    if (!this.configured()) return this.unavailable('AUTHENTICATE');
    const code = input.code;
    const codeVerifier = input.codeVerifier;
    if (!code || !codeVerifier) {
      return { status: 'FAILED', errorCode: 'ZALO_OAUTH_INPUT_INVALID', message: 'Authorization code and PKCE verifier are required.' };
    }
    return this.requestTokens({ code, code_verifier: codeVerifier, grant_type: 'authorization_code' });
  }

  async refreshAccessToken(refreshToken: string): Promise<PlatformOperationResult<ZaloTokenSet>> {
    if (!this.configured()) return this.unavailable('AUTHENTICATE');
    if (!refreshToken) return { status: 'FAILED', errorCode: 'ZALO_REFRESH_TOKEN_MISSING', message: 'Zalo refresh token is missing.' };
    return this.requestTokens({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  }

  override async getAccountInfo(context: AdapterContext): Promise<PlatformOperationResult<ZaloOaInfo>> {
    if (!this.configured()) return this.unavailable('AUTHENTICATE');
    if (!context.accessToken) return { status: 'FAILED', errorCode: 'ZALO_ACCESS_TOKEN_MISSING', message: 'Zalo access token is missing.' };
    try {
      const response = await fetch(oaInfoEndpoint, {
        headers: { access_token: context.accessToken, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await this.json<ZaloEnvelope<ZaloRawOaInfo>>(response);
      if (!response.ok || payload.error !== 0 || !payload.data) {
        return {
          status: 'FAILED',
          errorCode: `ZALO_API_${String(payload.error ?? response.status)}`,
          message: payload.message ?? 'Unable to read Zalo OA information.',
        };
      }
      const raw = payload.data;
      const oaid = raw.oaid ?? raw.oa_id;
      if (!oaid || !raw.name) return { status: 'FAILED', errorCode: 'ZALO_OA_RESPONSE_INVALID', message: 'Zalo OA information response is incomplete.' };
      return {
        status: 'SUCCESS',
        data: {
          oaid: String(oaid),
          name: raw.name,
          ...(raw.oa_alias ? { oaAlias: raw.oa_alias } : {}),
          ...(raw.avatar ? { avatar: raw.avatar } : {}),
          ...(raw.cover ? { cover: raw.cover } : {}),
          ...(raw.description ? { description: raw.description } : {}),
          ...(raw.is_verified !== undefined ? { isVerified: raw.is_verified } : {}),
          ...(raw.oa_type !== undefined ? { oaType: raw.oa_type } : {}),
          ...(raw.cate_name ? { categoryName: raw.cate_name } : {}),
          ...(raw.num_follower !== undefined ? { followerCount: raw.num_follower } : {}),
          ...(raw.package_name ? { packageName: raw.package_name } : {}),
          ...(raw.package_valid_through_date ? { packageValidThroughDate: raw.package_valid_through_date } : {}),
          ...(raw.package_auto_renew_date ? { packageAutoRenewDate: raw.package_auto_renew_date } : {}),
          ...(raw.linked_ZCA || raw.linked_zca ? { linkedZca: raw.linked_ZCA ?? raw.linked_zca } : {}),
        },
      };
    } catch (error) {
      return this.networkFailure(error, 'ZALO_OA_REQUEST_FAILED');
    }
  }

  private async requestTokens(fields: Record<string, string>): Promise<PlatformOperationResult<ZaloTokenSet>> {
    const appId = process.env.ZALO_CLIENT_ID?.trim();
    const secret = process.env.ZALO_CLIENT_SECRET?.trim();
    if (!appId || !secret) return this.unavailable('AUTHENTICATE');
    try {
      const body = new URLSearchParams({ ...fields, app_id: appId });
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          secret_key: secret,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await this.json<ZaloTokenPayload>(response);
      if (!response.ok || payload.error !== undefined || !payload.access_token || !payload.refresh_token) {
        return {
          status: 'FAILED',
          errorCode: `ZALO_OAUTH_${String(payload.error_name ?? payload.error ?? response.status)}`,
          message: payload.error_description ?? payload.message ?? 'Zalo rejected the OAuth token request.',
        };
      }
      const expiresIn = Number(payload.expires_in);
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
        return { status: 'FAILED', errorCode: 'ZALO_TOKEN_RESPONSE_INVALID', message: 'Zalo returned an invalid token lifetime.' };
      }
      return {
        status: 'SUCCESS',
        data: {
          accessToken: payload.access_token,
          refreshToken: payload.refresh_token,
          expiresIn,
        },
      };
    } catch (error) {
      return this.networkFailure(error, 'ZALO_OAUTH_REQUEST_FAILED');
    }
  }

  private async json<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      return {} as T;
    }
  }

  private networkFailure<T>(error: unknown, code: string): PlatformOperationResult<T> {
    const message = error instanceof Error ? error.message : 'Zalo request failed.';
    return { status: 'FAILED', errorCode: code, message };
  }
}
