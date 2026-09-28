import type { Notification } from "../shared/types";
import { getProfile } from "./lib/db";
import { scopeFilter } from "./lib/scope";

export function notificationStmt(
  db: D1Database,
  kind: Notification["kind"],
  title: string,
  body: string,
  jobId: number | null,
  dedupeKey: string,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO notifications (kind, title, body, job_id, dedupe_key) VALUES (?, ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING")
    .bind(kind, title, body, jobId, dedupeKey);
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Daily: reminds about deadlines within a week for tracked (not yet applied) and strongly matching jobs. */
export async function runDeadlineReminders(env: Env): Promise<number> {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const scope = scopeFilter((await getProfile(env.DB)).searchScope);
  const { results } = await env.DB.prepare(
    `SELECT j.id, j.company, j.title, j.deadline
     FROM jobs j
     LEFT JOIN applications a ON a.job_id = j.id
     WHERE j.deadline BETWEEN ? AND ?
       AND j.closed_at IS NULL AND j.dismissed_at IS NULL AND j.duplicate_of IS NULL
       AND (a.status IN ('interested', 'preparing', 'ready')
            OR (a.id IS NULL AND j.match_score >= (SELECT notify_min_score FROM profile WHERE id = 1)${scope ? ` AND ${scope.sql}` : ""}))`,
  )
    .bind(todayStr, addDays(today, 7), ...(scope?.params ?? []))
    .all<{ id: number; company: string; title: string; deadline: string }>();

  const stmts = results.map((job) => {
    const days = Math.round((Date.parse(job.deadline) - Date.parse(todayStr)) / 86_400_000);
    const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    const bucket = days <= 1 ? "1d" : days <= 3 ? "3d" : "7d";
    return notificationStmt(env.DB, "deadline", `${job.company} closes ${when}`, job.title, job.id, `deadline:${job.id}:${job.deadline}:${bucket}`);
  });
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}
