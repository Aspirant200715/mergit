-- Sign in and create account are different intents: signing in with something nobody has registered is refused
-- instead of silently making an account. A flow started without an intent registers, as before.
ALTER TABLE oauth_states ADD COLUMN intent text NOT NULL DEFAULT 'register' CHECK (intent IN ('login', 'register'));
