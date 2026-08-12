CREATE TYPE "SystemRole" AS ENUM ('SUPER_ADMIN', 'USER');
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'EXPIRED', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "PlanCode" AS ENUM ('FREE', 'BASIC', 'PRO', 'BUSINESS', 'ENTERPRISE');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');
CREATE TYPE "UsageMetric" AS ENUM ('MESSAGES', 'CONTACTS', 'ACCOUNTS', 'CAMPAIGNS', 'STORAGE_BYTES', 'API_CALLS');
CREATE TYPE "SuppressionScope" AS ENUM ('GLOBAL', 'TENANT');
CREATE TYPE "SupportSessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'REVOKED', 'EXPIRED');

ALTER TABLE "User" ADD COLUMN "systemRole" "SystemRole" NOT NULL DEFAULT 'USER';
ALTER TABLE "Workspace" ADD COLUMN "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Campaign" ADD COLUMN "endAt" TIMESTAMP(3), ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh', ADD COLUMN "scheduleMode" TEXT NOT NULL DEFAULT 'ONE_TIME';

CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "code" "PlanCode" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
  "maxZaloAccounts" INTEGER NOT NULL,
  "maxUsers" INTEGER NOT NULL,
  "maxContacts" INTEGER NOT NULL,
  "maxCampaigns" INTEGER NOT NULL,
  "maxMessagesPerDay" INTEGER NOT NULL,
  "maxMessagesPerMonth" INTEGER NOT NULL,
  "maxStorageBytes" BIGINT NOT NULL,
  "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "analyticsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "apiEnabled" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "autoRenew" BOOLEAN NOT NULL DEFAULT false,
  "overrides" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageCounter" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "metric" "UsageMetric" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "value" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "planId" TEXT,
  "number" TEXT NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "dueAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SuppressionEntry" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "scope" "SuppressionScope" NOT NULL,
  "platform" "Platform",
  "platformUserId" TEXT,
  "normalizedPhone" TEXT,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportSession" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "SupportSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SystemControl" (
  "id" TEXT NOT NULL,
  "outboundPaused" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemControl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
CREATE INDEX "Subscription_workspaceId_status_endAt_idx" ON "Subscription"("workspaceId", "status", "endAt");
CREATE UNIQUE INDEX "UsageCounter_workspaceId_metric_periodStart_periodEnd_key" ON "UsageCounter"("workspaceId", "metric", "periodStart", "periodEnd");
CREATE INDEX "UsageCounter_workspaceId_metric_periodEnd_idx" ON "UsageCounter"("workspaceId", "metric", "periodEnd");
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_workspaceId_status_createdAt_idx" ON "Invoice"("workspaceId", "status", "createdAt");
CREATE INDEX "SuppressionEntry_workspaceId_normalizedPhone_idx" ON "SuppressionEntry"("workspaceId", "normalizedPhone");
CREATE INDEX "SuppressionEntry_workspaceId_platform_platformUserId_idx" ON "SuppressionEntry"("workspaceId", "platform", "platformUserId");
CREATE INDEX "SupportSession_adminId_status_expiresAt_idx" ON "SupportSession"("adminId", "status", "expiresAt");
CREATE INDEX "SupportSession_workspaceId_status_idx" ON "SupportSession"("workspaceId", "status");
CREATE INDEX "MessageEvent_workspaceId_messageId_createdAt_idx" ON "MessageEvent"("workspaceId", "messageId", "createdAt");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageEvent" ADD CONSTRAINT "MessageEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageEvent" ADD CONSTRAINT "MessageEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Plan" ("id", "code", "name", "description", "monthlyPriceCents", "maxZaloAccounts", "maxUsers", "maxContacts", "maxCampaigns", "maxMessagesPerDay", "maxMessagesPerMonth", "maxStorageBytes", "automationEnabled", "analyticsEnabled", "apiEnabled", "active", "updatedAt") VALUES
  ('plan-free', 'FREE', 'Free', 'Evaluation plan', 0, 1, 1, 250, 3, 50, 500, 104857600, false, false, false, true, CURRENT_TIMESTAMP),
  ('plan-basic', 'BASIC', 'Basic', 'Small team plan', 4900000, 2, 3, 5000, 25, 1000, 10000, 5368709120, false, true, false, true, CURRENT_TIMESTAMP),
  ('plan-pro', 'PRO', 'Pro', 'Growing operation plan', 14900000, 5, 10, 25000, 100, 5000, 100000, 26843545600, true, true, true, true, CURRENT_TIMESTAMP),
  ('plan-business', 'BUSINESS', 'Business', 'High-volume business plan', 39900000, 15, 50, 100000, 500, 20000, 500000, 107374182400, true, true, true, true, CURRENT_TIMESTAMP),
  ('plan-enterprise', 'ENTERPRISE', 'Enterprise', 'Contract limits can be overridden per tenant', 0, 100, 500, 1000000, 10000, 100000, 5000000, 1099511627776, true, true, true, true, CURRENT_TIMESTAMP);

INSERT INTO "SystemControl" ("id", "outboundPaused", "updatedAt") VALUES ('global', false, CURRENT_TIMESTAMP);

INSERT INTO "Subscription" ("id", "workspaceId", "planId", "startAt", "endAt", "status", "autoRenew", "overrides", "updatedAt")
SELECT 'sub-' || md5(w."id"), w."id", 'plan-pro', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '365 days', 'ACTIVE', false, '{}', CURRENT_TIMESTAMP
FROM "Workspace" w
WHERE w."deletedAt" IS NULL;

UPDATE "User" SET "systemRole" = 'SUPER_ADMIN' WHERE "email" = 'owner@demo.local';

-- System-wide admin actions do not belong to a tenant, while tenant actions keep workspace context.
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_workspaceId_fkey";
ALTER TABLE "AuditLog" ALTER COLUMN "workspaceId" DROP NOT NULL;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
