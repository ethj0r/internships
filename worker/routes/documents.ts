import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { isLatexCv } from "../../shared/cv";
import { rescoreAll } from "../discovery/run";
import { withModel } from "../ai/provider";
import { generateAnswers, generateCoverLetter, generateTailoredCv, metaAfterEdit, reviewDocument } from "../documents/generate";
import {
  DOCUMENT_SUMMARY_SELECT,
  eventStmt,
  getDocument,
  nowIso,
  toDocumentSummary,
  type DocumentRow,
} from "../lib/db";
import { idParam, notFound, readJson, type AppEnv } from "../lib/validate";

export const documents = new Hono<AppEnv>();

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(["tex", "md", "markdown", "txt"]);
const CONVERTIBLE_EXTENSIONS = new Set(["pdf", "docx", "odt", "html", "htm"]);

function rescoreInBackground(c: Context<AppEnv>) {
  c.executionCtx.waitUntil(
    rescoreAll(c.env).catch((err) => console.error(JSON.stringify({ message: "rescore.failed", error: String(err) }))),
  );
}

documents.get("/", async (c) => {
  const kind = c.req.query("kind");
  const jobId = Number(c.req.query("jobId"));
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (kind) {
    where.push("d.kind = ?");
    params.push(kind);
  }
  if (Number.isInteger(jobId) && jobId > 0) {
    where.push("d.job_id = ?");
    params.push(jobId);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT ${DOCUMENT_SUMMARY_SELECT} FROM documents d LEFT JOIN jobs j ON j.id = d.job_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY d.kind = 'master_cv' DESC, d.updated_at DESC`,
  )
    .bind(...params)
    .all<DocumentRow>();
  return c.json(results.map(toDocumentSummary));
});

async function convertToMarkdown(env: Env, file: File): Promise<string> {
  const result = await env.AI.toMarkdown([{ name: file.name, blob: new Blob([await file.arrayBuffer()], { type: file.type || "application/octet-stream" }) }]);
  const first = Array.isArray(result) ? result[0] : result;
  if (!first || first.format === "error" || !first.data) {
    throw new HTTPException(422, { message: "Couldn't read that file. Try a DOCX, or paste the text instead." });
  }
  return first.data;
}

documents.post("/master", async (c) => {
  let title = "Master CV";
  let content: string;
  let filename: string | null = null;

  if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HTTPException(400, { message: "Choose a file to upload." });
    if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "Files must be 5 MB or smaller." });
    filename = file.name;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (TEXT_EXTENSIONS.has(ext)) content = await file.text();
    else if (CONVERTIBLE_EXTENSIONS.has(ext)) content = await convertToMarkdown(c.env, file);
    else throw new HTTPException(415, { message: "Upload a PDF, DOCX, Markdown or plain text file." });
  } else {
    const body = await readJson(c, z.object({ title: z.string().trim().min(1).max(200).optional(), content: z.string().max(100_000) }));
    content = body.content;
    title = body.title ?? title;
  }

  content = content.trim();
  if (!content) throw new HTTPException(422, { message: "No text found. Try another file, or paste your CV." });

  const format = isLatexCv(content) ? "latex" : "markdown";
  if (format === "latex" && title === "Master CV") title = "Master CV (LaTeX)";

  const db = c.env.DB;
  const row = await db
    .prepare("INSERT INTO documents (kind, title, content, meta, is_active) VALUES ('master_cv', ?, ?, ?, 1) RETURNING id")
    .bind(title, content, JSON.stringify({ ...(filename ? { filename } : {}), format }))
    .first<{ id: number }>();
  if (!row) throw new Error("Couldn't save the CV.");
  await db.batch([
    db.prepare("UPDATE documents SET is_active = 0 WHERE kind = 'master_cv' AND id != ?").bind(row.id),
    eventStmt(db, "document", row.id, "uploaded", { kind: "master_cv", filename }),
  ]);
  rescoreInBackground(c);
  return c.json(await getDocument(db, row.id), 201);
});

// `model`: an option id from config/models.json (GET /api/models); the AI_MODEL default when omitted.
const JobBody = z.object({ jobId: z.number().int().positive(), model: z.string().max(80).optional() });

documents.post("/tailor", async (c) => {
  const { jobId, model } = await readJson(c, JobBody);
  return c.json(await getDocument(c.env.DB, await generateTailoredCv(withModel(c.env, model), jobId)), 201);
});

documents.post("/cover-letter", async (c) => {
  const { jobId, angle, model } = await readJson(c, JobBody.extend({ angle: z.string().max(1000).optional() }));
  return c.json(await getDocument(c.env.DB, await generateCoverLetter(withModel(c.env, model), jobId, angle)), 201);
});

documents.post("/answers", async (c) => {
  const { jobId, questions, model } = await readJson(c, JobBody.extend({ questions: z.array(z.string().max(500)).max(10).optional() }));
  return c.json(await getDocument(c.env.DB, await generateAnswers(withModel(c.env, model), jobId, questions)), 201);
});

async function documentWithParent(db: D1Database, id: number) {
  const doc = await getDocument(db, id);
  if (!doc) throw notFound("Document");
  if (doc.parentId) {
    const parent = await db.prepare("SELECT content FROM documents WHERE id = ?").bind(doc.parentId).first<{ content: string }>();
    if (parent) doc.meta.parentContent = parent.content;
  }
  return doc;
}

documents.get("/:id", async (c) => c.json(await documentWithParent(c.env.DB, idParam(c))));

documents.post("/:id/review", async (c) => {
  const id = idParam(c);
  const { model } = await readJson(c, z.object({ model: z.string().max(80).optional() }));
  await reviewDocument(withModel(c.env, model), id);
  return c.json(await documentWithParent(c.env.DB, id));
});

const PatchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(100_000).optional(),
  status: z.enum(["draft", "approved"]).optional(),
  isActive: z.literal(true).optional(),
});

documents.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await readJson(c, PatchBody);
  const db = c.env.DB;
  const doc = await getDocument(db, id);
  if (!doc) throw notFound("Document");

  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  let rescore = false;

  if (body.title !== undefined && body.title !== doc.title) {
    sets.push("title = ?");
    params.push(body.title);
  }
  if (body.content !== undefined && body.content !== doc.content) {
    sets.push("content = ?");
    params.push(body.content);
    stmts.push(eventStmt(db, "document", id, "edited", { kind: doc.kind }));
    if (doc.kind === "master_cv") rescore = doc.isActive;
    else if (doc.jobId) {
      sets.push("meta = ?");
      params.push(JSON.stringify(await metaAfterEdit(c.env, doc, body.content)));
    }
  }
  if (body.status && body.status !== doc.status) {
    if (doc.kind === "master_cv") throw new HTTPException(400, { message: "Master CVs don't need approval." });
    sets.push("status = ?");
    params.push(body.status);
    stmts.push(eventStmt(db, "document", id, body.status === "approved" ? "approved" : "unapproved", { kind: doc.kind }));

    if (body.status === "approved" && doc.jobId && (doc.kind === "tailored_cv" || doc.kind === "cover_letter")) {
      const app = await db.prepare("SELECT id, status FROM applications WHERE job_id = ?").bind(doc.jobId).first<{ id: number; status: string }>();
      if (app) {
        const column = doc.kind === "tailored_cv" ? "cv_document_id" : "cover_letter_id";
        stmts.push(db.prepare(`UPDATE applications SET ${column} = ?, updated_at = ? WHERE id = ?`).bind(id, now, app.id));
        // An approved CV is what makes an application ready to submit.
        if (doc.kind === "tailored_cv" && app.status === "preparing") {
          stmts.push(db.prepare("UPDATE applications SET status = 'ready', status_changed_at = ? WHERE id = ?").bind(now, app.id));
          stmts.push(eventStmt(db, "application", app.id, "status_changed", { from: "preparing", to: "ready", reason: "cv_approved" }));
        }
      }
    }
  }
  if (body.isActive && doc.kind === "master_cv" && !doc.isActive) {
    stmts.push(db.prepare("UPDATE documents SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE kind = 'master_cv'").bind(id));
    stmts.push(eventStmt(db, "document", id, "activated", { kind: doc.kind }));
    rescore = true;
  }

  if (sets.length) {
    sets.push("updated_at = ?");
    params.push(now);
    stmts.unshift(db.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).bind(...params, id));
  }
  if (stmts.length) await db.batch(stmts);
  if (rescore) rescoreInBackground(c);
  return c.json(await getDocument(db, id));
});

documents.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = c.env.DB;
  const doc = await db.prepare("SELECT kind, is_active FROM documents WHERE id = ?").bind(id).first<{ kind: string; is_active: number }>();
  if (!doc) throw notFound("Document");
  const stmts = [db.prepare("DELETE FROM documents WHERE id = ?").bind(id), eventStmt(db, "document", id, "deleted", { kind: doc.kind })];
  if (doc.kind === "master_cv" && doc.is_active) {
    stmts.push(
      db.prepare(
        "UPDATE documents SET is_active = 1 WHERE id = (SELECT id FROM documents WHERE kind = 'master_cv' ORDER BY updated_at DESC LIMIT 1)",
      ),
    );
  }
  await db.batch(stmts);
  if (doc.kind === "master_cv") rescoreInBackground(c);
  return c.body(null, 204);
});
