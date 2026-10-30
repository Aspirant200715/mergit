-- Accounts: a user signs in with GitHub, Google, an emailed code or a wallet; a wallet is something they
-- connect, not who they are. Every earlier session belongs to a wallet, so user_id stays nullable there.

CREATE TABLE users (
    user_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name     text,
    email            text,
    avatar_url       text,
    trial_started_at timestamptz,    -- NULL until the user chooses the free trial
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- One row per way of signing in. (provider, subject) is the provider's stable id, never an email address
-- except for provider 'email', whose subject is the lowercase address.
CREATE TABLE identities (
    provider   text NOT NULL CHECK (provider IN ('github', 'google', 'email')),
    subject    text NOT NULL,
    user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    label      text NOT NULL,        -- what the account menu shows: the GitHub login or the email
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE INDEX identities_user ON identities (user_id);

-- A wallet belongs to at most one user.
CREATE TABLE wallets (
    address    text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
    user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wallets_user ON wallets (user_id);

ALTER TABLE sessions ADD COLUMN user_id uuid REFERENCES users ON DELETE CASCADE;

-- Single-use OAuth state with its PKCE verifier. The state is also in an HttpOnly cookie, so a state an
-- attacker obtained cannot be completed in someone else's browser.
CREATE TABLE oauth_states (
    state         text PRIMARY KEY,
    provider      text NOT NULL,
    code_verifier text NOT NULL,
    expires_at    timestamptz NOT NULL,
    used_at       timestamptz
);

-- Emailed one-time codes. Only an HMAC of the code is stored.
CREATE TABLE email_otps (
    otp_id     bigserial PRIMARY KEY,
    email      text NOT NULL,
    code_hash  bytea NOT NULL,
    attempts   integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);

CREATE INDEX email_otps_email ON email_otps (email, created_at DESC);
