import { OfficialApiAdapter, type CapabilityMatrix } from '@omni/platform-core';

export class TikTokAdapter extends OfficialApiAdapter {
  readonly platform = 'TIKTOK' as const;
  protected readonly matrix: CapabilityMatrix = {
    AUTHENTICATE: 'SUPPORTED',
    CONTACTS: 'NOT_SUPPORTED',
    FRIENDS: 'NOT_SUPPORTED',
    GROUPS: 'NOT_SUPPORTED',
    GROUP_MEMBERS: 'NOT_SUPPORTED',
    MESSAGING: 'NOT_SUPPORTED',
    MEDIA: 'PERMISSION_REQUIRED',
    POST_CREATE: 'PERMISSION_REQUIRED',
    POST_UPDATE: 'NOT_SUPPORTED',
    POST_DELETE: 'PERMISSION_REQUIRED',
    MESSAGE_HISTORY: 'NOT_SUPPORTED',
    GROUP_CREATE: 'NOT_SUPPORTED',
    GROUP_MEMBER_MANAGE: 'NOT_SUPPORTED',
    ANALYTICS: 'PERMISSION_REQUIRED',
  };

  protected configured(): boolean {
    return Boolean(process.env.TIKTOK_CLIENT_ID && process.env.TIKTOK_CLIENT_SECRET);
  }
}
