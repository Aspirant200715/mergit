#!/usr/bin/env bash
# Who asked for a wallet Mergit does not support yet ("Notify me" on the wallet picker).
#   deploy/server/wallet-interest.sh            counts per wallet
#   deploy/server/wallet-interest.sh --emails   also the signed-in people to tell at launch (one per line)
# A demand signal, not a verified count: a signed-in person is counted once per wallet by account; a signed-out
# visitor once per wallet per token their browser keeps, so one person on two browsers counts twice.
set -euo pipefail
cd "$(dirname "$0")/../.."
compose() { docker compose -f deploy/compose.testnet.yaml -f deploy/compose.controlplane.yaml -f deploy/compose.server.yaml "$@"; }
sql() { compose exec -T cp_postgres psql -U postgres -d mergit_cp -v ON_ERROR_STOP=1 "$@"; }

sql -c "select wallet,
               count(*)        as people,
               count(user_id)  as signed_in,
               count(*) - count(user_id) as anonymous,
               min(created_at)::date as first_ask,
               max(created_at)::date as latest_ask
        from wallet_interest group by wallet order by people desc, wallet"

if [ "${1:-}" = "--emails" ]; then
  echo "Signed-in people to tell, by wallet (private: do not publish):"
  sql -At -c "select i.wallet || E'\t' || coalesce(u.email, '(no email on the account)')
              from wallet_interest i join users u using (user_id) order by 1"
fi
