-- Sign-in: single-use SIWE nonces and server-side sessions.

CREATE TABLE auth_nonces (
    nonce       text PRIMARY KEY,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz
);

-- The cookie carries a random token; only its HMAC is stored, so a database leak yields no usable session.
CREATE TABLE sessions (
    token_hash  bytea PRIMARY KEY,
    address     text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz
);

CREATE INDEX sessions_address ON sessions (address);
