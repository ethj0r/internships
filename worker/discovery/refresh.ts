// Refresh cycles: every REFRESH_INTERVAL_HOURS (72 by default) every enabled source is checked once.
//
// Why a stored timestamp instead of a cron expression: "*/3" on day-of-month restarts every month (the 31st and
// the 1st run back to back, and February ends with a 1–2 day gap), so the hourly cron checks when the last cycle
// started and starts a new one once 72 hours have passed. A cycle is spread over several hourly runs so each stays
// inside Workers' per-invocation limits; runs between cycles only classify leftovers and return.

import type { EligibilityStatus } from "../../shared/eligibility";
import type { RefreshCycle, RefreshSummary } from "../../shared/types";
import { classifyPending } from "../eligibility/classify";
import { eventStmt, nowIso, parseJson, placeholders } from "../lib/db";
import { adapterFor } from "./registry";
import { intVar, runDiscovery } from "./run";

interface CycleRow {
  id: number;
  trigger: "cron" | "manual";
  started_at: string;
  finished_at: string | null;
  sources_total: number;
  sources_checked: number;
  jobs_new: number;
  jobs_changed: number;
  jobs_closed: number;
  summary: string;
  errors: string;
}

export function toRefreshCycle(r: CycleRow): RefreshCycle {
  const summary = parseJson<Partial<RefreshSummary>>(r.summary, {});
  return {
    id: r.id,
    trigger: r.trigger,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    sourcesTotal: r.sources_total,
    sourcesChecked: r.sources_checked,
    jobsNew: r.jobs_new,
    jobsChanged: r.jobs_changed,
    jobsClosed: r.jobs_closed,
    summary: summary.newPostings !== undefined ? (summary as RefreshSummary) : null,
  };
}

export async function listCycles(db: D1Database, limit = 10): Promise<RefreshCycle[]> {
  const { results } = await db.prepare("SELECT * FROM refresh_cycles ORDER BY id DESC LIMIT ?").bind(limit).all<CycleRow>();
  return results.map(toRefreshCycle);
}

/** Whether a new cycle is due. Pure, for tests. */
export function cycleDue(last: { startedAt: string; finishedAt: string | null } | null, now: Date, intervalHours: number): boolean {
  if (!last) return true;
  if (!last.finishedAt) return false;
  return now.getTime() - Date.parse(last.startedAt) >= intervalHours * 3_600_000;
}

