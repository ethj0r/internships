// Discovery orchestration: fetch sources → filter internships → classify eligibility → normalize → dedupe → score →
// store → notify. Runs inside refresh cycles (./refresh.ts) or on demand.
//
// Only new or changed postings cost anything: known postings are matched by (source, external id) and compared by
// content hash, and postings the location rules exclude at listing level are stored without fetching their details.

import { documentText } from "../../shared/cv";
import { GENERATABLE_STATUSES } from "../../shared/eligibility";
import { classifyRegion } from "../../shared/regions";
import { isRelevantInternship } from "../../shared/roles";
import type { DiscoveryRun, JobSkills, SourceKind, Workplace } from "../../shared/types";
import { classifyByRules, priorityFields } from "../eligibility/classify";
import { chunk, eventStmt, getActiveMasterCv, getProfile, nowIso, parseJson, placeholders } from "../lib/db";
import { detectWorkplace, htmlToMarkdown, jobFingerprint, parseDeadline, parseDuration, plainText, plainTextToMarkdown, sha256Hex } from "../lib/text";
import { buildMatchContext, extractJobSkills, MATCH_VERSION, scoreJob, type MatchContext } from "../matching/score";
import { notificationStmt } from "../notifications";
import { adapterFor } from "./registry";
import type { RawJob, SourceRef } from "./types";

