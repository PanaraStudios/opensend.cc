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
# Encryption needs BACKUP_GPG_RECIPIENT (public key on this host; prefer its
# full fingerprint, since the key is used without a web-of-trust check);
# without it the env file is NOT copied, because it holds every secret.
# A failed encryption or upload still runs retention and the remaining steps,
# then exits non-zero.
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
export_tmp="$BACKUP_DIR/.convex-export-$stamp.zip.partial"
env_tmp="$BACKUP_DIR/.env-$stamp.gpg.partial"
trap 'rm -f "$export_tmp" "$env_tmp"; docker rm -f -v "$name" >/dev/null 2>&1 || true' EXIT
status=0

$compose run --name "$name" migrate export --include-file-storage --path /tmp/export.zip
docker cp "$name:/tmp/export.zip" "$export_tmp"
# A zip that cannot be listed is not a backup.
unzip -tq "$export_tmp" >/dev/null
mv "$export_tmp" "$BACKUP_DIR/convex-export-$stamp.zip"

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  # --trust-model always: an imported key is otherwise "unusable" in batch
  # mode until it is signed or given ownertrust.
  if gpg --batch --yes --trust-model always --encrypt \
    --recipient "$BACKUP_GPG_RECIPIENT" --output "$env_tmp" "$ENV_FILE"; then
    mv "$env_tmp" "$BACKUP_DIR/env-$stamp.gpg"
  else
    echo "prod-backup: encrypting $ENV_FILE FAILED" >&2
    status=1
  fi
else
  echo "prod-backup: BACKUP_GPG_RECIPIENT unset, $ENV_FILE not backed up" >&2
fi

find "$BACKUP_DIR" -type f \( -name 'convex-export-*.zip' -o -name 'env-*.gpg' \) \
  -mtime "+$KEEP_DAYS" -print -delete || status=1

if [ -n "${BACKUP_UPLOAD_COMMAND:-}" ]; then
  if ! BACKUP_DIR=$BACKUP_DIR sh -c "$BACKUP_UPLOAD_COMMAND"; then
    echo "prod-backup: upload FAILED" >&2
    status=1
  fi
fi
[ "$status" -eq 0 ] && echo "prod-backup: ok $stamp"
exit "$status"
