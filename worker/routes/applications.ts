import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { APPLICATION_STATUSES, PRIORITIES, STATUS_LABELS, type ApplicationStatus, type ApplyKit } from "../../shared/types";
import {
  APPLICATION_SELECT,
  eventStmt,
  getApplicationRow,
  getDocument,
  getJobDetailRow,
  getLatestJobDocument,
  nowIso,
  parseJson,
  toApplication,
  toJobDetail,
  type ApplicationRow,
} from "../lib/db";
import { idParam, notFound, readJson, type AppEnv } from "../lib/validate";

export const applications = new Hono<AppEnv>();

const SUBMITTED: ApplicationStatus[] = ["applied", "interview", "offer", "rejected"];

applications.get("/", async (c) => {
  const status = c.req.query("status");
  const filter = status && (APPLICATION_STATUSES as readonly string[]).includes(status) ? "WHERE a.status = ?" : "";
  const stmt = c.env.DB.prepare(`SELECT ${APPLICATION_SELECT} FROM applications a JOIN jobs j ON j.id = a.job_id ${filter} ORDER BY a.status_changed_at DESC`);
  const { results } = await (filter ? stmt.bind(status) : stmt).all<ApplicationRow>();
  return c.json(results.map(toApplication));
});

const CreateBody = z.object({
  jobId: z.number().int().positive(),
  status: z.enum(["interested", "preparing", "ready"]).default("interested"),
  priority: z.enum(PRIORITIES).default("medium"),
});

applications.post("/", async (c) => {
  const body = await readJson(c, CreateBody);
  const db = c.env.DB;
  const job = await db.prepare("SELECT id, fingerprint FROM jobs WHERE id = ?").bind(body.jobId).first<{ id: number; fingerprint: string }>();
  if (!job) throw notFound("Job");

  const existing = await getApplicationRow(db, "a.job_id", job.id);
  if (existing) return c.json(toApplication(existing));

  // The same role listed on another platform counts as the same application.
  const twin = await db
    .prepare("SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.fingerprint = ? LIMIT 1")
    .bind(job.fingerprint)
    .first<{ id: number }>();
  if (twin) throw new HTTPException(409, { message: "You're already tracking this role from another listing." });

  const row = await db
    .prepare("INSERT INTO applications (job_id, status, priority) VALUES (?, ?, ?) ON CONFLICT (job_id) DO NOTHING RETURNING id")
    .bind(job.id, body.status, body.priority)
    .first<{ id: number }>();
  if (row) {
    await db.batch([
      eventStmt(db, "application", row.id, "created", { status: body.status, priority: body.priority }),
      db.prepare("UPDATE jobs SET dismissed_at = NULL WHERE id = ?").bind(job.id),
    ]);
  }
  const created = await getApplicationRow(db, "a.job_id", job.id);
  return c.json(toApplication(created!), 201);
});

const PatchBody = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  /** Required when moving to Applied: the user confirms they submitted it themselves. */
  confirmSubmitted: z.boolean().optional(),
  priority: z.enum(PRIORITIES).optional(),
  notes: z.string().max(20_000).optional(),
  cvDocumentId: z.number().int().positive().nullable().optional(),
  coverLetterId: z.number().int().positive().nullable().optional(),
  appliedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional(),
  checklist: z.record(z.string().max(40), z.boolean()).optional(),
});

