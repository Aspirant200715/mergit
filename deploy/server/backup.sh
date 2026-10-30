#!/usr/bin/env bash
# Dumps the databases that hold users and everything else worth keeping, and prunes old dumps.
#   deploy/server/backup.sh [directory]        (default: ~/backups)
#   cp_postgres -> mergit_cp   users, identities, wallets, sessions, plans, tasks, jobs
#   postgres    -> mergit      the gateway's credits ledger, outbox and watcher cursor
# Dumps are plain SQL, gzipped, readable with `gunzip -c file | psql`. They hold session-token hashes and email
# addresses: keep the directory private (mode 700) and copy it somewhere off this server.
set -euo pipefail
cd "$(dirname "$0")/../.."
dir=${1:-$HOME/backups}
keep_days=${KEEP_DAYS:-14}
compose() { docker compose -f deploy/compose.testnet.yaml -f deploy/compose.controlplane.yaml -f deploy/compose.server.yaml "$@"; }

umask 077
mkdir -p "$dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for pair in cp_postgres:mergit_cp postgres:mergit; do
  service=${pair%%:*}; database=${pair##*:}
  out="$dir/$database-$stamp.sql.gz"
  # Written to a temp name first, so a failed dump never leaves a file that looks like a backup.
  compose exec -T "$service" pg_dump -U postgres --no-owner "$database" | gzip > "$out.partial"
  gzip -t "$out.partial"
  mv "$out.partial" "$out"
  echo "wrote $out ($(du -h "$out" | cut -f1))"
done
find "$dir" -name '*.sql.gz' -mtime +"$keep_days" -delete
find "$dir" -name '*.partial' -delete