export async function loadMatchContext(db: D1Database): Promise<MatchContext> {
  const [profile, cv] = await Promise.all([getProfile(db), getActiveMasterCv(db)]);
  return buildMatchContext(profile, cv ? documentText(cv.content) : null);
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function contentHash(title: string, location: string, description: string): Promise<string> {
  return sha256Hex(JSON.stringify([title.trim(), location.trim(), description.trim()]));
}

function descriptionOf(raw: RawJob): string {
  return raw.descriptionHtml ? htmlToMarkdown(raw.descriptionHtml) : plainTextToMarkdown(raw.descriptionText ?? "");
}

export interface IngestResult {
  id: number;
  created: boolean;
  changed: boolean;
  duplicateOf: number | null;
}

/** Normalizes, classifies and stores one posting. Idempotent on (source_kind, external_id); a changed description updates the stored job. */
export async function ingestJob(db: D1Database, kind: SourceKind, sourceId: number | null, raw: RawJob, ctx: MatchContext): Promise<IngestResult> {
  const now = nowIso();
  const description = descriptionOf(raw);
  const hash = await contentHash(raw.title, raw.location, description);
  const existing = await db
    .prepare("SELECT id, duplicate_of, content_hash FROM jobs WHERE source_kind = ? AND external_id = ?")
    .bind(kind, raw.externalId)
    .first<{ id: number; duplicate_of: number | null; content_hash: string | null }>();
  if (existing) {
    const changed = Boolean(description.trim()) && existing.content_hash !== null && existing.content_hash !== hash;
    if (changed) await updateChangedJob(db, existing.id, raw, description, hash, ctx);
    else {
      await db
        .prepare("UPDATE jobs SET last_seen_at = ?, closed_at = NULL, closed_reason = NULL, content_hash = COALESCE(content_hash, ?), source_updated_at = COALESCE(?, source_updated_at) WHERE id = ?")
        .bind(now, description.trim() ? hash : null, isoOrNull(raw.updatedAt), existing.id)
        .run();
    }
    return { id: existing.id, created: false, changed, duplicateOf: existing.duplicate_of };
  }

  const text = plainText(description);
  const skills = extractJobSkills(description);
  const workplace = detectWorkplace(raw.location, raw.title, text, raw.workplaceHint);
  const region = classifyRegion({ location: raw.location, workplace, description: text });
  const fingerprint = await jobFingerprint(raw.company, raw.title, raw.location);
  const match = scoreJob({ title: raw.title, description: text, location: raw.location, workplace, region, skills }, ctx);
  const { eligibility, needsModel } = classifyByRules({ company: raw.company, title: raw.title, location: raw.location, workplace, description }, ctx.profile, now);
  // Postings the rules can't settle wait for the fast model (classifyPending), which reads the full description.
  const status = needsModel ? "UNCLASSIFIED" : eligibility.status;
  const priority = priorityFields({ company: raw.company, title: raw.title, description, matchScore: match.score }, status);

  const duplicate = await db
    .prepare("SELECT id FROM jobs WHERE fingerprint = ? AND duplicate_of IS NULL ORDER BY id LIMIT 1")
    .bind(fingerprint)
    .first<{ id: number }>();

  const inserted = await db
    .prepare(
      `INSERT INTO jobs (source_id, source_kind, external_id, company, title, location, workplace, region, department, employment_type,
         duration, url, apply_url, description, skills, posted_at, deadline, fingerprint, duplicate_of, match_score, match_detail,
         eligibility, eligibility_status, priority_tier, season, priority_score, content_hash, source_updated_at, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_kind, external_id) DO NOTHING
       RETURNING id`,
    )
    .bind(
      sourceId,
      kind,
      raw.externalId,
      raw.company,
      raw.title,
      raw.location,
      workplace,
      region,
      raw.department ?? "",
      raw.employmentType ?? "",
      parseDuration(raw.title, text),
      raw.url,
      raw.applyUrl ?? raw.url,
      description,
      JSON.stringify(skills),
      isoOrNull(raw.postedAt),
      raw.deadline ?? parseDeadline(text),
      fingerprint,
      duplicate?.id ?? null,
      match.score,
      JSON.stringify(match),
      JSON.stringify(eligibility),
      status,
      priority.tier,
      priority.season,
      priority.score,
      description.trim() ? hash : null,
      isoOrNull(raw.updatedAt),
      now,
      now,
    )
    .first<{ id: number }>();

  if (!inserted) {
    // Inserted concurrently by another run.
    const row = await db.prepare("SELECT id, duplicate_of FROM jobs WHERE source_kind = ? AND external_id = ?").bind(kind, raw.externalId).first<{ id: number; duplicate_of: number | null }>();
    return { id: row?.id ?? 0, created: false, changed: false, duplicateOf: row?.duplicate_of ?? null };
  }

  const stmts = [
    eventStmt(db, "job", inserted.id, "discovered", { source: kind, score: match.score, duplicateOf: duplicate?.id ?? null, eligibility: status, reason: eligibility.reason }),
  ];
  if (!duplicate && GENERATABLE_STATUSES.includes(status) && match.score >= ctx.profile.notifyMinScore) {
    stmts.push(
      notificationStmt(db, "new_match", `${raw.company}: ${raw.title}`, `${match.score}% match, ${eligibility.reason}`, inserted.id, `new_match:${inserted.id}`),
    );
  }
  await db.batch(stmts);
  return { id: inserted.id, created: true, changed: false, duplicateOf: duplicate?.id ?? null };
}

/** A known posting whose content changed: store the new version and send it back through eligibility. */
async function updateChangedJob(db: D1Database, id: number, raw: RawJob, description: string, hash: string, ctx: MatchContext): Promise<void> {
  const now = nowIso();
  const text = plainText(description);
  const skills = extractJobSkills(description);
  const workplace = detectWorkplace(raw.location, raw.title, text, raw.workplaceHint);
  const region = classifyRegion({ location: raw.location, workplace, description: text });
  const match = scoreJob({ title: raw.title, description: text, location: raw.location, workplace, region, skills }, ctx);
  await db.batch([
    db
      .prepare(
        `UPDATE jobs SET title = ?, location = ?, workplace = ?, region = ?, description = ?, skills = ?, match_score = ?, match_detail = ?,
           deadline = COALESCE(?, deadline), content_hash = ?, content_changed_at = ?, source_updated_at = COALESCE(?, source_updated_at),
           eligibility_status = 'UNCLASSIFIED', last_seen_at = ?, closed_at = NULL, closed_reason = NULL
         WHERE id = ?`,
      )
      .bind(raw.title, raw.location, workplace, region, description, JSON.stringify(skills), match.score, JSON.stringify(match), raw.deadline ?? parseDeadline(text), hash, now, isoOrNull(raw.updatedAt), now, now, id),
    eventStmt(db, "job", id, "changed", { title: raw.title }),
  ]);
}

export interface SourceResult {
  seen: number;
  created: number;
  changed: number;
  excluded: number;
  closed: number;
}

async function discoverSource(db: D1Database, source: SourceRef, ctx: MatchContext, takeDetailBudget: () => boolean): Promise<SourceResult> {
  const adapter = adapterFor(source.kind);
  if (!adapter) return { seen: 0, created: 0, changed: 0, excluded: 0, closed: 0 };
  const startedAt = nowIso();

  const listed = await adapter.list(source);
  const relevant = listed.filter((j) => isRelevantInternship(j.title, j.department, j.employmentType));

  const known = new Map<string, { hash: string | null; sourceUpdatedAt: string | null }>();
  for (const ids of chunk(relevant.map((j) => j.externalId), 90)) {
    const { results } = await db
      .prepare(`SELECT external_id, content_hash, source_updated_at FROM jobs WHERE source_kind = ? AND external_id IN (${placeholders(ids.length)})`)
      .bind(source.kind, ...ids)
      .all<{ external_id: string; content_hash: string | null; source_updated_at: string | null }>();
    for (const r of results) known.set(r.external_id, { hash: r.content_hash, sourceUpdatedAt: r.source_updated_at });
  }

  if (known.size) {
    await db.batch(
      chunk([...known.keys()], 90).map((ids) =>
        db
          .prepare(`UPDATE jobs SET last_seen_at = ?, closed_at = NULL, closed_reason = NULL WHERE source_kind = ? AND external_id IN (${placeholders(ids.length)})`)
          .bind(startedAt, source.kind, ...ids),
      ),
    );
  }
  let closed = 0;
  if (adapter.complete) {
    const result = await db
      .prepare("UPDATE jobs SET closed_at = ?, closed_reason = 'unlisted' WHERE source_id = ? AND source_kind = ? AND closed_at IS NULL AND last_seen_at < ?")
      .bind(startedAt, source.id, source.kind, startedAt)
      .run();
    closed = result.meta.changes ?? 0;
  }

  let created = 0;
  let changed = 0;
  let excluded = 0;
  for (let job of relevant) {
    const prior = known.get(job.externalId);
    if (prior) {
      // Known posting. Descriptions in the listing are compared by hash; boards without them (Greenhouse) are
      // re-fetched only when their own updated timestamp moved.
      const listedDescription = job.descriptionHtml || job.descriptionText;
      const moved = Boolean(job.updatedAt && prior.sourceUpdatedAt && isoOrNull(job.updatedAt) !== prior.sourceUpdatedAt);
      if (!listedDescription && moved && adapter.hydrate && takeDetailBudget()) {
        try {
          job = await adapter.hydrate(source, job);
        } catch {
          continue;
        }
      }
      // Nothing to compare, and nothing new to record.
      if (!(job.descriptionHtml || job.descriptionText) && !(job.updatedAt && !prior.sourceUpdatedAt)) continue;
      // Stores the first hash or timestamp for jobs from before change detection; flags a real change otherwise.
      const result = await ingestJob(db, source.kind, source.id, job, ctx);
      if (result.changed) changed++;
      continue;
    }

    // New posting. When the listing alone shows it's out of scope (on-site in London, remote US only), it's stored as
    // EXCLUDED with its reason, without spending a detail fetch or a model call.
    const workplace = detectWorkplace(job.location, job.title, "", job.workplaceHint);
    const listingOnly = classifyByRules({ company: job.company, title: job.title, location: job.location, workplace, description: "" }, ctx.profile);
    const outOfScope = listingOnly.eligibility.status === "EXCLUDED";
    if (!outOfScope && adapter.hydrate && !job.descriptionHtml && !job.descriptionText) {
      // Out of detail budget: leave it for the next run rather than storing it without a description.
      if (!takeDetailBudget()) continue;
      try {
        job = await adapter.hydrate(source, job);
      } catch (err) {
        console.warn(JSON.stringify({ message: "discovery.hydrate_failed", source: source.name, job: job.externalId, error: String(err) }));
        continue;
      }
    }
    const result = await ingestJob(db, source.kind, source.id, job, ctx);
    if (result.created) {
      created++;
      if (outOfScope) excluded++;
    }
  }
  return { seen: relevant.length, created, changed, excluded, closed };
}

export function intVar(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export interface DiscoveryTotals extends DiscoveryRun {
  jobsChanged: number;
  jobsClosed: number;
  jobsExcluded: number;
}

/** Checks the given sources, or the least recently checked enabled ones. */
export async function runDiscovery(env: Env, opts: { trigger: "cron" | "manual"; sourceIds?: number[]; limit?: number; checkedBefore?: string }): Promise<DiscoveryTotals> {
  const db = env.DB;
  const run = await db.prepare("INSERT INTO discovery_runs (trigger) VALUES (?) RETURNING id, started_at").bind(opts.trigger).first<{ id: number; started_at: string }>();
  if (!run) throw new Error("Couldn't start a discovery run.");

  const limit = opts.limit ?? intVar(env.DISCOVERY_SOURCES_PER_RUN, 8, 1, 50);
  const sources = opts.sourceIds?.length
    ? (
        await db
          .prepare(`SELECT id, kind, identifier, name FROM sources WHERE kind != 'manual' AND id IN (${placeholders(opts.sourceIds.length)})`)
          .bind(...opts.sourceIds)
          .all<SourceRef>()
      ).results
    : (
        await db
          .prepare(
            `SELECT id, kind, identifier, name FROM sources WHERE enabled = 1 AND kind != 'manual'
             ${opts.checkedBefore ? "AND (last_run_at IS NULL OR last_run_at < ?)" : ""}
             ORDER BY last_run_at IS NOT NULL, last_run_at ASC LIMIT ?`,
          )
          .bind(...(opts.checkedBefore ? [opts.checkedBefore, limit] : [limit]))
          .all<SourceRef>()
      ).results;

  // After a deploy that changes scoring, jobs scored by the older version are brought up to date first.
  await rescoreAll(env, { staleOnly: true });
  const ctx = await loadMatchContext(db);
  let detailBudget = intVar(env.DISCOVERY_MAX_DETAIL_FETCHES, 25, 0, 500);
  const takeDetailBudget = () => detailBudget-- > 0;
  const totals = { seen: 0, created: 0, changed: 0, excluded: 0, closed: 0 };
  const errors: DiscoveryRun["errors"] = [];

  for (const source of sources) {
    try {
      const r = await discoverSource(db, source, ctx, takeDetailBudget);
      for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
      await db
        .prepare("UPDATE sources SET last_run_at = ?, last_status = 'ok', last_error = NULL, last_found = ? WHERE id = ?")
        .bind(nowIso(), r.seen, source.id)
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ source: source.name, message });
      console.error(JSON.stringify({ message: "discovery.source_failed", source: source.name, error: message }));
      await db.batch([
        db.prepare("UPDATE sources SET last_run_at = ?, last_status = 'error', last_error = ? WHERE id = ?").bind(nowIso(), message, source.id),
        eventStmt(db, "source", source.id, "failed", { message }),
        notificationStmt(db, "source_error", `${source.name} couldn't be checked`, message, null, `source_error:${source.id}:${nowIso().slice(0, 10)}`),
      ]);
    }
  }

  const finishedAt = nowIso();
  await db
    .prepare("UPDATE discovery_runs SET finished_at = ?, sources_checked = ?, jobs_seen = ?, jobs_new = ?, errors = ? WHERE id = ?")
    .bind(finishedAt, sources.length, totals.seen, totals.created, JSON.stringify(errors), run.id)
    .run();
  console.log(JSON.stringify({ message: "discovery.finished", trigger: opts.trigger, sources: sources.length, ...totals, errors: errors.length }));

  return {
    id: run.id,
    trigger: opts.trigger,
    startedAt: run.started_at,
    finishedAt,
    sourcesChecked: sources.length,
    jobsSeen: totals.seen,
    jobsNew: totals.created,
    jobsChanged: totals.changed,
    jobsClosed: totals.closed,
    jobsExcluded: totals.excluded,
    errors,
  };
}

