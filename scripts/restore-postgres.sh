#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: restore-postgres.sh /absolute/path/backup.dump" >&2
  exit 2
fi

backup_file="$1"
case "$backup_file" in /*) ;; *) echo "Backup path must be absolute." >&2; exit 2 ;; esac
[ -f "$backup_file" ] || { echo "Backup file not found." >&2; exit 2; }
[ "${CONFIRM_RESTORE:-}" = "RESTORE_ZALOHUB" ] || { echo "Set CONFIRM_RESTORE=RESTORE_ZALOHUB to continue." >&2; exit 2; }

if [ -f "$backup_file.sha256" ]; then sha256sum -c "$backup_file.sha256"; fi
pg_restore --clean --if-exists --no-owner --no-acl --dbname "$DATABASE_URL" "$backup_file"
