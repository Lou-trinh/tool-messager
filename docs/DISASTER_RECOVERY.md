# Backup, restore and disaster recovery

## PostgreSQL

Run `scripts/backup-postgres.sh` from a trusted backup runner with `DATABASE_URL` and an encrypted persistent `BACKUP_DIR`. The script creates a PostgreSQL custom-format dump and SHA-256 checksum.

Restore only into a prepared recovery database:

```bash
CONFIRM_RESTORE=RESTORE_ZALOHUB DATABASE_URL=postgresql://... \
  scripts/restore-postgres.sh /absolute/path/zalohub-YYYYMMDDTHHMMSSZ.dump
```

The restore command is intentionally gated and uses an absolute path. Validate migrations, tenant counts, subscriptions, queue records and audit logs before redirecting traffic.

## Media

Run `scripts/backup-media.sh` with the S3/MinIO endpoint, bucket and credentials. Store the resulting archive and checksum outside the primary region.

## Recovery order

1. Stop outbound processing with the global emergency switch.
2. Restore PostgreSQL into an isolated instance and verify the checksum.
3. Restore the media bucket.
4. Start Redis, API and scheduler; keep message workers stopped.
5. Run readiness checks and tenant-isolation smoke tests.
6. Start one worker, verify idempotency and queue depth, then scale workers.
7. Resume outbound only after SUPER_ADMIN review and record the action in the audit log.

Recommended targets: database RPO 24 hours or better, RTO 4 hours or better. Production deployments should use managed point-in-time recovery in addition to these portable backups.
