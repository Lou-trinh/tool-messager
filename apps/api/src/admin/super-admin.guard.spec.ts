import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SuperAdminGuard } from './super-admin.guard';

function context(systemRole: 'SUPER_ADMIN' | 'USER'): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user-1', email: 'user@example.com', systemRole } }) }) } as unknown as ExecutionContext;
}

describe('SuperAdminGuard', () => {
  it('allows SUPER_ADMIN', () => expect(new SuperAdminGuard().canActivate(context('SUPER_ADMIN'))).toBe(true));
  it('denies tenant users', () => expect(() => new SuperAdminGuard().canActivate(context('USER'))).toThrow(ForbiddenException));
});
