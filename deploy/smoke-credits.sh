#!/usr/bin/env bash
# Smoke test of the chain side against the running testnet stack: sends one `plan.approved` (funding: credits) to the
# gateway, as the orchestrator would. The gateway funds the plan from the treasury, so a PlanFunded event for the
# Escrow contract appears on Base Sepolia and the credit balance of <requester> drops by 1 USDC.
#   deploy/smoke-credits.sh <requester-address>      (any address you own; it gets the free credits)
set -euo pipefail
cd "$(dirname "$0")"
[ $# -eq 1 ] || { echo "usage: $0 <requester-address>" >&2; exit 2; }
set -a; . secrets/testnet.env; set +a
GATEWAY=${GATEWAY_URL:-http://localhost:8082}
uuid=$(cat /proc/sys/kernel/random/uuid)
plan_id=$(cast keccak "$uuid")
body=$(printf '{"event_id":"%s","type":"plan.approved","at":"%s","payload":{"plan_id":"%s","plan_uuid":"%s","requester":"%s","total_budget_usdc_units":"1000000","funding":"credits"}}' \
  "$(cat /proc/sys/kernel/random/uuid)" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$plan_id" "$uuid" "$1")
echo "plan_uuid=$uuid plan_id=$plan_id"
curl -sS -o /dev/null -w 'POST /v0/events -> HTTP %{http_code}\n' -X POST "$GATEWAY/v0/events" \
  -H "Authorization: Bearer $EVENTS_TOKEN" -H "Idempotency-Key: $(cat /proc/sys/kernel/random/uuid)" \
  -H 'content-type: application/json' --data "$body"
echo "credits for $1:"
curl -sS "$GATEWAY/v0/credits/$1"; echo
