param([Parameter(Mandatory = $true)][string]$BackupFile)
$ErrorActionPreference = 'Stop'
$resolvedBackup = Resolve-Path -LiteralPath $BackupFile
Get-Content -Raw -LiteralPath $resolvedBackup | docker compose exec -T postgres psql -U omnisocial -d omnisocial
Write-Output "Database restored from: $resolvedBackup"
