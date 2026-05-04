CREATE TABLE IF NOT EXISTS submissions (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('etudiant', 'employe', 'entrepreneur', 'autre', 'chomeur')),
  age_range TEXT NOT NULL CHECK (age_range IN ('15-24', '25-34', '35-44', '45+')),
  gender TEXT NOT NULL CHECK (gender IN ('masculin', 'feminin', 'autre')),
  province TEXT NOT NULL,
  city_or_territory TEXT NOT NULL,
  commune_or_sector TEXT NOT NULL,
  quarter TEXT,
  consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_method TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consent_accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at_id ON submissions (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_age_range ON submissions (age_range);
CREATE INDEX IF NOT EXISTS idx_submissions_gender ON submissions (gender);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status);
CREATE INDEX IF NOT EXISTS idx_submissions_province ON submissions (province);

CREATE UNIQUE INDEX IF NOT EXISTS submissions_phone_unique ON submissions (phone);
CREATE UNIQUE INDEX IF NOT EXISTS submissions_email_unique ON submissions (email);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS csrf_token TEXT;

UPDATE admin_sessions
SET csrf_token = md5(random()::text || id::text || clock_timestamp()::text)
WHERE csrf_token IS NULL OR btrim(csrf_token) = '';

ALTER TABLE admin_sessions ALTER COLUMN csrf_token SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log (created_at DESC);
