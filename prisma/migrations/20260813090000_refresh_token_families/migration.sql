ALTER TABLE "RefreshToken"
  ADD COLUMN "familyId" TEXT,
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "reuseDetectedAt" TIMESTAMP(3);

UPDATE "RefreshToken" SET "familyId" = "id" WHERE "familyId" IS NULL;

ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;

CREATE UNIQUE INDEX "RefreshToken_parentId_key" ON "RefreshToken"("parentId");
CREATE INDEX "RefreshToken_familyId_revokedAt_idx" ON "RefreshToken"("familyId", "revokedAt");

ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "RefreshToken"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
