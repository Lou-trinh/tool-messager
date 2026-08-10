import { describe, expect, it } from 'vitest';
import { hasPermission, permissions } from './index';

describe('workspace RBAC', () => {
  it('gives owners all declared permissions', () => {
    for (const permission of permissions) expect(hasPermission('OWNER', permission)).toBe(true);
  });

  it('does not allow operators to manage billing or workspace members', () => {
    expect(hasPermission('OPERATOR', 'workspace.manage')).toBe(false);
    expect(hasPermission('OPERATOR', 'member.invite')).toBe(false);
  });

  it('keeps viewers read-only', () => {
    expect(hasPermission('VIEWER', 'contact.read')).toBe(true);
    expect(hasPermission('VIEWER', 'message.send')).toBe(false);
  });
});
