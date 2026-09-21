CREATE TABLE identity.user_account (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL,
  email_verified_at timestamptz,
  password_hash     text,
  display_name      text NOT NULL DEFAULT '',
  locale            text NOT NULL DEFAULT 'en',
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT email_lowercase CHECK (email = lower(email)),
  CONSTRAINT email_shape CHECK (length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1),
  CONSTRAINT password_is_argon2id CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%'),
  CONSTRAINT deleted_after_created CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE UNIQUE INDEX user_account_email_live
  ON identity.user_account (email) WHERE deleted_at IS NULL;

CREATE TABLE identity.external_identity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES identity.user_account (id) ON DELETE RESTRICT,
  provider   text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject    text NOT NULL CHECK (subject <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX external_identity_subject
  ON identity.external_identity (provider, subject);

CREATE UNIQUE INDEX one_external_identity_per_provider
  ON identity.external_identity (user_id, provider);

CREATE TABLE identity.third_party_grant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES identity.user_account (id) ON DELETE RESTRICT,
  provider    text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  scopes      text[] NOT NULL CHECK (cardinality(scopes) > 0),
  dek_wrapped bytea NOT NULL,
  access_ct   bytea NOT NULL,
  refresh_ct  bytea NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_live_grant_per_provider
  ON identity.third_party_grant (user_id, provider) WHERE revoked_at IS NULL;

CREATE TABLE identity.refresh_token (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid NOT NULL,
  parent_id  uuid REFERENCES identity.refresh_token (id) ON DELETE RESTRICT,
  user_id    uuid NOT NULL REFERENCES identity.user_account (id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  CONSTRAINT expires_after_issue CHECK (expires_at > issued_at),
  CONSTRAINT root_starts_family CHECK (parent_id IS NOT NULL OR family_id = id)
);

CREATE UNIQUE INDEX refresh_token_hash
  ON identity.refresh_token (token_hash);

CREATE UNIQUE INDEX refresh_token_one_successor
  ON identity.refresh_token (parent_id) WHERE parent_id IS NOT NULL;

CREATE INDEX refresh_token_family
  ON identity.refresh_token (family_id);

CREATE INDEX refresh_token_user_live
  ON identity.refresh_token (user_id) WHERE revoked_at IS NULL;
