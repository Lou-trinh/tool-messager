#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-/backups/media}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
output="$backup_dir/zalohub-media-$timestamp.tar.gz"

: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mc alias set source "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc mirror "source/$S3_BUCKET" "$tmp_dir/$S3_BUCKET"
tar -C "$tmp_dir" -czf "$output" "$S3_BUCKET"
sha256sum "$output" > "$output.sha256"
echo "$output"
