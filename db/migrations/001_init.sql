CREATE TABLE id_counters (
  prefix TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  dataset TEXT NOT NULL CHECK (dataset IN ('instructors', 'courses', 'groups', 'sessions', 'feedback', 'events')),
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  total_rows INTEGER NOT NULL,
  imported_count INTEGER NOT NULL,
  duplicate_count INTEGER NOT NULL,
  conflict_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  skipped_row_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_since_preview BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at TIMESTAMPTZ,
  revert_reason TEXT
);

CREATE INDEX imports_active_sha_idx ON imports (file_sha256) WHERE reverted_at IS NULL;

CREATE TABLE records (
  id TEXT PRIMARY KEY,
  dataset TEXT NOT NULL CHECK (dataset IN ('instructors', 'courses', 'groups', 'sessions', 'feedback', 'events')),
  record_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  data JSONB NOT NULL,
  import_id TEXT NOT NULL REFERENCES imports (id),
  reverted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX records_active_dataset_key_idx
  ON records (dataset, record_key)
  WHERE reverted_at IS NULL;

CREATE INDEX records_import_idx ON records (import_id);

CREATE TABLE login_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_key TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_client_idx ON login_attempts (client_key, attempted_at);
