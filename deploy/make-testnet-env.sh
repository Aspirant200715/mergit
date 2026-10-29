#!/usr/bin/env bash
# Writes deploy/secrets/testnet.env (mode 600, git-ignored) for compose.testnet.yaml.
#   deploy/make-testnet-env.sh <base-sepolia-rpc-url>
# Keys come from ../../mergit-contracts/.env.services (script/new-testnet-keys.sh there). The five shared tokens are
# generated here; hand the same values to the orchestration team. Prints names only, never values.
set -euo pipefail
cd "$(dirname "$0")"
[ $# -eq 1 ] || { echo "usage: $0 <base-sepolia-rpc-url>" >&2; exit 2; }
svc=../../mergit-contracts/.env.services
[ -e "$svc" ] || { echo "$svc missing: run mergit-contracts/script/new-testnet-keys.sh first" >&2; exit 1; }
[ ! -e secrets/testnet.env ] || { echo "secrets/testnet.env exists; delete it first to regenerate" >&2; exit 1; }
set -a; . "$svc"; set +a
mkdir -p secrets
umask 077
{
  echo "RPC_URL=$1"
  echo "GATEWAY_KEY=$GATEWAY_KEY"
  echo "VALIDATOR_KEY=$VALIDATOR_KEY"
  echo "TREASURY_KEY=$TREASURY_KEY"
  for t in EVENTS_TOKEN AUDIT_TOKEN STORE_WRITE_TOKEN CHAIN_EVENTS_TOKEN WORKER_TOKEN; do
    echo "$t=$(openssl rand -hex 32)"
  done
} > secrets/testnet.env
echo "wrote deploy/secrets/testnet.env: RPC_URL GATEWAY_KEY VALIDATOR_KEY TREASURY_KEY EVENTS_TOKEN AUDIT_TOKEN STORE_WRITE_TOKEN CHAIN_EVENTS_TOKEN WORKER_TOKEN"
