#!/bin/sh
# Host-side logical backup for the production overlay. Run from cron (daily).
# pg_dump is taken by the `backup` service in compose.prod.yaml; this adds what
# a database dump does not cover:
#   - `convex export --include-file-storage`: portable snapshot, the only way to
#     move between SQLite/Postgres/S3 and the recovery path if the Postgres
#     volume is lost together with the dumps' host
#   - an encrypted copy of .env.docker (secrets needed to restore)
# Output goes to $BACKUP_DIR (default ./backups). Set BACKUP_UPLOAD_COMMAND to
# ship the day's files off the server, for example
#   BACKUP_UPLOAD_COMMAND='rclone copy "$BACKUP_DIR" r2:opensend-backups --max-age 2d'
# Encryption needs BACKUP_GPG_RECIPIENT (public key on this host); without it
# the env file is NOT copied, because it holds every secret.
set -eu
cd "$(dirname "$0")/.."
ENV_FILE=${OPENSEND_ENV_FILE:-.env.docker}
BACKUP_DIR=${BACKUP_DIR:-$PWD/backups}
KEEP_DAYS=${BACKUP_RETENTION_DAYS:-14}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="opensend-export-$$"
umask 077
mkdir -p "$BACKUP_DIR"

compose="docker compose --env-file $ENV_FILE"
trap 'docker rm -f -v "$name" >/dev/null 2>&1 || true' EXIT

$compose run --name "$name" migrate export --include-file-storage --path /tmp/export.zip
docker cp "$name:/tmp/export.zip" "$BACKUP_DIR/.convex-export-$stamp.zip.partial"
mv "$BACKUP_DIR/.convex-export-$stamp.zip.partial" "$BACKUP_DIR/convex-export-$stamp.zip"
# A zip that cannot be listed is not a backup.
unzip -tq "$BACKUP_DIR/convex-export-$stamp.zip" >/dev/null

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
    --output "$BACKUP_DIR/env-$stamp.gpg" "$ENV_FILE"
else
  echo "prod-backup: BACKUP_GPG_RECIPIENT unset, $ENV_FILE not backed up" >&2
fi

find "$BACKUP_DIR" -type f \( -name 'convex-export-*.zip' -o -name 'env-*.gpg' \) \
  -mtime "+$KEEP_DAYS" -print -delete

if [ -n "${BACKUP_UPLOAD_COMMAND:-}" ]; then
  BACKUP_DIR=$BACKUP_DIR sh -c "$BACKUP_UPLOAD_COMMAND"
fi
echo "prod-backup: ok $stamp"
