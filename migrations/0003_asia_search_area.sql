-- Asia focus: a search area on the profile, a region on every job, four more platforms and Asian sources.

-- Which jobs discovery keeps and lists (shared/regions.ts): Indonesia at any workplace, elsewhere remote only.
ALTER TABLE profile ADD COLUMN search_scope TEXT NOT NULL DEFAULT 'indonesia_remote'
  CHECK (search_scope IN ('indonesia_remote', 'asia', 'anywhere'));

-- Where a job can be worked from. Set by the Worker; existing jobs are classified on the next discovery run.
ALTER TABLE jobs ADD COLUMN region TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX idx_jobs_region ON jobs (region);

-- SQLite can't change a CHECK constraint, so sources is rebuilt with the same ids.
-- Dropping the old table can null jobs.source_id (ON DELETE SET NULL), so those links are saved and restored.
PRAGMA defer_foreign_keys = true;
CREATE TABLE _job_sources AS SELECT id, source_id FROM jobs WHERE source_id IS NOT NULL;

CREATE TABLE sources_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'catapa', 'themuse', 'himalayas', 'manual')),
  identifier  TEXT NOT NULL,                        -- board token, company slug, category or country
  name        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_status TEXT CHECK (last_status IN ('ok', 'error')),
  last_error  TEXT,
  last_found  INTEGER NOT NULL DEFAULT 0,           -- relevant internships in the search area on last run
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, identifier)
);
INSERT INTO sources_new (id, kind, identifier, name, enabled, last_run_at, last_status, last_error, last_found, created_at)
  SELECT id, kind, identifier, name, enabled, last_run_at, last_status, last_error, last_found, created_at FROM sources;
DROP TABLE sources;
ALTER TABLE sources_new RENAME TO sources;
CREATE INDEX idx_sources_schedule ON sources (enabled, last_run_at);

UPDATE jobs SET source_id = (SELECT t.source_id FROM _job_sources t WHERE t.id = jobs.id) WHERE id IN (SELECT id FROM _job_sources);
DROP TABLE _job_sources;

-- Boards with no Asian or remote-from-Asia roles (checked September 2026). Kept, but paused so the hourly
-- rotation reaches Asian sources sooner. Turn any back on under Sources.
UPDATE sources SET enabled = 0 WHERE kind = 'greenhouse' AND identifier IN
  ('lyft', 'instacart', 'robinhood', 'brex', 'affirm', 'samsara', 'scaleai', 'reddit', 'discord', 'duolingo', 'roblox', 'waymo', 'asana');
UPDATE sources SET enabled = 0 WHERE kind = 'ashby' AND identifier IN ('ramp', 'perplexity', 'linear');
UPDATE sources SET enabled = 0 WHERE kind = 'themuse' AND identifier IN ('Data and Analytics', 'Computer and IT');

-- Asian employers and remote-first companies. Every identifier was verified to return a live board.
INSERT INTO sources (kind, identifier, name) VALUES
  ('catapa', 'gdplabs', 'GDP Labs'),
  ('himalayas', 'Indonesia', 'Himalayas: remote, open to Indonesia'),
  ('smartrecruiters', 'Grab', 'Grab'),
  ('smartrecruiters', 'CarousellGroup', 'Carousell Group'),
  ('smartrecruiters', 'Canva', 'Canva'),
  ('smartrecruiters', 'Wise', 'Wise'),
  ('smartrecruiters', 'DeliveryHero', 'Delivery Hero (foodpanda)'),
  ('smartrecruiters', 'WesternDigital', 'Western Digital'),
  ('smartrecruiters', 'alodokter', 'Alodokter'),
  ('smartrecruiters', 'bukuwarung', 'BukuWarung'),
  ('smartrecruiters', 'julo', 'JULO'),
  ('smartrecruiters', 'sayurbox', 'Sayurbox'),
  ('smartrecruiters', 'stockbit', 'Stockbit'),
  ('smartrecruiters', '99group', '99 Group'),
  ('workable', 'mercari', 'Mercari'),
  ('workable', 'smartnews', 'SmartNews'),
  ('greenhouse', 'xendit', 'Xendit'),
  ('greenhouse', 'appier', 'Appier'),
  ('greenhouse', 'bybit', 'Bybit'),
  ('greenhouse', 'okx', 'OKX'),
  ('greenhouse', 'agoda', 'Agoda'),
  ('greenhouse', 'moloco', 'Moloco'),
  ('greenhouse', 'sendbird', 'Sendbird'),
  ('greenhouse', 'thunes', 'Thunes'),
  ('greenhouse', 'trustbank', 'Trust Bank'),
  ('greenhouse', 'coupang', 'Coupang'),
  ('greenhouse', 'dcard', 'Dcard'),
  ('greenhouse', 'axon', 'Axon'),
  ('greenhouse', 'canonical', 'Canonical'),
  ('greenhouse', 'remotecom', 'Remote'),
  ('greenhouse', 'grafanalabs', 'Grafana Labs'),
  ('ashby', 'coinhako', 'Coinhako'),
  ('ashby', 'hoyoverse', 'HoYoverse'),
  ('lever', 'ambergroup', 'Amber Group'),
  ('lever', 'animocabrands', 'Animoca Brands')
ON CONFLICT (kind, identifier) DO NOTHING;
