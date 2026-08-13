import { describe, expect, it } from 'vitest';
import {
  evaluateMessageSafety,
  subscriptionDaysRemaining,
  subscriptionLifecycleStatus,
  subscriptionNotificationKey,
  subscriptionWarningThreshold,
  type SafetyContext,
} from './index';

const safeContext: SafetyContext = {
  consentStatus: 'OPTED_IN',
  suppressed: false,
  hasPermission: true,
  capability: 'SUPPORTED',
  withinRateLimit: true,
  promotional: true,
};

describe('evaluateMessageSafety', () => {
  it('allows a consented and supported message', () => {
    expect(evaluateMessageSafety(safeContext)).toEqual({ allowed: true, code: 'ALLOWED' });
  });

  it('blocks promotional communication without consent', () => {
    const result = evaluateMessageSafety({ ...safeContext, consentStatus: 'UNKNOWN' });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('CONSENT_REQUIRED');
  });

  it('always blocks suppressed contacts', () => {
    const result = evaluateMessageSafety({ ...safeContext, suppressed: true, promotional: false });
    expect(result.allowed).toBe(false);
  });
});

describe('subscription lifecycle', () => {
  const now = new Date('2026-08-13T00:00:00.000Z');

  it('classifies active, expiring and expired windows deterministically', () => {
    expect(subscriptionLifecycleStatus(new Date('2026-10-01T00:00:00.000Z'), now)).toBe('ACTIVE');
    expect(subscriptionLifecycleStatus(new Date('2026-08-20T00:00:00.000Z'), now)).toBe('EXPIRING');
    expect(subscriptionLifecycleStatus(new Date('2026-08-13T00:00:00.000Z'), now)).toBe('EXPIRED');
  });

  it('emits only configured reminder thresholds', () => {
    expect(subscriptionDaysRemaining(new Date('2026-08-16T00:00:00.000Z'), now)).toBe(3);
    expect(subscriptionWarningThreshold(new Date('2026-08-16T00:00:00.000Z'), now)).toBe(3);
    expect(subscriptionWarningThreshold(new Date('2026-08-17T00:00:00.000Z'), now)).toBeNull();
  });

  it('creates expiry-specific idempotency keys', () => {
    const first = subscriptionNotificationKey('sub-1', new Date('2026-08-20T00:00:00.000Z'), 'warning-7');
    const renewed = subscriptionNotificationKey('sub-1', new Date('2026-09-20T00:00:00.000Z'), 'warning-7');
    expect(first).not.toBe(renewed);
  });
});
