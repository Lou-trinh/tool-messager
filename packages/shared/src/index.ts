import { z } from 'zod';

export const platformSchema = z.enum(['ZALO', 'FACEBOOK', 'TIKTOK']);
export type Platform = z.infer<typeof platformSchema>;

export const consentStatusSchema = z.enum(['UNKNOWN', 'OPTED_IN', 'OPTED_OUT']);
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

export const capabilityStatusSchema = z.enum([
  'SUPPORTED',
  'NOT_SUPPORTED',
  'NOT_CONFIGURED',
  'PERMISSION_REQUIRED',
]);
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;

export const messageRequestSchema = z.object({
  workspaceId: z.string().min(1),
  accountId: z.string().min(1),
  contactId: z.string().min(1),
  conversationId: z.string().optional(),
  content: z.string().min(1).max(10_000),
  promotional: z.boolean().default(false),
  idempotencyKey: z.string().min(16).max(160),
});
export type MessageRequest = z.infer<typeof messageRequestSchema>;

export interface SafetyContext {
  consentStatus: ConsentStatus;
  suppressed: boolean;
  hasPermission: boolean;
  capability: CapabilityStatus;
  withinRateLimit: boolean;
  promotional: boolean;
}

export type SafetyDecision =
  | { allowed: true; code: 'ALLOWED' }
  | {
      allowed: false;
      code:
        | 'CONSENT_REQUIRED'
        | 'CONTACT_SUPPRESSED'
        | 'ACCOUNT_PERMISSION_DENIED'
        | 'PLATFORM_NOT_CONFIGURED'
        | 'PLATFORM_NOT_SUPPORTED'
        | 'PLATFORM_RATE_LIMIT';
      reason: string;
    };

export function evaluateMessageSafety(context: SafetyContext): SafetyDecision {
  if (context.suppressed || context.consentStatus === 'OPTED_OUT') {
    return {
      allowed: false,
      code: 'CONTACT_SUPPRESSED',
      reason: 'Contact is present on the workspace suppression list.',
    };
  }
  if (context.promotional && context.consentStatus !== 'OPTED_IN') {
    return {
      allowed: false,
      code: 'CONSENT_REQUIRED',
      reason: 'Promotional communication requires recorded opt-in consent.',
    };
  }
  if (!context.hasPermission) {
    return {
      allowed: false,
      code: 'ACCOUNT_PERMISSION_DENIED',
      reason: 'The connected account does not grant the required permission.',
    };
  }
  if (context.capability === 'NOT_CONFIGURED') {
    return {
      allowed: false,
      code: 'PLATFORM_NOT_CONFIGURED',
      reason: 'The platform adapter is not configured.',
    };
  }
  if (context.capability !== 'SUPPORTED') {
    return {
      allowed: false,
      code: 'PLATFORM_NOT_SUPPORTED',
      reason: 'The official platform API does not support this operation.',
    };
  }
  if (!context.withinRateLimit) {
    return {
      allowed: false,
      code: 'PLATFORM_RATE_LIMIT',
      reason: 'The message is outside the configured platform or account rate limit.',
    };
  }
  return { allowed: true, code: 'ALLOWED' };
}

export class OmniError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'OmniError';
  }
}

const millisecondsPerDay = 86_400_000;

export const subscriptionWarningDays = [30, 15, 7, 3, 1] as const;
export type SubscriptionWarningDay = (typeof subscriptionWarningDays)[number];
export type SubscriptionLifecycleStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED';

export function subscriptionDaysRemaining(endAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((endAt.getTime() - now.getTime()) / millisecondsPerDay));
}

export function subscriptionLifecycleStatus(endAt: Date, now = new Date()): SubscriptionLifecycleStatus {
  if (endAt.getTime() <= now.getTime()) return 'EXPIRED';
  return subscriptionDaysRemaining(endAt, now) <= subscriptionWarningDays[0] ? 'EXPIRING' : 'ACTIVE';
}

export function subscriptionWarningThreshold(endAt: Date, now = new Date()): SubscriptionWarningDay | null {
  const remaining = subscriptionDaysRemaining(endAt, now);
  return subscriptionWarningDays.find((days) => days === remaining) ?? null;
}

export function subscriptionNotificationKey(subscriptionId: string, endAt: Date, event: 'expired' | `warning-${SubscriptionWarningDay}`): string {
  return `subscription:${subscriptionId}:${endAt.toISOString()}:${event}`;
}