async function remainingSources(db: D1Database, startedAt: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM sources WHERE enabled = 1 AND kind != 'manual' AND (last_run_at IS NULL OR last_run_at < ?)")
    .bind(startedAt)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function startCycle(db: D1Database, trigger: "cron" | "manual"): Promise<CycleRow> {
  const total = await db.prepare("SELECT COUNT(*) AS n FROM sources WHERE enabled = 1 AND kind != 'manual'").first<{ n: number }>();
  const row = await db.prepare("INSERT INTO refresh_cycles (trigger, sources_total) VALUES (?, ?) RETURNING *").bind(trigger, total?.n ?? 0).first<CycleRow>();
  if (!row) throw new Error("Couldn't start a refresh cycle.");
  console.log(JSON.stringify({ message: "refresh.started", cycle: row.id, trigger, sources: row.sources_total }));
  return row;
}

/** Closes what can only be detected once per cycle: stale postings on incomplete sources, and passed deadlines. */
async function closeStale(db: D1Database, cycle: CycleRow): Promise<number> {
  const now = nowIso();
  const previous = await db.prepare("SELECT started_at FROM refresh_cycles WHERE id < ? ORDER BY id DESC LIMIT 1").bind(cycle.id).first<{ started_at: string }>();
  let closed = 0;
  // Aggregators don't list every open posting, so a job is only closed after going unseen for two cycles.
  const incompleteKinds = ["themuse", "himalayas"].filter((k) => adapterFor(k as never)?.complete === false);
  if (previous && incompleteKinds.length) {
    const r = await db
      .prepare(
        `UPDATE jobs SET closed_at = ?, closed_reason = 'not_seen'
         WHERE closed_at IS NULL AND source_kind IN (${placeholders(incompleteKinds.length)}) AND last_seen_at < ?
           AND id NOT IN (SELECT job_id FROM applications)`,
      )
      .bind(now, ...incompleteKinds, previous.started_at)
      .run();
    closed += r.meta.changes ?? 0;
  }
  const expired = await db
    .prepare("UPDATE jobs SET closed_at = ?, closed_reason = 'expired' WHERE closed_at IS NULL AND deadline IS NOT NULL AND deadline < date('now')")
    .bind(now)
    .run();
  return closed + (expired.meta.changes ?? 0);
}

async function summarize(db: D1Database, cycle: CycleRow, closedAtEnd: number): Promise<RefreshSummary> {
  const byStatusRows = await db
    .prepare(
      `SELECT eligibility_status AS status, COUNT(*) AS n FROM jobs
       WHERE duplicate_of IS NULL AND (first_seen_at >= ? OR content_changed_at >= ?) GROUP BY eligibility_status`,
    )
    .bind(cycle.started_at, cycle.started_at)
    .all<{ status: EligibilityStatus; n: number }>();
  const openRows = await db
    .prepare("SELECT eligibility_status AS status, COUNT(*) AS n FROM jobs WHERE closed_at IS NULL AND duplicate_of IS NULL GROUP BY eligibility_status")
    .all<{ status: EligibilityStatus; n: number }>();
  const top = await db
    .prepare(
      `SELECT id, company, title, eligibility_status AS status, priority_tier AS tier FROM jobs
       WHERE first_seen_at >= ? AND duplicate_of IS NULL AND closed_at IS NULL AND priority_tier <= 3
         AND eligibility_status IN ('ELIGIBLE_REMOTE', 'ELIGIBLE_INDONESIA', 'ELIGIBLE_SINGAPORE', 'CHECK_MANUALLY')
       ORDER BY priority_score DESC LIMIT 10`,
    )
    .bind(cycle.started_at)
    .all<RefreshSummary["topNew"][number]>();
  const newRow = await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE first_seen_at >= ? AND duplicate_of IS NULL").bind(cycle.started_at).first<{ n: number }>();
  const toMap = (rows: { status: EligibilityStatus; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return {
    newPostings: newRow?.n ?? cycle.jobs_new,
    changedPostings: cycle.jobs_changed,
    closedPostings: cycle.jobs_closed + closedAtEnd,
    byStatus: toMap(byStatusRows.results),
    openByStatus: toMap(openRows.results),
    topNew: top.results,
    errors: parseJson(cycle.errors, []),
  };
}

async function finishCycle(db: D1Database, cycle: CycleRow): Promise<RefreshSummary> {
  const closed = await closeStale(db, cycle);
  const summary = await summarize(db, cycle, closed);
  const finishedAt = nowIso();
  await db.batch([
    db
      .prepare("UPDATE refresh_cycles SET finished_at = ?, jobs_closed = ?, summary = ? WHERE id = ?")
      .bind(finishedAt, summary.closedPostings, JSON.stringify(summary), cycle.id),
    eventStmt(db, "source", null, "refresh_finished", { cycle: cycle.id, ...summary, topNew: summary.topNew.length }),
  ]);
  // The run summary asked for in the logs: new, closed, and how many landed in each eligibility status.
  console.log(
    JSON.stringify({
      message: "refresh.summary",
      cycle: cycle.id,
      startedAt: cycle.started_at,
      finishedAt,
      new: summary.newPostings,
      changed: summary.changedPostings,
      closed: summary.closedPostings,
      byStatus: summary.byStatus,
      openByStatus: summary.openByStatus,
      topNew: summary.topNew.map((j) => `${j.company}: ${j.title}`),
      errors: summary.errors.length,
    }),
  );
  return summary;
}

export interface RefreshTick {
  action: "started" | "continued" | "finished" | "idle";
  cycle: RefreshCycle | null;
  classified: number;
}

/**
 * One hourly tick. `force` starts a new cycle now (the "Refresh now" button); otherwise a cycle starts only when
 * it's due.
 */
export async function runScheduledRefresh(env: Env, opts: { trigger: "cron" | "manual"; force?: boolean } = { trigger: "cron" }): Promise<RefreshTick> {
  const db = env.DB;
  const interval = intVar(env.REFRESH_INTERVAL_HOURS, 72, 1, 24 * 30);
  const modelBudget = intVar(env.ELIGIBILITY_MODEL_CALLS_PER_RUN, 20, 0, 200);
  let cycle = await db.prepare("SELECT * FROM refresh_cycles ORDER BY id DESC LIMIT 1").first<CycleRow>();
  let action: RefreshTick["action"] = "continued";

  const due = cycleDue(cycle ? { startedAt: cycle.started_at, finishedAt: cycle.finished_at } : null, new Date(), interval);
  if (opts.force || due) {
    if (cycle && !cycle.finished_at) await db.prepare("UPDATE refresh_cycles SET finished_at = ? WHERE id = ?").bind(nowIso(), cycle.id).run();
    cycle = await startCycle(db, opts.trigger);
    action = "started";
  } else if (!cycle || cycle.finished_at) {
    // Between cycles: only finish classifying postings the model hasn't reached yet.
    const pending = await classifyPending(env, { modelBudget });
    return { action: "idle", cycle: cycle ? toRefreshCycle(cycle) : null, classified: pending.classified };
  }

  const run = await runDiscovery(env, { trigger: opts.trigger, checkedBefore: cycle.started_at });
  const errors = [...parseJson<{ source: string; message: string }[]>(cycle.errors, []), ...run.errors];
  cycle = (await db
    .prepare(
      `UPDATE refresh_cycles SET sources_checked = sources_checked + ?, jobs_new = jobs_new + ?, jobs_changed = jobs_changed + ?,
         jobs_closed = jobs_closed + ?, errors = ? WHERE id = ? RETURNING *`,
    )
    .bind(run.sourcesChecked, run.jobsNew, run.jobsChanged, run.jobsClosed, JSON.stringify(errors), cycle.id)
    .first<CycleRow>())!;

  // New and changed postings go through eligibility before anything else can use them.
  const pending = await classifyPending(env, { modelBudget });

  if ((await remainingSources(db, cycle.started_at)) === 0) {
    await finishCycle(db, cycle);
    cycle = (await db.prepare("SELECT * FROM refresh_cycles WHERE id = ?").bind(cycle.id).first<CycleRow>())!;
    action = "finished";
  }
  return { action, cycle: toRefreshCycle(cycle), classified: pending.classified };
}
