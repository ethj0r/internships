// AI-assisted analysis and document generation. Drafts are always saved for review;
// nothing generated here is used in an application until the user approves it.

import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import {
  applyTailoring,
  cvToLatex,
  cvToPlainText,
  describeTailoring,
  documentText,
  headerText,
  isLatexCv,
  parseLatexCv,
  type CvDoc,
  type CvSection,
} from "../../shared/cv";
import type { Document, DocumentChange, FitAnalysis, JobDetail, Profile } from "../../shared/types";
import {
  AnswersSchema,
  answersPrompt,
  CoverLetterSchema,
  coverLetterPrompt,
  CvTailoringSchema,
  DEFAULT_QUESTIONS,
  FitAnalysisSchema,
  fitAnalysisPrompt,
  FullCvSchema,
  renderAnswersMarkdown,
  tailorCvFromTextPrompt,
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
  return [documentText(cv.content), profile.skills.join(", "), profile.education, profile.headline, profile.links.map((l) => l.url).join(" ")].join("\n");
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
  const { system, prompt } = fitAnalysisPrompt(profile, documentText(cv.content), job, job.matchDetail, compactPrompts(env));
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

function sectionKey(title: string, index: number): string {
  return (
    title
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `section-${index}`
  );
}

function fullCvToDoc(data: z.infer<typeof FullCvSchema>): CvDoc {
  const sections = data.sections.map((s, index): CvSection => {
    const key = sectionKey(s.title, index);
    const base = { key, title: s.title.trim(), note: "" };
    if (s.kind === "skills") {
      return { ...base, type: "skills", lines: s.skill_lines.filter((l) => l.items.length).map((l) => ({ label: l.label.trim(), items: l.items })) };
    }
    if (s.kind === "entries") {
      return {
        ...base,
        type: "entries",
        spaced: key !== "education",
        entries: s.entries.map((e, i) => ({ id: `${key}-${i}`, title: e.title, titleRight: e.title_right, subtitle: e.subtitle, subtitleRight: e.subtitle_right, bullets: e.bullets })),
      };
    }
    const variant: "plain" | "spaced" | "wrap" = /award|certif/i.test(s.title) ? "plain" : /research|paper|publication/i.test(s.title) ? "wrap" : "spaced";
    return { ...base, type: "items", variant, items: s.items.map((it, i) => ({ id: `${key}-${i}`, heading: it.heading, date: it.date, bullets: it.bullets })) };
  });
  return {
    header: { name: data.name.trim(), contacts: data.contacts.filter((c) => c.text.trim()).map((c) => ({ text: c.text.trim(), url: c.url.trim() || null })) },
    sections: sections.filter((s) => (s.type === "skills" ? s.lines.length : s.type === "entries" ? s.entries.length : s.type === "items" ? s.items.length : true)),
  };
}

/** Tailored CVs are always LaTeX in the résumé template (shared/cvTemplate.ts). */
export async function generateTailoredCv(env: Env, jobId: number): Promise<number> {
  const { job, profile, cv } = await loadInputs(env, jobId);
  const compact = compactPrompts(env);
  const master = isLatexCv(cv.content) ? parseLatexCv(cv.content) : null;
  const warnings: string[] = [];
  let doc: CvDoc;
  let changes: DocumentChange[];
  let generator: string;

  if (master?.sections.length) {
    const { system, prompt } = tailorCvPrompt(profile, master, job, compact);
    const result = await generateJson(env, { system, prompt, schema: CvTailoringSchema });
    doc = applyTailoring(master, result.data, job.skills);
    generator = result.generator;
    changes = [...result.data.changes, ...describeTailoring(master, doc)];
  } else {
    const { system, prompt } = tailorCvFromTextPrompt(profile, documentText(cv.content), job, compact);
    const result = await generateJson(env, { system, prompt, schema: FullCvSchema });
    doc = fullCvToDoc(result.data);
    generator = result.generator;
    changes = result.data.changes;
    warnings.push(
      "Your master CV isn't a LaTeX file, so the template was filled from its extracted text. Upload your résumé's .tex source under Documents to keep its exact wording and structure.",
      ...missingContactDetails(cvToPlainText({ header: doc.header, sections: [] }, { urls: true }), headerText(cv.content)),
    );
  }

  warnings.push(...verifyGenerated(cvToPlainText(doc, { urls: true }), { evidence: evidence(profile, cv), context: job.description }));
  return insertDocument(env, {
    kind: "tailored_cv",
    title: await versionedTitle(env, jobId, "tailored_cv", `CV for ${job.company}`),
    jobId,
    parentId: cv.id,
    content: cvToLatex(doc),
    meta: { generator, changes, warnings, format: "latex" },
  });
}

export async function generateCoverLetter(env: Env, jobId: number): Promise<number> {
  const { job, profile, cv } = await loadInputs(env, jobId);
  const { system, prompt } = coverLetterPrompt(profile, documentText(cv.content), job, compactPrompts(env));
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
  const { system, prompt } = answersPrompt(profile, documentText(cv.content), job, finalQuestions, compactPrompts(env));
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

/** Re-runs the fabrication checks after the user edits a generated document. */
export function reverify(kind: Document["kind"], profile: Profile, masterCv: Document | null, content: string, jobDescription: string): string[] {
  if (!masterCv) return [];
  const checks = verifyGenerated(documentText(content), { evidence: evidence(profile, masterCv), context: jobDescription });
  if (kind !== "tailored_cv") return checks;
  const unreadable = isLatexCv(content) && !parseLatexCv(content) ? ["This LaTeX couldn't be read. Check for unbalanced braces."] : [];
  return [...unreadable, ...missingContactDetails(headerText(content), headerText(masterCv.content)), ...checks];
}
