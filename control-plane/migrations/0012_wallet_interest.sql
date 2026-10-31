-- "Notify me" for wallets Mergit does not support yet. A demand signal, not a verified count: a signed-in person is
-- one row per wallet (by account, so they can be told at launch), and a signed-out visitor is one row per wallet per
-- random token their browser keeps.
CREATE TABLE wallet_interest (
    interest_id bigserial PRIMARY KEY,
    wallet      text NOT NULL CHECK (wallet IN ('coinbase', 'coindcx', 'trust', 'phantom', 'rabby', 'other')),
    user_id     uuid REFERENCES users ON DELETE CASCADE,
    anon_token  text CHECK (anon_token ~ '^[A-Za-z0-9_-]{16,64}$'),
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK ((user_id IS NOT NULL) <> (anon_token IS NOT NULL))
);

CREATE UNIQUE INDEX wallet_interest_user ON wallet_interest (user_id, wallet) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX wallet_interest_anon ON wallet_interest (anon_token, wallet) WHERE anon_token IS NOT NULL;
CREATE INDEX wallet_interest_recent ON wallet_interest (created_at);
