import { describe, expect, it } from 'vitest';
import type { CapabilityMatrix } from './index';
import { OfficialApiAdapter } from './index';

const unsupported = Object.fromEntries(['AUTHENTICATE', 'CONTACTS', 'FRIENDS', 'GROUPS', 'GROUP_MEMBERS', 'MESSAGING', 'MEDIA', 'POST_CREATE', 'POST_UPDATE', 'POST_DELETE', 'MESSAGE_HISTORY', 'GROUP_CREATE', 'GROUP_MEMBER_MANAGE', 'ANALYTICS'].map((key) => [key, 'NOT_SUPPORTED'])) as CapabilityMatrix;

class TestAdapter extends OfficialApiAdapter {
  readonly platform = 'ZALO' as const;
  protected readonly matrix = unsupported;
  constructor(private readonly ready: boolean) { super(); }
  protected configured(): boolean { return this.ready; }
}

describe('official adapter fallback', () => {
  it('returns NOT_CONFIGURED without platform credentials', async () => {
    const result = await new TestAdapter(false).sendMessage({ workspaceId: 'workspace', accountId: 'account' }, 'recipient', 'hello');
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.errorCode).toBe('PLATFORM_NOT_CONFIGURED');
  });

  it('returns NOT_SUPPORTED instead of simulating success', async () => {
    const result = await new TestAdapter(true).createPost({ workspaceId: 'workspace', accountId: 'account' }, {});
    expect(result.status).toBe('NOT_SUPPORTED');
    expect(result.data).toBeUndefined();
  });
});
