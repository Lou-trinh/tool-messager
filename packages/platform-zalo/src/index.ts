import { OfficialApiAdapter, type CapabilityMatrix } from '@omni/platform-core';

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
    return Boolean(process.env.ZALO_CLIENT_ID && process.env.ZALO_CLIENT_SECRET);
  }
}
