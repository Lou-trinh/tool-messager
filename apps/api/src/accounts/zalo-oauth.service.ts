import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@omni/database';
import type { ZaloOaInfo, ZaloTokenSet } from '@omni/platform-zalo';
import { PrismaService } from '../common/prisma.service';
import { SecretEncryptionService } from '../common/secret-encryption.service';
import { PlatformRegistryService } from '../platforms/platform-registry.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { ZaloOAuthCallbackDto } from './accounts.dto';
import { SubscriptionPolicyService } from '../common/subscription-policy.service';

const stateLifetimeMs = 10 * 60 * 1000;
const refreshThresholdMs = 60 * 60 * 1000;
const managementRoles = ['OWNER', 'ADMIN', 'MANAGER'] as const;

@Injectable()
export class ZaloOAuthService {
  private readonly refreshing = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly platforms: PlatformRegistryService,
    private readonly secrets: SecretEncryptionService,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  async begin(userId: string, workspaceId: string): Promise<{
    authorizationUrl: string;
    callbackUrl: string;
    expiresAt: string;
  }> {
    await this.workspaces.assertMembership(userId, workspaceId, [...managementRoles]);
    const adapter = this.platforms.zalo();
    const callbackUrl = adapter.callbackUrl();
    if (!adapter.isConfigured() || !callbackUrl) {
      throw new ServiceUnavailableException('Zalo OAuth chưa được cấu hình. Cần ZALO_CLIENT_ID, ZALO_CLIENT_SECRET và ZALO_REDIRECT_URI.');
    }

    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
    const expiresAt = new Date(Date.now() + stateLifetimeMs);
    const correlatedCallbackUrl = new URL(callbackUrl);
    correlatedCallbackUrl.searchParams.set('oauth_state', state);

    await this.prisma.$transaction([
      this.prisma.platformOAuthState.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { usedAt: { not: null }, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          ],
        },
      }),
      this.prisma.platformOAuthState.create({
        data: {
          platform: 'ZALO',
          stateHash: this.hash(state),
          encryptedCodeVerifier: this.secrets.encrypt(codeVerifier),
          redirectUri: callbackUrl,
          workspaceId,
          userId,
          expiresAt,
        },
      }),
    ]);

    return {
      authorizationUrl: adapter.createAuthorizationUrl({
        state,
        codeChallenge,
        redirectUri: correlatedCallbackUrl.toString(),
      }),
      callbackUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(input: ZaloOAuthCallbackDto): Promise<string> {
    if (input.error) throw new BadRequestException(input.error_description ?? input.error);
    const callbackState = input.state ?? input.oauth_state;
    if (!input.code || !callbackState) throw new BadRequestException('Zalo callback thiếu authorization code hoặc mã phiên OAuth.');

    const oauthState = await this.prisma.platformOAuthState.findFirst({
      where: { platform: 'ZALO', stateHash: this.hash(callbackState), usedAt: null },
    });
    if (!oauthState || oauthState.expiresAt <= new Date()) throw new BadRequestException('Phiên kết nối Zalo đã hết hạn hoặc không hợp lệ.');
    if (oauthState.redirectUri !== this.platforms.zalo().callbackUrl()) throw new BadRequestException('Zalo callback URL không khớp cấu hình.');

    const claimed = await this.prisma.platformOAuthState.updateMany({
      where: { id: oauthState.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new BadRequestException('Phiên kết nối Zalo đã được sử dụng.');

    const tokenResult = await this.platforms.zalo().authenticate({
      code: input.code,
      codeVerifier: this.secrets.decrypt(oauthState.encryptedCodeVerifier),
    });
    if (tokenResult.status !== 'SUCCESS' || !tokenResult.data) {
      throw new ServiceUnavailableException(tokenResult.message ?? 'Không thể đổi Zalo authorization code lấy token.');
    }

    const infoResult = await this.platforms.zalo().getAccountInfo({
      workspaceId: oauthState.workspaceId,
      accountId: input.oa_id ?? 'pending',
      accessToken: tokenResult.data.accessToken,
    });
    if (infoResult.status !== 'SUCCESS' || !infoResult.data) {
      throw new ServiceUnavailableException(infoResult.message ?? 'Không thể đọc thông tin Zalo OA.');
    }
    if (input.oa_id && input.oa_id !== infoResult.data.oaid) throw new BadRequestException('Zalo OA ID trong callback không khớp access token.');

    const accountId = await this.saveConnectedAccount(
      oauthState.workspaceId,
      oauthState.userId,
      infoResult.data,
      tokenResult.data,
    );
    return this.redirectUrl({ status: 'success', accountId });
  }

  async refreshAccount(userId: string, workspaceId: string, accountId: string): Promise<void> {
    await this.workspaces.assertMembership(userId, workspaceId, [...managementRoles, 'OPERATOR']);
    await this.refresh(accountId, workspaceId, userId, true);
  }

  async refreshExpiringForWorkspace(userId: string, workspaceId: string): Promise<void> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        workspaceId,
        platform: 'ZALO',
        status: 'CONNECTED',
        deletedAt: null,
        tokenExpiresAt: { lte: new Date(Date.now() + refreshThresholdMs) },
        credential: { isNot: null },
      },
      select: { id: true },
    });
    await Promise.allSettled(accounts.map((account) => this.refresh(account.id, workspaceId, userId, false)));
  }

  errorRedirect(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Kết nối Zalo OA thất bại.';
    return this.redirectUrl({ status: 'error', reason: message.slice(0, 240) });
  }

  private async refresh(accountId: string, workspaceId: string, userId: string, force: boolean): Promise<void> {
    const existing = this.refreshing.get(accountId);
    if (existing) return existing;
    const task = this.doRefresh(accountId, workspaceId, userId, force).finally(() => this.refreshing.delete(accountId));
    this.refreshing.set(accountId, task);
    return task;
  }

  private async doRefresh(accountId: string, workspaceId: string, userId: string, force: boolean): Promise<void> {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id: accountId, workspaceId, platform: 'ZALO', deletedAt: null },
      include: { credential: true },
    });
    if (!account?.credential) throw new NotFoundException('Không tìm thấy credential của tài khoản Zalo OA.');
    if (!force && account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() + refreshThresholdMs) return;
    if (!account.credential.encryptedRefreshToken) throw new BadRequestException('Tài khoản Zalo OA không có refresh token.');

    const result = await this.platforms.zalo().refreshAccessToken(
      this.secrets.decrypt(account.credential.encryptedRefreshToken),
    );
    if (result.status !== 'SUCCESS' || !result.data) {
      await this.prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: 'REAUTH_REQUIRED', lastErrorCode: result.errorCode ?? 'ZALO_REFRESH_FAILED' },
      });
      throw new ServiceUnavailableException(result.message ?? 'Không thể làm mới Zalo access token.');
    }

    await this.prisma.$transaction([
      this.prisma.platformCredential.update({
        where: { accountId: account.id },
        data: {
          encryptedAccessToken: this.secrets.encrypt(result.data.accessToken),
          encryptedRefreshToken: this.secrets.encrypt(result.data.refreshToken),
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          status: 'CONNECTED',
          tokenExpiresAt: new Date(Date.now() + result.data.expiresIn * 1000),
          lastErrorCode: null,
        },
      }),
      this.prisma.auditLog.create({
        data: { workspaceId, userId, action: 'ZALO_TOKEN_REFRESHED', resource: 'SocialAccount', resourceId: account.id, result: 'SUCCESS' },
      }),
    ]);
  }

  private async saveConnectedAccount(workspaceId: string, userId: string, info: ZaloOaInfo, tokens: ZaloTokenSet): Promise<string> {
    const existing = await this.prisma.socialAccount.findUnique({ where: { workspaceId_platform_platformAccountId: { workspaceId, platform: 'ZALO', platformAccountId: info.oaid } }, select: { id: true } });
    if (!existing) await this.policy.assertAccountCapacity(workspaceId);
    return this.prisma.$transaction(async (tx) => {
      const metadata = {
        ...(info.description ? { description: info.description } : {}),
        ...(info.cover ? { cover: info.cover } : {}),
        ...(info.isVerified !== undefined ? { isVerified: info.isVerified } : {}),
        ...(info.oaType !== undefined ? { oaType: info.oaType } : {}),
        ...(info.categoryName ? { categoryName: info.categoryName } : {}),
        ...(info.followerCount !== undefined ? { followerCount: info.followerCount } : {}),
        ...(info.packageName ? { packageName: info.packageName } : {}),
        ...(info.packageValidThroughDate ? { packageValidThroughDate: info.packageValidThroughDate } : {}),
        ...(info.packageAutoRenewDate ? { packageAutoRenewDate: info.packageAutoRenewDate } : {}),
        ...(info.linkedZca ? { linkedZca: info.linkedZca } : {}),
      } satisfies Prisma.InputJsonObject;
      const account = await tx.socialAccount.upsert({
        where: { workspaceId_platform_platformAccountId: { workspaceId, platform: 'ZALO', platformAccountId: info.oaid } },
        update: {
          displayName: info.name,
          username: info.oaAlias ?? null,
          avatarUrl: info.avatar ?? null,
          status: 'CONNECTED',
          tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
          lastErrorCode: null,
          deletedAt: null,
          metadata,
        },
        create: {
          workspaceId,
          platform: 'ZALO',
          platformAccountId: info.oaid,
          displayName: info.name,
          ...(info.oaAlias ? { username: info.oaAlias } : {}),
          ...(info.avatar ? { avatarUrl: info.avatar } : {}),
          status: 'CONNECTED',
          tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
          metadata,
        },
      });
      await tx.platformCredential.upsert({
        where: { accountId: account.id },
        update: {
          encryptedAccessToken: this.secrets.encrypt(tokens.accessToken),
          encryptedRefreshToken: this.secrets.encrypt(tokens.refreshToken),
          tokenVersion: { increment: 1 },
        },
        create: {
          accountId: account.id,
          encryptedAccessToken: this.secrets.encrypt(tokens.accessToken),
          encryptedRefreshToken: this.secrets.encrypt(tokens.refreshToken),
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId,
          userId,
          action: 'ZALO_OA_CONNECTED',
          resource: 'SocialAccount',
          resourceId: account.id,
          result: 'SUCCESS',
          metadata: { oaid: info.oaid, name: info.name },
        },
      });
      return account.id;
    });
  }

  private redirectUrl(params: Record<string, string>): string {
    const configured = process.env.FRONTEND_URL?.trim() || process.env.APP_URL?.split(',')[0]?.trim() || 'http://localhost:3000';
    const base = configured.endsWith('/') ? configured : `${configured}/`;
    const url = new URL('accounts/', base);
    url.searchParams.set('connection', 'zalo');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
