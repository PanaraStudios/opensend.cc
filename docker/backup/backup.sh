#!/bin/sh
# pg_dump scheduler for compose.prod.yaml. Runs in the postgres image.
#   backup.sh loop    take a dump every BACKUP_INTERVAL_HOURS, prune old ones
#   backup.sh once    take one dump now and prune
#   backup.sh status  exit 0 when the newest dump is under two intervals old
# Dumps are custom-format (pg_restore), written to a temp name and renamed so a
# partial file never looks like a backup.
set -eu
DIR=/backups
INTERVAL=${BACKUP_INTERVAL_HOURS:-24}
KEEP_DAYS=${BACKUP_RETENTION_DAYS:-14}

take() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  tmp="$DIR/.convex-$stamp.dump.partial"
  out="$DIR/convex-$stamp.dump"
  echo "backup: dumping $PGDATABASE to $out"
  if pg_dump --format=custom --compress=6 --no-owner --file "$tmp"; then
    mv "$tmp" "$out"
    # Refuse a dump pg_restore cannot read.
    pg_restore --list "$out" >/dev/null
    echo "backup: ok $(du -h "$out" | cut -f1)"
  else
    rm -f "$tmp"
    echo "backup: pg_dump FAILED" >&2
    return 1
  fi
  find "$DIR" -name 'convex-*.dump' -mtime "+$KEEP_DAYS" -print -delete
}

case ${1:-loop} in
  once) take ;;
  status)
    newest=$(find "$DIR" -name 'convex-*.dump' -mmin "-$((INTERVAL * 120))" | head -n 1)
    [ -n "$newest" ]
    ;;
  loop)
    sleep "${BACKUP_START_DELAY_SECONDS:-300}"
    while :; do
      take || true
      sleep "$((INTERVAL * 3600))"
    done
    ;;
  *) echo "usage: backup.sh loop|once|status" >&2; exit 2 ;;
esac
