#!/usr/bin/env bash
set -euo pipefail
umask 077
# Read credentials from a private mongodump YAML config; do not put the URI in shell history.
: "${MONGODUMP_CONFIG:?Set absolute path to a chmod 600 mongodump YAML config}"
: "${CALLTRACK_BACKUP_DIR:?Set an absolute private backup directory}"
[[ "$MONGODUMP_CONFIG" = /* && "$CALLTRACK_BACKUP_DIR" = /* ]] || { echo 'Use absolute paths.' >&2; exit 1; }
[[ -r "$MONGODUMP_CONFIG" ]] || { echo 'Backup config unavailable.' >&2; exit 1; }
command -v mongodump >/dev/null
mkdir -p -- "$CALLTRACK_BACKUP_DIR"
target="$CALLTRACK_BACKUP_DIR/calltrack-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
mongodump --config="$MONGODUMP_CONFIG" --archive="$target" --gzip
sha256sum -- "$target" > "$target.sha256"
echo "Backup saved: $target"
