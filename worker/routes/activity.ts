import { Hono } from "hono";
import { z } from "zod";
import { APPLICATION_STATUSES, type ApplicationStatus, type AuditEvent, type Notification, type Overview } from "../../shared/types";
import { aiProviderName } from "../ai/provider";
import { getActiveMasterCv, getProfile, JOB_SUMMARY_SELECT, nowIso, parseJson, placeholders, toJobSummary, type JobRow } from "../lib/db";
import { scopeFilter } from "../lib/scope";
import { readJson, type AppEnv } from "../lib/validate";

export const activity = new Hono<AppEnv>();

activity.get("/overview", async (c) => {
  const db = c.env.DB;
  const today = new Date();
  const in14 = new Date(today.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000).toISOString();
  const [profile, cv] = await Promise.all([getProfile(db), getActiveMasterCv(db)]);
  // Untracked jobs only count inside the search area.
  const scope = scopeFilter(profile.searchScope);
  const inArea = scope ? ` AND ${scope.sql}` : "";
  const areaParams = scope?.params ?? [];

  const [statusRows, inbox, newThisWeek, unread, deadlines] = await db.batch([
    db.prepare("SELECT status, COUNT(*) AS n FROM applications GROUP BY status"),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE a.id IS NULL AND j.dismissed_at IS NULL AND j.closed_at IS NULL AND j.duplicate_of IS NULL${inArea}`,
      )
      .bind(...areaParams),
    db.prepare(`SELECT COUNT(*) AS n FROM jobs j WHERE j.first_seen_at >= ? AND j.duplicate_of IS NULL${inArea}`).bind(weekAgo, ...areaParams),
    db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL"),
    db
      .prepare(
        `SELECT ${JOB_SUMMARY_SELECT} FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
         WHERE j.deadline BETWEEN ? AND ? AND j.closed_at IS NULL AND j.dismissed_at IS NULL
           AND (a.status IN ('interested', 'preparing', 'ready') OR (a.id IS NULL AND j.duplicate_of IS NULL AND j.match_score >= 60${inArea}))
         ORDER BY j.deadline ASC LIMIT 6`,
      )
      .bind(today.toISOString().slice(0, 10), in14, ...areaParams),
  ]);

  const counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  for (const r of statusRows!.results as { status: ApplicationStatus; n: number }[]) counts[r.status] = r.n;
  counts.discovered += (inbox!.results[0] as { n: number }).n;

  const overview: Overview = {
    counts,
    newThisWeek: (newThisWeek!.results[0] as { n: number }).n,
    unreadNotifications: (unread!.results[0] as { n: number }).n,
    upcomingDeadlines: (deadlines!.results as JobRow[]).map(toJobSummary),
    hasMasterCv: Boolean(cv),
    profileComplete: profile.skills.length > 0 && profile.targetRoles.length > 0,
    aiProvider: aiProviderName(c.env),
  };
  return c.json(overview);
});

activity.get("/notifications", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT 60").all<{
    id: number;
    kind: Notification["kind"];
    title: string;
    body: string;
    job_id: number | null;
    read_at: string | null;
    created_at: string;
  }>();
  return c.json(
    results.map<Notification>((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, jobId: n.job_id, readAt: n.read_at, createdAt: n.created_at })),
  );
});

activity.post("/notifications/read", async (c) => {
  const { ids } = await readJson(c, z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }));
  const db = c.env.DB;
  if (ids?.length) await db.prepare(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND id IN (${placeholders(ids.length)})`).bind(nowIso(), ...ids).run();
  else await db.prepare("UPDATE notifications SET read_at = ? WHERE read_at IS NULL").bind(nowIso()).run();
  return c.json({ ok: true });
});

activity.get("/events", async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const before = Number(c.req.query("before"));
  const entityType = c.req.query("entityType");
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (Number.isInteger(before) && before > 0) {
    where.push("e.id < ?");
    params.push(before);
  }
  if (entityType) {
    where.push("e.entity_type = ?");
    params.push(entityType);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.entity_type, e.entity_id, e.action, e.detail, e.created_at,
       CASE e.entity_type
         WHEN 'job' THEN (SELECT company || ': ' || title FROM jobs WHERE id = e.entity_id)
         WHEN 'application' THEN (SELECT j.company || ': ' || j.title FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = e.entity_id)
         WHEN 'document' THEN (SELECT title FROM documents WHERE id = e.entity_id)
         WHEN 'source' THEN (SELECT name FROM sources WHERE id = e.entity_id)
       END AS label,
       CASE e.entity_type
         WHEN 'job' THEN e.entity_id
         WHEN 'application' THEN (SELECT job_id FROM applications WHERE id = e.entity_id)
         WHEN 'document' THEN (SELECT job_id FROM documents WHERE id = e.entity_id)
       END AS job_id
     FROM events e ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY e.id DESC LIMIT ?`,
  )
    .bind(...params, limit)
    .all<{ id: number; entity_type: AuditEvent["entityType"]; entity_id: number | null; action: string; detail: string; created_at: string; label: string | null; job_id: number | null }>();
  return c.json(
    results.map((e) => ({
      id: e.id,
      entityType: e.entity_type,
      entityId: e.entity_id,
      action: e.action,
      detail: { ...parseJson<Record<string, unknown>>(e.detail, {}), jobId: e.job_id },
      createdAt: e.created_at,
      label: e.label,
    })),
  );
});
