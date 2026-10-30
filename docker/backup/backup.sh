#!/bin/sh
# pg_dump scheduler for compose.prod.yaml. Runs in the postgres image.
#   backup.sh loop    take a dump every BACKUP_INTERVAL_HOURS, prune old ones
#   backup.sh once    take one dump now and prune
#   backup.sh status  exit 0 when the newest dump is under two intervals old,
#                     or while the loop's first dump is not due yet
# Dumps are custom-format (pg_restore), written to a temp name and renamed so a
# partial file never looks like a backup.
# Dumps hold every secret in the database: they are 0600 in a 0700 directory
# and owned by whoever owns that directory on the host (create ./backups as
# the deploy user, so a host upload cron run as that user can read them).
set -eu
DIR=${BACKUP_LOCAL_DIR:-/backups}
INTERVAL=${BACKUP_INTERVAL_HOURS:-24}
KEEP_DAYS=${BACKUP_RETENTION_DAYS:-14}
DELAY=${BACKUP_START_DELAY_SECONDS:-300}
STARTED="$DIR/.loop-started"

# Every step returns on failure explicitly: `take || true` in the loop turns
# off set -e inside this function. A failed take never prunes old dumps.
take() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  tmp="$DIR/.convex-$stamp.dump.partial"
  out="$DIR/convex-$stamp.dump"
  echo "backup: dumping $PGDATABASE to $out"
  if ! pg_dump --format=custom --compress=6 --no-owner --file "$tmp"; then
    rm -f "$tmp"
    echo "backup: pg_dump FAILED" >&2
    return 1
  fi
  # Refuse a dump pg_restore cannot read before it gets a backup's name.
  if ! pg_restore --list "$tmp" >/dev/null; then
    rm -f "$tmp"
    echo "backup: dump unreadable by pg_restore, discarded" >&2
    return 1
  fi
  mv "$tmp" "$out" || { rm -f "$tmp"; return 1; }
  chown "$(stat -c %u:%g "$DIR")" "$out" || return 1
  echo "backup: ok $(du -h "$out" | cut -f1)"
  find "$DIR" -name 'convex-*.dump' -mtime "+$KEEP_DAYS" -print -delete || return 1
}

private() {
  umask 077
  chmod 700 "$DIR"
}

case ${1:-loop} in
  once) private && take ;;
  status)
    newest=$(find "$DIR" -name 'convex-*.dump' -mmin "-$((INTERVAL * 120))" | head -n 1)
    [ -n "$newest" ] && exit 0
    # No recent dump: healthy only until the first one is due, which is the
    # start delay plus one interval for it to finish.
    [ -f "$STARTED" ] || exit 1
    [ "$(date +%s)" -lt "$(($(cat "$STARTED") + DELAY + INTERVAL * 3600))" ]
    ;;
  loop)
    private
    date +%s >"$STARTED"
    sleep "$DELAY"
    while :; do
      take || true
      sleep "$((INTERVAL * 3600))"
    done
    ;;
  *) echo "usage: backup.sh loop|once|status" >&2; exit 2 ;;
esac
