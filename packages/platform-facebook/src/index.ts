import { OfficialApiAdapter, type CapabilityMatrix } from '@omni/platform-core';

export class FacebookAdapter extends OfficialApiAdapter {
  readonly platform = 'FACEBOOK' as const;
  protected readonly matrix: CapabilityMatrix = {
    AUTHENTICATE: 'SUPPORTED',
    CONTACTS: 'PERMISSION_REQUIRED',
    FRIENDS: 'NOT_SUPPORTED',
    GROUPS: 'PERMISSION_REQUIRED',
    GROUP_MEMBERS: 'NOT_SUPPORTED',
    MESSAGING: 'PERMISSION_REQUIRED',
    MEDIA: 'PERMISSION_REQUIRED',
    POST_CREATE: 'PERMISSION_REQUIRED',
    POST_UPDATE: 'PERMISSION_REQUIRED',
    POST_DELETE: 'PERMISSION_REQUIRED',
    MESSAGE_HISTORY: 'PERMISSION_REQUIRED',
    GROUP_CREATE: 'NOT_SUPPORTED',
    GROUP_MEMBER_MANAGE: 'NOT_SUPPORTED',
    ANALYTICS: 'PERMISSION_REQUIRED',
  };

  protected configured(): boolean {
    return Boolean(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET);
  }
}