/**
 * Recomputes regions, match scores and priorities after the profile or master CV changes.
 * `staleOnly`: only jobs scored by an older MATCH_VERSION.
 */
export async function rescoreAll(env: Env, opts: { staleOnly?: boolean } = {}): Promise<number> {
  const query = env.DB.prepare(
    `SELECT id, company, title, description, location, workplace, skills, eligibility_status FROM jobs
     WHERE (closed_at IS NULL OR id IN (SELECT job_id FROM applications))
     ${opts.staleOnly ? "AND IFNULL(json_extract(match_detail, '$.version'), 0) < ?" : ""}`,
  );
  const { results } = await (opts.staleOnly ? query.bind(MATCH_VERSION) : query).all<{
    id: number;
    company: string;
    title: string;
    description: string;
    location: string;
    workplace: Workplace;
    skills: string;
    eligibility_status: Parameters<typeof priorityFields>[1];
  }>();
  if (!results.length) return 0;

  const ctx = await loadMatchContext(env.DB);
  const updates = results.map((r) => {
    const description = plainText(r.description);
    const region = classifyRegion({ location: r.location, workplace: r.workplace, description });
    const match = scoreJob(
      { title: r.title, description, location: r.location, workplace: r.workplace, region, skills: parseJson<JobSkills>(r.skills, { required: [], preferred: [] }) },
      ctx,
    );
    const p = priorityFields({ company: r.company, title: r.title, description: r.description, matchScore: match.score }, r.eligibility_status);
    return env.DB.prepare("UPDATE jobs SET region = ?, match_score = ?, match_detail = ?, priority_tier = ?, season = ?, priority_score = ? WHERE id = ?").bind(
      region,
      match.score,
      JSON.stringify(match),
      p.tier,
      p.season,
      p.score,
      r.id,
    );
  });
  for (const group of chunk(updates, 50)) await env.DB.batch(group);
  return updates.length;
}
