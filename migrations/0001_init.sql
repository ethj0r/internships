-- Internships: initial schema (Cloudflare D1 / SQLite)
-- Timestamps are ISO-8601 UTC strings. JSON columns are TEXT validated by the Worker.

-- Single-owner profile. Drives matching, filtering and document generation.
CREATE TABLE profile (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  full_name           TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  location            TEXT NOT NULL DEFAULT '',
  links               TEXT NOT NULL DEFAULT '[]',   -- [{label, url}]
  headline            TEXT NOT NULL DEFAULT '',
  education           TEXT NOT NULL DEFAULT '',
  graduation_date     TEXT,                         -- YYYY-MM
  skills              TEXT NOT NULL DEFAULT '[]',   -- string[]
  target_roles        TEXT NOT NULL DEFAULT '[]',   -- role keys, see shared/roles.ts
  preferred_locations TEXT NOT NULL DEFAULT '[]',   -- string[]
  remote_preference   TEXT NOT NULL DEFAULT 'any' CHECK (remote_preference IN ('any', 'remote', 'hybrid', 'onsite')),
  work_authorization  TEXT NOT NULL DEFAULT '',
  keywords_include    TEXT NOT NULL DEFAULT '[]',
  keywords_exclude    TEXT NOT NULL DEFAULT '[]',
  notify_min_score    INTEGER NOT NULL DEFAULT 70,
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO profile (id) VALUES (1);

-- Where jobs come from. One row per company board or aggregator query.
CREATE TABLE sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('greenhouse', 'lever', 'ashby', 'themuse', 'manual')),
  identifier  TEXT NOT NULL,                        -- board token, company slug, or category
  name        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_status TEXT CHECK (last_status IN ('ok', 'error')),
  last_error  TEXT,
  last_found  INTEGER NOT NULL DEFAULT 0,           -- relevant internships seen on last run
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, identifier)
);
CREATE INDEX idx_sources_schedule ON sources (enabled, last_run_at);

-- Every discovered posting. (source_kind, external_id) prevents re-inserting the same posting;
-- fingerprint links the same role seen on different platforms.
CREATE TABLE jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       INTEGER REFERENCES sources (id) ON DELETE SET NULL,
  source_kind     TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  company         TEXT NOT NULL,
  title           TEXT NOT NULL,
  location        TEXT NOT NULL DEFAULT '',
  workplace       TEXT NOT NULL DEFAULT 'unknown' CHECK (workplace IN ('remote', 'hybrid', 'onsite', 'unknown')),
  department      TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT '',
  duration        TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL,
  apply_url       TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',         -- Markdown
  skills          TEXT NOT NULL DEFAULT '{"required":[],"preferred":[]}', -- extracted canonical skills
  posted_at       TEXT,
  deadline        TEXT,                             -- YYYY-MM-DD
  fingerprint     TEXT NOT NULL,
  duplicate_of    INTEGER REFERENCES jobs (id) ON DELETE SET NULL,
  match_score     INTEGER,
  match_detail    TEXT,                             -- MatchResult JSON
  ai_analysis     TEXT,                             -- FitAnalysis JSON
  ai_analyzed_at  TEXT,
  dismissed_at    TEXT,
  first_seen_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at       TEXT,                             -- no longer listed by the source
  UNIQUE (source_kind, external_id)
);
CREATE INDEX idx_jobs_fingerprint ON jobs (fingerprint);
CREATE INDEX idx_jobs_score ON jobs (match_score DESC);
CREATE INDEX idx_jobs_first_seen ON jobs (first_seen_at DESC);
CREATE INDEX idx_jobs_deadline ON jobs (deadline);

-- Master CVs, tailored CVs, cover letters and application answers.
-- `generated_content` keeps the untouched model output next to the edited `content` for auditing.
CREATE TABLE documents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT NOT NULL CHECK (kind IN ('master_cv', 'tailored_cv', 'cover_letter', 'answers')),
  title             TEXT NOT NULL,
  job_id            INTEGER REFERENCES jobs (id) ON DELETE CASCADE,
  parent_id         INTEGER REFERENCES documents (id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  is_active         INTEGER NOT NULL DEFAULT 0,     -- master_cv only: the current master
  content           TEXT NOT NULL,
  generated_content TEXT,
  meta              TEXT NOT NULL DEFAULT '{}',     -- changes, warnings, questions, generator, filename
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_documents_kind_job ON documents (kind, job_id);

-- One application per job (UNIQUE job_id prevents duplicate applications).
CREATE TABLE applications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            INTEGER NOT NULL UNIQUE REFERENCES jobs (id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'interested'
                    CHECK (status IN ('discovered', 'interested', 'preparing', 'ready', 'applied', 'interview', 'offer', 'rejected')),
  priority          TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  notes             TEXT NOT NULL DEFAULT '',
  cv_document_id    INTEGER REFERENCES documents (id) ON DELETE SET NULL,
  cover_letter_id   INTEGER REFERENCES documents (id) ON DELETE SET NULL,
  checklist         TEXT NOT NULL DEFAULT '{}',     -- {stepKey: true}
  applied_at        TEXT,
  status_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_applications_status ON applications (status);

-- Append-only audit trail: discoveries, analyses, generated documents, status changes.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('job', 'application', 'document', 'source', 'profile')),
  entity_id   INTEGER,
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_events_entity ON events (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_events_created ON events (created_at DESC);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('new_match', 'deadline', 'source_error')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  job_id     INTEGER REFERENCES jobs (id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_notifications_unread ON notifications (read_at, created_at DESC);

CREATE TABLE discovery_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger         TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at     TEXT,
  sources_checked INTEGER NOT NULL DEFAULT 0,
  jobs_seen       INTEGER NOT NULL DEFAULT 0,
  jobs_new        INTEGER NOT NULL DEFAULT 0,
  errors          TEXT NOT NULL DEFAULT '[]'
);
