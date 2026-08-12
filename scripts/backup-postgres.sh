#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-/backups/postgres}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
output="$backup_dir/zalohub-$timestamp.dump"

pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" --file "$output"
sha256sum "$output" > "$output.sha256"
echo "$output"
