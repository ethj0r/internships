// AI-assisted analysis and document generation. Drafts are always saved for review;
// nothing generated here is used in an application until the user approves it.

import { HTTPException } from "hono/http-exception";
import type { Document, FitAnalysis, JobDetail, Profile } from "../../shared/types";
import {
  AnswersSchema,
  answersPrompt,
  CoverLetterSchema,
  coverLetterPrompt,
  DEFAULT_QUESTIONS,
  FitAnalysisSchema,
  fitAnalysisPrompt,
  renderAnswersMarkdown,
  TailoredCvSchema,
  tailorCvPrompt,
} from "../ai/prompts";
import { compactPrompts, generateJson } from "../ai/provider";
import { eventStmt, getActiveMasterCv, getJobDetailRow, getProfile, nowIso, toJobDetail } from "../lib/db";
import { missingContactDetails, verifyGenerated } from "../matching/verify";

interface Inputs {
  job: JobDetail;
  profile: Profile;
  cv: Document;
}

async function loadInputs(env: Env, jobId: number): Promise<Inputs> {
  const row = await getJobDetailRow(env.DB, jobId);
  if (!row) throw new HTTPException(404, { message: "Job not found." });
  const [profile, cv] = await Promise.all([getProfile(env.DB), getActiveMasterCv(env.DB)]);
  if (!cv || !cv.content.trim()) throw new HTTPException(400, { message: "Add your master CV first, under Documents." });
  return { job: toJobDetail(row, [], []), profile, cv };
}

function evidence(profile: Profile, cv: Document): string {
  return [cv.content, profile.skills.join(", "), profile.education, profile.headline, profile.links.map((l) => l.url).join(" ")].join("\n");
}

/** Moves a tracked job into Preparing (or starts tracking it) when documents are generated. */
async function markPreparing(env: Env, jobId: number): Promise<D1PreparedStatement[]> {
  const app = await env.DB.prepare("SELECT id, status FROM applications WHERE job_id = ?").bind(jobId).first<{ id: number; status: string }>();
  const now = nowIso();
  if (!app) {
    const created = await env.DB.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'preparing') ON CONFLICT (job_id) DO NOTHING RETURNING id")
      .bind(jobId)
      .first<{ id: number }>();
    return created ? [eventStmt(env.DB, "application", created.id, "created", { status: "preparing" })] : [];
  }
  if (app.status !== "discovered" && app.status !== "interested") return [];
  return [
    env.DB.prepare("UPDATE applications SET status = 'preparing', status_changed_at = ?, updated_at = ? WHERE id = ?").bind(now, now, app.id),
    eventStmt(env.DB, "application", app.id, "status_changed", { from: app.status, to: "preparing" }),
  ];
}

async function insertDocument(
  env: Env,
  doc: { kind: Document["kind"]; title: string; jobId: number; parentId: number; content: string; meta: Record<string, unknown> },
): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO documents (kind, title, job_id, parent_id, content, generated_content, meta) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(doc.kind, doc.title, doc.jobId, doc.parentId, doc.content, doc.content, JSON.stringify(doc.meta))
    .first<{ id: number }>();
  if (!row) throw new Error("Couldn't save the generated document.");
  const stmts = [eventStmt(env.DB, "document", row.id, "generated", { kind: doc.kind, jobId: doc.jobId, generator: doc.meta.generator })];
  stmts.push(...(await markPreparing(env, doc.jobId)));
  await env.DB.batch(stmts);
  return row.id;
}

async function versionedTitle(env: Env, jobId: number, kind: Document["kind"], base: string): Promise<string> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE job_id = ? AND kind = ?").bind(jobId, kind).first<{ n: number }>();
  return row && row.n > 0 ? `${base} (v${row.n + 1})` : base;
}

export async function analyzeFit(env: Env, jobId: number): Promise<FitAnalysis> {
  const { job, profile, cv } = await loadInputs(env, jobId);
  const { system, prompt } = fitAnalysisPrompt(profile, cv.content, job, job.matchDetail, compactPrompts(env));
  const { data, generator } = await generateJson(env, { system, prompt, schema: FitAnalysisSchema });
  const analysis: FitAnalysis = {
    summary: data.summary,
    strengths: data.strengths,
    gaps: data.gaps,
    concerns: data.concerns,
    keyQualifications: data.key_qualifications,
    talkingPoints: data.talking_points,
    generator,
  };
  await env.DB.batch([
    env.DB.prepare("UPDATE jobs SET ai_analysis = ?, ai_analyzed_at = ? WHERE id = ?").bind(JSON.stringify(analysis), nowIso(), jobId),
    eventStmt(env.DB, "job", jobId, "analyzed", { generator }),
  ]);
  return analysis;
}

export async function generateTailoredCv(env: Env, jobId: number): Promise<number> {
  const { job, profile, cv } = await loadInputs(env, jobId);
  const { system, prompt } = tailorCvPrompt(profile, cv.content, job, compactPrompts(env));
  const { data, generator } = await generateJson(env, { system, prompt, schema: TailoredCvSchema });
  const content = data.cv_markdown.trim();
  return insertDocument(env, {
    kind: "tailored_cv",
    title: await versionedTitle(env, jobId, "tailored_cv", `CV for ${job.company}`),
    jobId,
    parentId: cv.id,
    content,
    meta: {
      generator,
      changes: data.changes,
      warnings: [...missingContactDetails(content, cv.content), ...verifyGenerated(content, { evidence: evidence(profile, cv), context: job.description })],
    },
  });
}

export async function generateCoverLetter(env: Env, jobId: number): Promise<number> {
  const { job, profile, cv } = await loadInputs(env, jobId);
  const { system, prompt } = coverLetterPrompt(profile, cv.content, job, compactPrompts(env));
  const { data, generator } = await generateJson(env, { system, prompt, schema: CoverLetterSchema });
  const content = data.letter_markdown.trim();
  return insertDocument(env, {
    kind: "cover_letter",
    title: await versionedTitle(env, jobId, "cover_letter", `Cover letter for ${job.company}`),
    jobId,
    parentId: cv.id,
    content,
    meta: { generator, grounding: data.grounding, warnings: verifyGenerated(content, { evidence: evidence(profile, cv), context: job.description }) },
  });
}

export async function generateAnswers(env: Env, jobId: number, questions?: string[]): Promise<number> {
  const { job, profile, cv } = await loadInputs(env, jobId);
  const qs = questions?.map((q) => q.trim()).filter(Boolean);
  const finalQuestions = qs?.length ? qs : DEFAULT_QUESTIONS(job.company);
  const { system, prompt } = answersPrompt(profile, cv.content, job, finalQuestions, compactPrompts(env));
  const { data, generator } = await generateJson(env, { system, prompt, schema: AnswersSchema });
  const content = renderAnswersMarkdown(data);
  return insertDocument(env, {
    kind: "answers",
    title: await versionedTitle(env, jobId, "answers", `Application answers for ${job.company}`),
    jobId,
    parentId: cv.id,
    content,
    meta: {
      generator,
      questions: finalQuestions,
      grounding: data.answers.map((a) => ({ claim: a.question, source: a.based_on })),
      warnings: verifyGenerated(content, { evidence: evidence(profile, cv), context: job.description }),
    },
  });
}

export function reverify(kind: Document["kind"], profile: Profile, masterCv: Document | null, content: string, jobDescription: string): string[] {
  if (!masterCv) return [];
  const checks = verifyGenerated(content, { evidence: evidence(profile, masterCv), context: jobDescription });
  return kind === "tailored_cv" ? [...missingContactDetails(content, masterCv.content), ...checks] : checks;
}
