export const roles = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'] as const;
export type WorkspaceRole = (typeof roles)[number];

export const permissions = [
  'workspace.read',
  'workspace.manage',
  'member.invite',
  'account.read',
  'account.manage',
  'contact.read',
  'contact.manage',
  'contact.export',
  'message.read',
  'message.send',
  'campaign.read',
  'campaign.manage',
  'campaign.approve',
  'post.read',
  'post.manage',
  'post.publish',
  'proxy.manage',
  'audit.read',
] as const;
export type Permission = (typeof permissions)[number];

const matrix: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  OWNER: new Set(permissions),
  ADMIN: new Set(permissions.filter((permission) => permission !== 'workspace.manage')),
  MANAGER: new Set(
    permissions.filter(
      (permission) => !['workspace.manage', 'member.invite', 'proxy.manage'].includes(permission),
    ),
  ),
  OPERATOR: new Set([
    'workspace.read',
    'account.read',
    'contact.read',
    'contact.manage',
    'message.read',
    'message.send',
    'campaign.read',
    'post.read',
  ]),
  VIEWER: new Set([
    'workspace.read',
    'account.read',
    'contact.read',
    'message.read',
    'campaign.read',
    'post.read',
  ]),
};

export function hasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return matrix[role].has(permission);
}
