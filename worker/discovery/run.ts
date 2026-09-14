// Discovery orchestration: fetch sources → filter relevant internships → normalize → dedupe → score → store → notify.

import { isRelevantInternship } from "../../shared/roles";
import type { DiscoveryRun, JobSkills, SourceKind, Workplace } from "../../shared/types";
import { chunk, eventStmt, getActiveMasterCv, getProfile, nowIso, parseJson, placeholders } from "../lib/db";
import { detectWorkplace, htmlToMarkdown, jobFingerprint, parseDeadline, parseDuration, plainText, plainTextToMarkdown } from "../lib/text";
import { buildMatchContext, extractJobSkills, scoreJob, type MatchContext } from "../matching/score";
import { notificationStmt } from "../notifications";
import { adapterFor } from "./registry";
import type { RawJob, SourceRef } from "./types";

export async function loadMatchContext(db: D1Database): Promise<MatchContext> {
  const [profile, cv] = await Promise.all([getProfile(db), getActiveMasterCv(db)]);
  return buildMatchContext(profile, cv?.content ?? null);
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface IngestResult {
  id: number;
  created: boolean;
  duplicateOf: number | null;
}

/** Normalizes and stores one posting. Idempotent on (source_kind, external_id). */
export async function ingestJob(db: D1Database, kind: SourceKind, sourceId: number | null, raw: RawJob, ctx: MatchContext): Promise<IngestResult> {
  const now = nowIso();
  const existing = await db
    .prepare("SELECT id, duplicate_of FROM jobs WHERE source_kind = ? AND external_id = ?")
    .bind(kind, raw.externalId)
    .first<{ id: number; duplicate_of: number | null }>();
  if (existing) {
    await db.prepare("UPDATE jobs SET last_seen_at = ?, closed_at = NULL WHERE id = ?").bind(now, existing.id).run();
    return { id: existing.id, created: false, duplicateOf: existing.duplicate_of };
  }

  const description = raw.descriptionHtml ? htmlToMarkdown(raw.descriptionHtml) : plainTextToMarkdown(raw.descriptionText ?? "");
  const text = plainText(description);
  const skills = extractJobSkills(description);
  const workplace = detectWorkplace(raw.location, raw.title, text, raw.workplaceHint);
  const fingerprint = await jobFingerprint(raw.company, raw.title, raw.location);
  const match = scoreJob({ title: raw.title, description: text, location: raw.location, workplace, skills }, ctx);

  const duplicate = await db
    .prepare("SELECT id FROM jobs WHERE fingerprint = ? AND duplicate_of IS NULL ORDER BY id LIMIT 1")
    .bind(fingerprint)
    .first<{ id: number }>();

  const inserted = await db
    .prepare(
      `INSERT INTO jobs (source_id, source_kind, external_id, company, title, location, workplace, department, employment_type,
         duration, url, apply_url, description, skills, posted_at, deadline, fingerprint, duplicate_of, match_score, match_detail,
         first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      now,
      now,
    )
    .first<{ id: number }>();

  if (!inserted) {
    // Inserted concurrently by another run.
    const row = await db.prepare("SELECT id, duplicate_of FROM jobs WHERE source_kind = ? AND external_id = ?").bind(kind, raw.externalId).first<{ id: number; duplicate_of: number | null }>();
    return { id: row?.id ?? 0, created: false, duplicateOf: row?.duplicate_of ?? null };
  }

  const stmts = [eventStmt(db, "job", inserted.id, "discovered", { source: kind, score: match.score, duplicateOf: duplicate?.id ?? null })];
  if (!duplicate && match.score >= ctx.profile.notifyMinScore) {
    stmts.push(
      notificationStmt(db, "new_match", `${raw.company}: ${raw.title}`, `${match.score}% match${raw.location ? `, ${raw.location}` : ""}`, inserted.id, `new_match:${inserted.id}`),
    );
  }
  await db.batch(stmts);
  return { id: inserted.id, created: true, duplicateOf: duplicate?.id ?? null };
}

async function discoverSource(db: D1Database, source: SourceRef, ctx: MatchContext, takeDetailBudget: () => boolean) {
  const adapter = adapterFor(source.kind);
  if (!adapter) return { seen: 0, created: 0 };
  const startedAt = nowIso();

  const listed = await adapter.list(source);
  const relevant = listed.filter((j) => isRelevantInternship(j.title, j.department, j.employmentType));

  const known = new Set<string>();
  for (const ids of chunk(relevant.map((j) => j.externalId), 90)) {
    const { results } = await db
      .prepare(`SELECT external_id FROM jobs WHERE source_kind = ? AND external_id IN (${placeholders(ids.length)})`)
      .bind(source.kind, ...ids)
      .all<{ external_id: string }>();
    for (const r of results) known.add(r.external_id);
  }

  const knownIds = [...known];
  if (knownIds.length) {
    await db.batch(
      chunk(knownIds, 90).map((ids) =>
        db
          .prepare(`UPDATE jobs SET last_seen_at = ?, closed_at = NULL WHERE source_kind = ? AND external_id IN (${placeholders(ids.length)})`)
          .bind(startedAt, source.kind, ...ids),
      ),
    );
  }
  if (adapter.complete) {
    await db
      .prepare("UPDATE jobs SET closed_at = ? WHERE source_id = ? AND source_kind = ? AND closed_at IS NULL AND last_seen_at < ?")
      .bind(startedAt, source.id, source.kind, startedAt)
      .run();
  }

  let created = 0;
  for (let job of relevant) {
    if (known.has(job.externalId)) continue;
    if (adapter.hydrate && !job.descriptionHtml && !job.descriptionText) {
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
    if (result.created) created++;
  }
  return { seen: relevant.length, created };
}

function intVar(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export async function runDiscovery(env: Env, opts: { trigger: "cron" | "manual"; sourceIds?: number[] }): Promise<DiscoveryRun> {
  const db = env.DB;
  const run = await db.prepare("INSERT INTO discovery_runs (trigger) VALUES (?) RETURNING id, started_at").bind(opts.trigger).first<{ id: number; started_at: string }>();
  if (!run) throw new Error("Couldn't start a discovery run.");

  const sources = opts.sourceIds?.length
    ? (
        await db
          .prepare(`SELECT id, kind, identifier, name FROM sources WHERE kind != 'manual' AND id IN (${placeholders(opts.sourceIds.length)})`)
          .bind(...opts.sourceIds)
          .all<SourceRef>()
      ).results
    : (
        await db
          .prepare("SELECT id, kind, identifier, name FROM sources WHERE enabled = 1 AND kind != 'manual' ORDER BY last_run_at IS NOT NULL, last_run_at ASC LIMIT ?")
          .bind(intVar(env.DISCOVERY_SOURCES_PER_RUN, 6, 1, 50))
          .all<SourceRef>()
      ).results;

  const ctx = await loadMatchContext(db);
  let detailBudget = intVar(env.DISCOVERY_MAX_DETAIL_FETCHES, 25, 0, 500);
  const takeDetailBudget = () => detailBudget-- > 0;
  let jobsSeen = 0;
  let jobsNew = 0;
  const errors: DiscoveryRun["errors"] = [];

  for (const source of sources) {
    try {
      const { seen, created } = await discoverSource(db, source, ctx, takeDetailBudget);
      jobsSeen += seen;
      jobsNew += created;
      await db
        .prepare("UPDATE sources SET last_run_at = ?, last_status = 'ok', last_error = NULL, last_found = ? WHERE id = ?")
        .bind(nowIso(), seen, source.id)
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
    .bind(finishedAt, sources.length, jobsSeen, jobsNew, JSON.stringify(errors), run.id)
    .run();
  console.log(JSON.stringify({ message: "discovery.finished", trigger: opts.trigger, sources: sources.length, jobsSeen, jobsNew, errors: errors.length }));

  return { id: run.id, trigger: opts.trigger, startedAt: run.started_at, finishedAt, sourcesChecked: sources.length, jobsSeen, jobsNew, errors };
}

/** Recomputes match scores after the profile or master CV changes. */
export async function rescoreAll(env: Env): Promise<number> {
  const ctx = await loadMatchContext(env.DB);
  const { results } = await env.DB.prepare(
    "SELECT id, title, description, location, workplace, skills FROM jobs WHERE closed_at IS NULL OR id IN (SELECT job_id FROM applications)",
  ).all<{ id: number; title: string; description: string; location: string; workplace: Workplace; skills: string }>();

  const updates = results.map((r) => {
    const match = scoreJob(
      { title: r.title, description: plainText(r.description), location: r.location, workplace: r.workplace, skills: parseJson<JobSkills>(r.skills, { required: [], preferred: [] }) },
      ctx,
    );
    return env.DB.prepare("UPDATE jobs SET match_score = ?, match_detail = ? WHERE id = ?").bind(match.score, JSON.stringify(match), r.id);
  });
  for (const group of chunk(updates, 50)) await env.DB.batch(group);
  return updates.length;
}
