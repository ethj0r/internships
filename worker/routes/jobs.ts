import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { importFromUrl, ImportError, manualJob } from "../discovery/import";
import { ingestJob, loadMatchContext, rescoreAll } from "../discovery/run";
import { analyzeJob } from "../documents/generate";
import { insightsState } from "../personalization/insights";
import {
  DOCUMENT_SUMMARY_SELECT,
  eventStmt,
  getJobDetailRow,
  getProfile,
  JOB_SUMMARY_SELECT,
  nowIso,
  parseJson,
  toDocumentSummary,
  toJobDetail,
  toJobSummary,
  type DocumentRow,
  type JobRow,
} from "../lib/db";
import { scopeFilter } from "../lib/scope";
import { idParam, notFound, readJson, type AppEnv } from "../lib/validate";

export const jobs = new Hono<AppEnv>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

jobs.get("/", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const params: (string | number)[] = [];

  switch (q.view) {
    case "tracked":
      where.push("a.id IS NOT NULL");
      break;
    case "dismissed":
      where.push("j.dismissed_at IS NOT NULL");
      break;
    case "all":
      where.push("j.closed_at IS NULL", "j.duplicate_of IS NULL");
      break;
    default: // inbox: open, untracked, not dismissed, not a duplicate
      where.push("a.id IS NULL", "j.dismissed_at IS NULL", "j.closed_at IS NULL", "j.duplicate_of IS NULL");
  }
  // Tracked and hidden jobs stay visible whatever the search area.
  if (q.view !== "tracked" && q.view !== "dismissed") {
    const scope = scopeFilter((await getProfile(c.env.DB)).searchScope);
    if (scope) {
      where.push(scope.sql);
      params.push(...scope.params);
    }
  }
  if (q.region === "indonesia") where.push("j.region = 'indonesia'");
  else if (q.region === "asia") where.push("j.region IN ('asia', 'remote_asia')");
  const search = q.q?.trim();
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push("(j.title LIKE ? ESCAPE '\\' OR j.company LIKE ? ESCAPE '\\' OR j.location LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  if (q.workplace === "remote" || q.workplace === "hybrid" || q.workplace === "onsite") {
    where.push("j.workplace = ?");
    params.push(q.workplace);
  }
  const minScore = Number(q.minScore);
  if (Number.isFinite(minScore) && minScore > 0) {
    where.push("j.match_score >= ?");
    params.push(minScore);
  }
  if (q.source) {
    where.push("j.source_kind = ?");
    params.push(q.source);
  }
  if (q.hasDeadline === "1") where.push("j.deadline IS NOT NULL AND j.deadline >= date('now')");

  const order =
    q.sort === "newest"
      ? "j.first_seen_at DESC"
      : q.sort === "deadline"
        ? "j.deadline IS NULL, j.deadline ASC, j.match_score DESC"
        : "j.match_score IS NULL, j.match_score DESC, j.first_seen_at DESC";
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 100));
  const offset = Math.max(0, Number(q.offset) || 0);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [list, count] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT ${JOB_SUMMARY_SELECT} FROM jobs j LEFT JOIN applications a ON a.job_id = j.id ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(
      ...params,
      limit,
      offset,
    ),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM jobs j LEFT JOIN applications a ON a.job_id = j.id ${whereSql}`).bind(...params),
  ]);
  return c.json({
    jobs: (list!.results as JobRow[]).map(toJobSummary),
    total: (count!.results[0] as { n: number }).n,
  });
});

const ImportBody = z.union([
  z.object({ url: z.string().trim().min(1) }),
  z.object({
    manual: z.object({
      company: z.string().trim().min(1, "Enter the company").max(200),
      title: z.string().trim().min(1, "Enter the position").max(300),
      location: z.string().max(200).optional(),
      url: z
        .string()
        .trim()
        .max(2000)
        .refine((v) => v === "" || /^https?:\/\//i.test(v), "Enter a full URL, starting with https://")
        .optional(),
      description: z.string().max(100_000).optional(),
      deadline: z.string().regex(DATE).nullable().optional(),
    }),
  }),
]);

jobs.post("/import", async (c) => {
  const body = await readJson(c, ImportBody);
  let imported;
  try {
    imported = "url" in body ? await importFromUrl(body.url) : await manualJob(body.manual);
  } catch (err) {
    if (err instanceof ImportError) throw new HTTPException(422, { message: err.message });
    throw err;
  }
  const db = c.env.DB;
  const source = imported.identifier
    ? await db.prepare("SELECT id FROM sources WHERE kind = ? AND identifier = ?").bind(imported.kind, imported.identifier).first<{ id: number }>()
    : await db.prepare("SELECT id FROM sources WHERE kind = 'manual' LIMIT 1").first<{ id: number }>();
  const result = await ingestJob(db, imported.kind, source?.id ?? null, imported.raw, await loadMatchContext(db));
  if (result.created) await eventStmt(db, "job", result.id, "imported", { via: "url" in body ? "url" : "manual" }).run();
  return c.json(result, result.created ? 201 : 200);
});

jobs.post("/rescore", async (c) => c.json({ updated: await rescoreAll(c.env) }));

jobs.get("/:id", async (c) => {
  const id = idParam(c);
  const db = c.env.DB;
  const row = await getJobDetailRow(db, id);
  if (!row) throw notFound("Job");
  const [duplicates, documents] = await db.batch([
    db
      .prepare(
        `SELECT ${JOB_SUMMARY_SELECT} FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
         WHERE j.id != ? AND (j.fingerprint = ? OR j.duplicate_of = ? OR j.id = ?) ORDER BY j.id`,
      )
      .bind(id, row.fingerprint, id, row.duplicate_of ?? -1),
    db.prepare(`SELECT ${DOCUMENT_SUMMARY_SELECT} FROM documents d LEFT JOIN jobs j ON j.id = d.job_id WHERE d.job_id = ? ORDER BY d.updated_at DESC`).bind(id),
  ]);
  const detail = toJobDetail(row, (duplicates!.results as JobRow[]).map(toJobSummary), (documents!.results as DocumentRow[]).map(toDocumentSummary));
  const { insights, stale } = await insightsState(db, detail);
  return c.json({ ...detail, insights, insightsStale: stale });
});

jobs.get("/:id/events", async (c) => {
  const id = idParam(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, entity_type, entity_id, action, detail, created_at FROM events
     WHERE (entity_type = 'job' AND entity_id = ?1)
        OR (entity_type = 'application' AND entity_id IN (SELECT id FROM applications WHERE job_id = ?1))
        OR (entity_type = 'document' AND entity_id IN (SELECT id FROM documents WHERE job_id = ?1))
     ORDER BY id DESC LIMIT 100`,
  )
    .bind(id)
    .all<{ id: number; entity_type: string; entity_id: number | null; action: string; detail: string; created_at: string }>();
  return c.json(
    results.map((e) => ({ id: e.id, entityType: e.entity_type, entityId: e.entity_id, action: e.action, detail: parseJson(e.detail, {}), createdAt: e.created_at })),
  );
});

