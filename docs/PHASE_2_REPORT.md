# PHASE 2 COMPLETED

## Scope

Phase 2 completes the commercial SaaS control plane for tenant/admin dashboards, plans, subscriptions, expiration and effective quotas. All dashboard values are loaded from PostgreSQL through authenticated, tenant-scoped APIs.

## Created files

- `prisma/migrations/20260813110000_subscription_notifications/migration.sql`
- `apps/api/src/admin/admin.service.spec.ts`
- `docs/PHASE_2_REPORT.md`

## Modified files

- Subscription lifecycle helpers and tests in `packages/shared`.
- Prisma `Notification` with a nullable unique `dedupeKey`.
- Scheduler lifecycle processing and idempotent reminders.
- Subscription policy, admin/workspace APIs and OpenAPI paths.
- Tenant dashboard, subscription screen and SUPER_ADMIN dashboard.

## Database

- Added `Notification.dedupeKey` with a unique index.
- Reminder keys include subscription ID, expiry timestamp and threshold, so scheduler retries cannot create duplicate notifications while a renewed expiry can produce a new reminder series.

## API

- `GET /api/v1/workspaces/:workspaceId/dashboard`
- `PATCH /api/v1/admin/tenants/:tenantId/quota`
- Tenant usage is readable after subscription expiry while outbound entitlements remain fail-closed.
- Subscription start time, tenant suspension, global emergency stop and daily/monthly message quotas are enforced server-side.
- Unlocking a tenant does not reactivate an already-expired subscription.

## Frontend

- Tenant dashboard displays the effective plan, lifecycle status, expiry date, days remaining, live metrics and quota progress.
- SUPER_ADMIN dashboard displays expiring tenants and supports tenant-specific quota overrides.
- Subscription usage remains visible in read-only mode after expiry.

## Scheduler

- Subscription warnings are generated at 30, 15, 7, 3 and 1 day before expiry.
- Expiry pauses scheduled/running campaigns and blocks outbound operations.
- Subscription lifecycle continues to run even while the global outbound emergency stop is active.

## Tests

- Subscription lifecycle classification and notification key idempotency.
- Expired subscription read-only snapshot and future-start blocking.
- Expired subscription cannot be reactivated by tenant unlock.
- Tenant quota override merge preserves existing overrides.

## Known limitations

- Email/webhook delivery for subscription reminders is not enabled; reminders are stored as in-app notifications and shown to SUPER_ADMIN through the expiring-tenant dashboard.
- Billing collection and invoice payment gateways are outside Phase 2.
- Outbound Zalo behavior remains limited to capabilities provided by the official Zalo OA APIs.

## Next phase

Phase 3: streamed file upload, CSV/XLSX/JSON parsing, automatic column mapping, preview, background import worker, error export and import history.
