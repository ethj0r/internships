-- Eligibility before tailoring, priority tiers, 3-day refresh cycles, and semantic matching.
-- See shared/eligibility.ts, shared/priority.ts, worker/discovery/refresh.ts and docs/personalization.md.

-- Location and work-mode eligibility (Eligibility JSON). Existing jobs start UNCLASSIFIED and are classified by
-- the next cron run. Postings outside the old search area are now stored as EXCLUDED with the reason, instead of
-- being dropped silently.
ALTER TABLE jobs ADD COLUMN eligibility TEXT;
ALTER TABLE jobs ADD COLUMN eligibility_status TEXT NOT NULL DEFAULT 'UNCLASSIFIED'
  CHECK (eligibility_status IN ('ELIGIBLE_REMOTE', 'ELIGIBLE_INDONESIA', 'ELIGIBLE_SINGAPORE', 'CHECK_MANUALLY', 'EXCLUDED', 'UNCLASSIFIED'));
CREATE INDEX idx_jobs_eligibility ON jobs (eligibility_status, closed_at);

-- Shortlist ranking: company tier (config/companies.json), season ("summer_2027") and a combined priority.
ALTER TABLE jobs ADD COLUMN priority_tier INTEGER NOT NULL DEFAULT 4;
ALTER TABLE jobs ADD COLUMN season TEXT;
ALTER TABLE jobs ADD COLUMN priority_score INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_jobs_priority ON jobs (priority_score DESC);

-- Change detection: a hash of title, location and description. A changed posting is re-classified and its
-- insights go stale (they hash the description).
ALTER TABLE jobs ADD COLUMN content_hash TEXT;
ALTER TABLE jobs ADD COLUMN content_changed_at TEXT;
-- The platform's own "updated" timestamp, for boards whose listings omit descriptions (Greenhouse).
ALTER TABLE jobs ADD COLUMN source_updated_at TEXT;
-- "unlisted" (no longer on a complete board), "not_seen" (missing for two cycles), "expired" (deadline passed).
ALTER TABLE jobs ADD COLUMN closed_reason TEXT;

-- Singapore work authorization the candidate has confirmed. Empty means none: CVs and letters then never claim one.
ALTER TABLE profile ADD COLUMN sg_work_authorization TEXT NOT NULL DEFAULT '';

-- One row per refresh cycle. A cycle starts when REFRESH_INTERVAL_HOURS have passed since the last one started and
-- finishes once every enabled source has been checked (spread over hourly cron runs).
CREATE TABLE refresh_cycles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger         TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at     TEXT,
  sources_total   INTEGER NOT NULL DEFAULT 0,
  sources_checked INTEGER NOT NULL DEFAULT 0,
  jobs_new        INTEGER NOT NULL DEFAULT 0,
  jobs_changed    INTEGER NOT NULL DEFAULT 0,
  jobs_closed     INTEGER NOT NULL DEFAULT 0,
  summary         TEXT NOT NULL DEFAULT '{}',   -- RefreshSummary JSON, written when the cycle finishes
  errors          TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_refresh_cycles_started ON refresh_cycles (started_at DESC);

-- Cached embeddings of evidence and requirements. key = sha256(model + text).
CREATE TABLE embeddings (
  key        TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  vector     TEXT NOT NULL,                     -- JSON number[]
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
