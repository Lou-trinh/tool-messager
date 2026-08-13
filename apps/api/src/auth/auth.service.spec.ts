import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../common/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService refresh-token security', () => {
  it('revokes an entire token family when a rotated refresh token is reused', async () => {
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough';
    const updateMany = vi.fn<(args: { where: { userId: string; familyId: string }; data: { revokedAt: Date; reuseDetectedAt: Date } }) => Promise<{ count: number }>>().mockResolvedValue({ count: 2 });
    const auditCreate = vi.fn<(args: { data: { action: string; result: string } }) => Promise<{ id: string }>>().mockResolvedValue({ id: 'audit-1' });
    const prisma = {
      refreshToken: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'refresh-1',
          userId: 'user-1',
          familyId: 'family-1',
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany,
      },
      auditLog: { create: auditCreate },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    } as unknown as PrismaService;
    const jwt = { verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1', email: 'user@example.com', type: 'refresh' }) } as unknown as JwtService;
    const service = new AuthService(prisma, jwt);

    await expect(service.refresh('already-used-token', { ipHash: 'ip-hash' })).rejects.toBeInstanceOf(UnauthorizedException);
    const familyRevocation = updateMany.mock.calls[0]?.[0];
    expect(familyRevocation?.where).toEqual({ userId: 'user-1', familyId: 'family-1' });
    expect(familyRevocation?.data.reuseDetectedAt).toBeInstanceOf(Date);
    const audit = auditCreate.mock.calls[0]?.[0];
    expect(audit?.data.action).toBe('REFRESH_TOKEN_REUSE_DETECTED');
    expect(audit?.data.result).toBe('DENIED');
  });
});