const JobPatch = z.object({
  deadline: z.string().regex(DATE, "Use YYYY-MM-DD").nullable().optional(),
  dismissed: z.boolean().optional(),
});

jobs.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await readJson(c, JobPatch);
  const db = c.env.DB;
  const current = await db.prepare("SELECT deadline, dismissed_at FROM jobs WHERE id = ?").bind(id).first<{ deadline: string | null; dismissed_at: string | null }>();
  if (!current) throw notFound("Job");

  const stmts: D1PreparedStatement[] = [];
  if (body.deadline !== undefined && body.deadline !== current.deadline) {
    stmts.push(db.prepare("UPDATE jobs SET deadline = ? WHERE id = ?").bind(body.deadline, id));
    stmts.push(eventStmt(db, "job", id, "deadline_changed", { from: current.deadline, to: body.deadline }));
  }
  if (body.dismissed !== undefined && body.dismissed !== Boolean(current.dismissed_at)) {
    stmts.push(db.prepare("UPDATE jobs SET dismissed_at = ? WHERE id = ?").bind(body.dismissed ? nowIso() : null, id));
    stmts.push(eventStmt(db, "job", id, body.dismissed ? "dismissed" : "restored"));
  }
  if (stmts.length) await db.batch(stmts);
  const row = await getJobDetailRow(db, id);
  return c.json(toJobDetail(row!, [], []));
});

jobs.post("/:id/insights", async (c) => c.json(await analyzeJob(c.env, idParam(c))));