applications.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await readJson(c, PatchBody);
  const db = c.env.DB;
  const current = await getApplicationRow(db, "a.id", id);
  if (!current) throw notFound("Application");

  const now = nowIso();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const events: D1PreparedStatement[] = [];

  if (body.status && body.status !== current.app_status) {
    const submitting = body.status === "applied" && !SUBMITTED.includes(current.app_status);
    if (submitting && body.confirmSubmitted !== true) {
      throw new HTTPException(400, { message: "Confirm that you submitted the application before marking it Applied." });
    }
    sets.push("status = ?", "status_changed_at = ?");
    params.push(body.status, now);
    if (submitting) {
      sets.push("applied_at = ?");
      params.push(body.appliedAt ?? current.applied_at ?? now);
      const checklist = { ...parseJson<Record<string, boolean>>(current.checklist, {}), submit: true };
      sets.push("checklist = ?");
      params.push(JSON.stringify(checklist));
    }
    events.push(eventStmt(db, "application", id, "status_changed", { from: current.app_status, to: body.status, label: STATUS_LABELS[body.status] }));
  } else if (body.appliedAt !== undefined) {
    sets.push("applied_at = ?");
    params.push(body.appliedAt);
  }

  if (body.priority && body.priority !== current.app_priority) {
    sets.push("priority = ?");
    params.push(body.priority);
    events.push(eventStmt(db, "application", id, "priority_changed", { from: current.app_priority, to: body.priority }));
  }
  if (body.notes !== undefined && body.notes !== current.notes) {
    sets.push("notes = ?");
    params.push(body.notes);
  }

  for (const [field, column, kind] of [
    ["cvDocumentId", "cv_document_id", "tailored_cv"],
    ["coverLetterId", "cover_letter_id", "cover_letter"],
  ] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (value !== null) {
      const doc = await db.prepare("SELECT id FROM documents WHERE id = ? AND kind IN (?, 'master_cv') AND (job_id = ? OR job_id IS NULL)").bind(value, kind, current.job_id).first();
      if (!doc) throw new HTTPException(400, { message: "That document doesn't belong to this application." });
    }
    sets.push(`${column} = ?`);
    params.push(value);
    events.push(eventStmt(db, "application", id, field === "cvDocumentId" ? "cv_selected" : "cover_letter_selected", { documentId: value }));
  }

  if (body.checklist && !sets.includes("checklist = ?")) {
    sets.push("checklist = ?");
    params.push(JSON.stringify({ ...parseJson<Record<string, boolean>>(current.checklist, {}), ...body.checklist }));
  }

  if (sets.length) {
    sets.push("updated_at = ?");
    params.push(now);
    await db.batch([db.prepare(`UPDATE applications SET ${sets.join(", ")} WHERE id = ?`).bind(...params, id), ...events]);
  }
  return c.json(toApplication((await getApplicationRow(db, "a.id", id))!));
});

applications.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = c.env.DB;
  const app = await db.prepare("SELECT job_id, status FROM applications WHERE id = ?").bind(id).first<{ job_id: number; status: string }>();
  if (!app) throw notFound("Application");
  await db.batch([db.prepare("DELETE FROM applications WHERE id = ?").bind(id), eventStmt(db, "job", app.job_id, "untracked", { status: app.status })]);
  return c.body(null, 204);
});

applications.get("/:id/kit", async (c) => {
  const id = idParam(c);
  const db = c.env.DB;
  const row = await getApplicationRow(db, "a.id", id);
  if (!row) throw notFound("Application");
  const jobRow = await getJobDetailRow(db, row.job_id);
  if (!jobRow) throw notFound("Job");

  const [cv, coverLetter, answers] = await Promise.all([
    row.cv_document_id ? getDocument(db, row.cv_document_id) : getLatestJobDocument(db, row.job_id, "tailored_cv"),
    row.cover_letter_id ? getDocument(db, row.cover_letter_id) : getLatestJobDocument(db, row.job_id, "cover_letter"),
    getLatestJobDocument(db, row.job_id, "answers"),
  ]);
  const application = toApplication(row);
  const job = toJobDetail(jobRow, [], []);
  const check = application.checklist;
  let host = "the company's site";
  try {
    host = new URL(job.applyUrl).hostname.replace(/^www\./, "");
  } catch {
    // keep default
  }

  const kit: ApplyKit = {
    application,
    job,
    cv,
    coverLetter,
    answers,
    steps: [
      {
        key: "cv",
        label: "Approve your CV",
        detail: !cv ? "Generate a tailored CV, or use your master CV" : cv.status === "approved" ? cv.title : "Review the draft and approve it",
        done: cv?.status === "approved" || Boolean(check.cv),
      },
      {
        key: "cover_letter",
        label: "Review the cover letter",
        detail: coverLetter ? coverLetter.title : "Some companies ask for one",
        done: coverLetter?.status === "approved" || Boolean(check.cover_letter),
        optional: true,
      },
      {
        key: "answers",
        label: "Prepare application answers",
        detail: answers ? answers.title : "Draft answers to common questions",
        done: answers?.status === "approved" || Boolean(check.answers),
        optional: true,
      },
      {
        key: "requirements",
        label: "Check eligibility and deadline",
        detail: job.deadline ? `Closes ${job.deadline}` : "No deadline listed",
        done: Boolean(check.requirements),
      },
      { key: "submit", label: `Submit on ${host}`, detail: "You submit the application yourself", done: Boolean(check.submit) },
      {
        key: "record",
        label: "Record the submission",
        detail: application.appliedAt ? `Applied ${application.appliedAt.slice(0, 10)}` : "Marks this application as Applied",
        done: SUBMITTED.includes(application.status),
      },
    ],
  };
  return c.json(kit);
});
