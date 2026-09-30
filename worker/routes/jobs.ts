import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { importFromUrl, ImportError, manualJob } from "../discovery/import";
import { ingestJob, loadMatchContext, rescoreAll } from "../discovery/run";
import { withModel } from "../ai/provider";
import { analyzeJob } from "../documents/generate";
import { insightsState } from "../personalization/insights";
import {
  DOCUMENT_SUMMARY_SELECT,
  eventStmt,
  getJobDetailRow,
  JOB_SUMMARY_SELECT,
  nowIso,
  parseJson,
  toDocumentSummary,
  toJobDetail,
  toJobSummary,
  type DocumentRow,
  type JobRow,
} from "../lib/db";
import { visibleFilter } from "../lib/scope";
import { ELIGIBILITY_STATUSES, STATUS_ORDER, type Eligibility } from "../../shared/eligibility";
import type { ShortlistGroup } from "../../shared/types";
import { eligibilityUpdateStmt, reclassifyJob } from "../eligibility/classify";
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
  // Eligibility: one status, "eligible" (every status that can be applied for), or all but excluded by default.
  // Tracked and hidden jobs stay visible whatever their status.
  if (q.eligibility && (ELIGIBILITY_STATUSES as readonly string[]).includes(q.eligibility)) {
    where.push("j.eligibility_status = ?");
    params.push(q.eligibility);
  } else if (q.eligibility === "eligible") {
    where.push("j.eligibility_status IN ('ELIGIBLE_REMOTE', 'ELIGIBLE_INDONESIA', 'ELIGIBLE_SINGAPORE')");
  } else if (q.view !== "tracked" && q.view !== "dismissed") {
    where.push(visibleFilter().sql);
  }
  if (q.tier && /^[1-4]$/.test(q.tier)) {
    where.push("j.priority_tier <= ?");
    params.push(Number(q.tier));
  }
  if (q.season) {
    where.push("j.season = ?");
    params.push(q.season);
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
    q.sort === "priority" || !q.sort
      ? "j.priority_score DESC, j.first_seen_at DESC"
      : q.sort === "newest"
      ? "j.first_seen_at DESC"
      : q.sort === "deadline"
        ? "j.deadline IS NULL, j.deadline ASC, j.match_score DESC"
        : "j.match_score IS NULL, j.match_score DESC, j.first_seen_at DESC"; // "score"
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
  if (result.created) {
    await eventStmt(db, "job", result.id, "imported", { via: "url" in body ? "url" : "manual" }).run();
    // A posting added by hand is classified right away, so it can be tailored without waiting for the cron.
    await reclassifyJob(c.env, result.id).catch((err) => console.warn(JSON.stringify({ message: "eligibility.import_failed", error: String(err) })));
  }
  return c.json(result, result.created ? 201 : 200);
});

/** The ranked shortlist, grouped by eligibility status: open, not hidden, not duplicates. */
jobs.get("/shortlist", async (c) => {
  const perGroup = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));
  const includeExcluded = c.req.query("excluded") === "1";
  const statuses = STATUS_ORDER.filter((s) => includeExcluded || s !== "EXCLUDED");
  const stmts = statuses.map((status) =>
    c.env.DB.prepare(
      `SELECT ${JOB_SUMMARY_SELECT} FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
       WHERE j.eligibility_status = ? AND j.closed_at IS NULL AND j.dismissed_at IS NULL AND j.duplicate_of IS NULL
       ORDER BY j.priority_score DESC, j.first_seen_at DESC LIMIT ?`,
    ).bind(status, perGroup),
  );
  const results = await c.env.DB.batch(stmts);
  const groups: ShortlistGroup[] = statuses.map((status, i) => ({ status, jobs: (results[i]!.results as JobRow[]).map(toJobSummary) }));
  return c.json(groups.filter((g) => g.jobs.length));
});

const EligibilityBody = z.union([
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reclassify") }),
  z.object({ action: z.literal("override"), status: z.enum(["ELIGIBLE_REMOTE", "ELIGIBLE_INDONESIA", "ELIGIBLE_SINGAPORE", "CHECK_MANUALLY", "EXCLUDED"]), note: z.string().trim().max(300).optional() }),
]);

/**
 * approve: a CHECK_MANUALLY posting may go through generation. reclassify: run the rules and model again.
 * override: the candidate knows better (e.g. a recruiter confirmed remote from Indonesia is fine).
 */
jobs.post("/:id/eligibility", async (c) => {
  const id = idParam(c);
  const body = await readJson(c, EligibilityBody);
  const db = c.env.DB;
  const row = await db.prepare("SELECT company, title, description, match_score, eligibility FROM jobs WHERE id = ?").bind(id).first<{
    company: string;
    title: string;
    description: string;
    match_score: number | null;
    eligibility: string | null;
  }>();
  if (!row) throw notFound("Job");
  if (body.action === "reclassify") {
    await reclassifyJob(c.env, id);
    return c.json({ ok: true });
  }
  const current = parseJson<Eligibility | null>(row.eligibility, null);
  if (!current) throw new HTTPException(409, { message: "This posting hasn't been classified yet. Reclassify it first." });
  const job = { company: row.company, title: row.title, description: row.description, matchScore: row.match_score };
  let next: Eligibility;
  if (body.action === "approve") {
    if (current.status !== "CHECK_MANUALLY") throw new HTTPException(409, { message: "Only postings marked Check manually need approval." });
    next = { ...current, approvedAt: nowIso() };
  } else {
    next = {
      ...current,
      status: body.status,
      reason: `Set manually${body.note ? `: ${body.note}` : "."} (was: ${current.reason})`,
      classifier: "rules",
      approvedAt: body.status === "CHECK_MANUALLY" ? nowIso() : null,
    };
  }
  await db.batch([eligibilityUpdateStmt(db, id, next, job), eventStmt(db, "job", id, `eligibility_${body.action}`, { status: next.status })]);
  return c.json({ ok: true });
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

jobs.post("/:id/insights", async (c) => {
  const { model } = await readJson(c, z.object({ model: z.string().max(80).optional() }));
  return c.json(await analyzeJob(withModel(c.env, model), idParam(c)));
});
