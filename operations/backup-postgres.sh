#!/usr/bin/env sh
set -eu

BACKUP_DIRECTORY="${BACKUP_DIRECTORY:-/home/ubuntu/platform-backups}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-platform-staging-postgres-1}"
POSTGRES_USER="${POSTGRES_USER:-platform}"
POSTGRES_DATABASE="${POSTGRES_DATABASE:-platform}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${BACKUP_DIRECTORY}/${POSTGRES_DATABASE}-${timestamp}.dump"
temporary_file="${backup_file}.partial"

mkdir -p "$BACKUP_DIRECTORY"

docker exec "$POSTGRES_CONTAINER" \
  pg_dump \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DATABASE" \
  --format=custom \
  > "$temporary_file"

test -s "$temporary_file"

docker exec -i "$POSTGRES_CONTAINER" \
  pg_restore --list \
  < "$temporary_file" \
  > /dev/null

mv "$temporary_file" "$backup_file"

find "$BACKUP_DIRECTORY" \
  -maxdepth 1 \
  -type f \
  -name "${POSTGRES_DATABASE}-*.dump" \
  -mtime "+$RETENTION_DAYS" \
  -delete

echo "Backup completed: $backup_file"
