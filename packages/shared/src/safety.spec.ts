import { describe, expect, it } from 'vitest';
import { evaluateMessageSafety, type SafetyContext } from './index';

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
