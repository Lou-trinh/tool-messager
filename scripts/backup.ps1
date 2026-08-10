$ErrorActionPreference = 'Stop'
$backupDirectory = Join-Path $PSScriptRoot '..\backups'
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$databaseFile = Join-Path $backupDirectory "postgres-$stamp.sql"
docker compose exec -T postgres pg_dump -U omnisocial -d omnisocial --clean --if-exists | Out-File -Encoding utf8 $databaseFile
Write-Output "Database backup created: $databaseFile"
