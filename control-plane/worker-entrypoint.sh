#!/bin/sh
# WorkerConfig.receipt_registry (mergit_worker/config.py) is a plain env var, not a file path, but its
# value comes from the chain deployment: deploy/compose.yaml's `deploy` step writes it fresh into
# local.json on every run (the Rust services read that file directly in their own code; this is the
# Python-side equivalent). If the caller already set RECEIPT_REGISTRY, leave it alone.
set -eu

if [ -z "${RECEIPT_REGISTRY:-}" ] && [ -n "${DEPLOYMENT_FILE:-}" ]; then
    RECEIPT_REGISTRY=$(python3 -c "
import json, sys
print(json.load(open(sys.argv[1]))['receipt_registry'])
" "$DEPLOYMENT_FILE")
    export RECEIPT_REGISTRY
fi

exec "$@"
