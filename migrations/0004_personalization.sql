-- Evidence-based personalization (docs/personalization.md): a career knowledge base that adds detail to the
-- master CV, and a cached requirement → evidence analysis per job that replaces the keyword-era fit analysis.

-- Facts the candidate adds beyond the CV: details behind a CV entry (problems, decisions, scale, collaboration,
-- results), or standalone items such as hackathons, open-source work, coursework and motivations.
CREATE TABLE knowledge_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_key  TEXT,                                  -- stable key of the master CV entry it details; NULL when standalone
  kind       TEXT NOT NULL DEFAULT 'context'
             CHECK (kind IN ('context', 'achievement', 'project', 'open_source', 'hackathon', 'coursework', 'motivation', 'other')),
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  links      TEXT NOT NULL DEFAULT '[]',            -- [{label, url}]
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_knowledge_notes_entry ON knowledge_notes (entry_key);

-- One analysis per job: requirements and competencies, requirement → evidence map, tailoring strategy and
-- cited company research. inputs_hash covers the posting, master CV, knowledge notes and profile, so any change
-- marks it stale.
CREATE TABLE job_insights (
  job_id      INTEGER PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
  inputs_hash TEXT NOT NULL,
  content     TEXT NOT NULL,                        -- JobInsights JSON
  generator   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE jobs DROP COLUMN ai_analysis;
ALTER TABLE jobs DROP COLUMN ai_analyzed_at;
