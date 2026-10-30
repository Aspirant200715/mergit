#!/usr/bin/env bash
# Redeploys on the server after a push (Render did this on every push; the server does not).
#   deploy/server/update.sh [all|services|web|app]      (default: all)
#   services = pull and rebuild the Rust services and Caddy;  web / app = rebuild that static site (about 10 minutes)
set -euo pipefail
cd "$(dirname "$0")/../.."
what=${1:-all}
compose() { docker compose -f deploy/compose.testnet.yaml -f deploy/compose.controlplane.yaml -f deploy/compose.server.yaml "$@"; }

case "$what" in all|services|web|app) ;; *) echo "usage: $0 [all|services|web|app]" >&2; exit 2 ;; esac

git pull --ff-only
git -C ../mergit-contracts pull --ff-only   # deployments/base-sepolia.json lives there

case "$what" in
  all|services)
    compose up -d --build
    # The Caddyfile is a bind mount, so a changed one is not picked up by `up`; a reload applies it with no downtime.
    compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile || compose restart caddy ;;
esac
case "$what" in all) deploy/server/build-sites.sh all ;; web|app) deploy/server/build-sites.sh "$what" ;; esac

compose ps
for h in gateway store; do printf '%s: ' "$h"; curl -fsS "https://$h.mergit.site/healthz"; echo; done
