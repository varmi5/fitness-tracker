CREATE TABLE "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false, image text,
  created_at timestamp NOT NULL, updated_at timestamp NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member'))
);
CREATE UNIQUE INDEX user_single_owner ON "user" (role) WHERE role = 'owner';
CREATE TABLE session (
  id text PRIMARY KEY, token text NOT NULL UNIQUE, expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL, updated_at timestamp NOT NULL, ip_address text, user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX session_user_idx ON session(user_id);
CREATE TABLE account (
  id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text, refresh_token text, id_token text, access_token_expires_at timestamp,
  refresh_token_expires_at timestamp, scope text, password text,
  created_at timestamp NOT NULL, updated_at timestamp NOT NULL
);
CREATE INDEX account_user_idx ON account(user_id);
CREATE TABLE verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL, updated_at timestamp NOT NULL
);
CREATE INDEX verification_identifier_idx ON verification(identifier);
CREATE TABLE owner_setup (
  id integer PRIMARY KEY CHECK (id = 1),
  consumed boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO owner_setup (id) VALUES (1);
