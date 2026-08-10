-- Store one-time PKCE/OAuth state server-side so the code verifier never reaches the browser.
CREATE TABLE "PlatformOAuthState" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "encryptedCodeVerifier" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformOAuthState_stateHash_key" ON "PlatformOAuthState"("stateHash");
CREATE INDEX "PlatformOAuthState_expiresAt_usedAt_idx" ON "PlatformOAuthState"("expiresAt", "usedAt");
CREATE INDEX "PlatformOAuthState_workspaceId_platform_idx" ON "PlatformOAuthState"("workspaceId", "platform");

ALTER TABLE "PlatformOAuthState" ADD CONSTRAINT "PlatformOAuthState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformOAuthState" ADD CONSTRAINT "PlatformOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
