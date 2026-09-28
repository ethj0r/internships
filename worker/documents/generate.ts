// Evidence-based document generation (docs/personalization.md). Every document starts from the job's insights
// (requirement → evidence map and strategy), cites the knowledge base, passes deterministic checks and a quality
// review, and is regenerated once when the review finds it isn't ready. Drafts still need the user's approval.

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
  type CvEntry,
  type CvItem,
  type CvSection,
} from "../../shared/cv";
import {
  COVER_LETTER_CRITERIA,
  CV_CRITERIA,
  type BulletChange,
  type EvidenceItem,
  type JobInsights,
  type LetterPlan,
  type OmittedEntry,
  type QualityCriterion,
  type QualityIssue,
  type QualityReview,
} from "../../shared/personalization";
import type { Document, DocumentChange, DocumentMeta, Grounding } from "../../shared/types";
import {
  AnswersSchema,
  answersPrompt,
  coverLetterPlanPrompt,
  coverLetterWritePrompt,
  CvPlanSchema,
  CvReviewSchema,
  DEFAULT_QUESTIONS,
  FullCvSchema,
  LetterPlanSchema,
  LetterReviewSchema,
  LetterSchema,
  renderAnswersMarkdown,
  reviewPrompt,
  tailorCvFromTextPrompt,
  tailorCvPrompt,
} from "../ai/prompts";
import { AiError, compactPrompts, generateJson } from "../ai/provider";
import { eventStmt, getDocument, getLatestJobDocument, getProfile, nowIso } from "../lib/db";
import { missingContactDetails, verifyGenerated } from "../matching/verify";
import { ensureInsights, loadContext, type Context } from "../personalization/insights";
import { evidenceText, groupEvidence, loadKnowledge } from "../personalization/knowledge";
import { applyBulletProposals, cvIssues, letterIssues } from "../personalization/validate";

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
  doc: { kind: Document["kind"]; title: string; jobId: number; parentId: number; content: string; meta: DocumentMeta },
): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO documents (kind, title, job_id, parent_id, content, generated_content, meta) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(doc.kind, doc.title, doc.jobId, doc.parentId, doc.content, doc.content, JSON.stringify(doc.meta))
    .first<{ id: number }>();
  if (!row) throw new Error("Couldn't save the generated document.");
  const stmts = [
    eventStmt(env.DB, "document", row.id, "generated", { kind: doc.kind, jobId: doc.jobId, generator: doc.meta.generator, verdict: doc.meta.review?.verdict }),
  ];
  stmts.push(...(await markPreparing(env, doc.jobId)));
  await env.DB.batch(stmts);
  return row.id;
}

async function versionedTitle(env: Env, jobId: number, kind: Document["kind"], base: string): Promise<string> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE job_id = ? AND kind = ?").bind(jobId, kind).first<{ n: number }>();
  return row && row.n > 0 ? `${base} (v${row.n + 1})` : base;
}

/** Rebuilds a job's insights: requirements, evidence map, strategy and company research. */
export async function analyzeJob(env: Env, jobId: number): Promise<JobInsights> {
  return ensureInsights(env, await loadContext(env, jobId), { refresh: true });
}

// ---------- Quality review ----------

type ReviewData = z.infer<typeof CvReviewSchema> | z.infer<typeof LetterReviewSchema>;

function toReview(data: ReviewData, criteria: readonly QualityCriterion[], checks: QualityIssue[], attempts: number, generator: string): QualityReview {
  const scores = criteria.map((criterion) => {
    const s = data.scores.find((x) => x.criterion === criterion);
    return { criterion, score: s ? Math.min(5, Math.max(1, Math.round(s.score))) : 3, note: s?.note.trim() ?? "Not scored." };
  });
  const issues: QualityIssue[] = [
    ...checks,
    ...data.issues.map((i) => ({ severity: i.severity, message: [i.problem.trim(), i.fix.trim()].filter(Boolean).join(" "), quote: i.quote.trim(), source: "review" as const })),
  ];
  const ready = data.verdict === "ready" && !issues.some((i) => i.severity === "blocking") && scores.every((s) => s.score > 2);
  return { verdict: ready ? "ready" : "needs_work", summary: data.summary.trim(), scores, issues, attempts, generator, reviewedAt: nowIso(), stale: false };
}

/** What the next attempt must fix: every blocking issue, then the weakest criteria. */
function feedbackFrom(review: QualityReview): string[] {
  const issues = review.issues.filter((i) => i.severity === "blocking").map((i) => (i.quote ? `${i.message} (“${i.quote}”)` : i.message));
  const weak = review.scores.filter((s) => s.score <= 3).map((s) => `${s.criterion} scored ${s.score}/5: ${s.note}`);
  const warnings = review.issues.filter((i) => i.severity === "warning").map((i) => i.message);
  return [...issues, ...weak, ...warnings].slice(0, 14);
}

function reviewRank(r: QualityReview): [number, number] {
  return [r.issues.filter((i) => i.severity === "blocking").length, -r.scores.reduce((sum, s) => sum + s.score, 0)];
}

/** Drafts, reviews, and redrafts once with the review's feedback if the first draft isn't ready. Keeps the better one. */
async function draftWithReview<D>(draft: (feedback: string[]) => Promise<D>, review: (d: D, attempts: number) => Promise<QualityReview>) {
  const first = await draft([]);
  const firstReview = await review(first, 1);
  if (firstReview.verdict === "ready") return { draft: first, review: firstReview };
  const second = await draft(feedbackFrom(firstReview));
  const secondReview = await review(second, 2);
  const [a, b] = [reviewRank(firstReview), reviewRank(secondReview)];
  return b[0] < a[0] || (b[0] === a[0] && b[1] <= a[1]) ? { draft: second, review: secondReview } : { draft: first, review: { ...firstReview, attempts: 2 } };
}

/** The evidence a document relies on, for showing next to its claims. */
function citedEvidence(insights: JobInsights, ids: string[]): EvidenceItem[] {
  const wanted = new Set([...ids, ...insights.matches.flatMap((m) => m.evidenceIds)]);
  return insights.evidence.filter((e) => wanted.has(e.id));
}

// ---------- Tailored CV ----------

interface CvDraft {
  doc: CvDoc;
  text: string;
  generator: string;
  changes: DocumentChange[];
  bulletChanges: BulletChange[];
  omitted: OmittedEntry[];
  checks: QualityIssue[];
  warnings: string[];
}

function cvChecks(ctx: Context, insights: JobInsights, text: string): QualityIssue[] {
  return cvIssues(text, {
    evidence: evidenceText(ctx.knowledge),
    masterText: documentText(ctx.knowledge.master!.content, { urls: true }),
    posting: ctx.job.description,
    employerTerms: insights.requirements.flatMap((r) => r.employerTerms),
  });
}

async function draftLatexCv(env: Env, ctx: Context, insights: JobInsights, feedback: string[]): Promise<CvDraft> {
  const { knowledge: k, job, profile } = ctx;
  const master = k.doc!;
  const { data, generator } = await generateJson(env, { ...tailorCvPrompt({ profile, knowledge: k, job, insights, compact: compactPrompts(env), feedback }), schema: CvPlanSchema });

  const located = new Map<string, { section: CvSection; x: CvEntry | CvItem }>();
  for (const section of master.sections) {
    const list: (CvEntry | CvItem)[] = section.type === "entries" ? section.entries : section.type === "items" ? section.items : [];
    for (const x of list) located.set(x.id, { section, x });
  }
  const requirementIds = new Set(insights.requirements.map((r) => r.id));
  const changesByEntry = new Map<string, BulletChange[]>();
  const entries: { id: string; bullets: string[] }[] = [];
  for (const proposal of data.entries) {
    const found = located.get(proposal.id);
    if (!found || changesByEntry.has(proposal.id)) continue;
    const group = k.groupOfEntryId.get(proposal.id)!;
    const support = groupEvidence(k, group);
    const { bullets, changes } = applyBulletProposals({
      masterBullets: found.x.bullets,
      group,
      support,
      proposals: proposal.bullets,
      drops: proposal.drop,
      requirementIds,
      section: found.section.title,
      label: support[0]?.label ?? proposal.id,
    });
    changesByEntry.set(proposal.id, changes);
    entries.push({ id: proposal.id, bullets });
  }

  const doc = applyTailoring(master, { entries, skills: data.skills, omit: data.omit.map((o) => o.id) }, job.skills);
  const kept = new Set(doc.sections.flatMap((s) => (s.type === "entries" ? s.entries.map((e) => e.id) : s.type === "items" ? s.items.map((i) => i.id) : [])));
  const omitted: OmittedEntry[] = [...located]
    .filter(([id]) => !kept.has(id))
    .map(([id, { section }]) => ({
      section: section.title,
      label: k.byId.get(`${k.groupOfEntryId.get(id)}.h`)?.label ?? id,
      reason: data.omit.find((o) => o.id === id)?.reason.trim() || "Less relevant to this role than the entries kept.",
    }));
  const text = cvToPlainText(doc, { urls: true });
  return {
    doc,
    text,
    generator,
    changes: describeTailoring(master, doc).filter((c) => !c.change.startsWith("Left out")),
    bulletChanges: [...changesByEntry].filter(([id]) => kept.has(id)).flatMap(([, c]) => c),
    omitted,
    checks: cvChecks(ctx, insights, text),
    warnings: [],
  };
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

/** Masters that aren't LaTeX are rebuilt in the template from their text; bullet-level tracing isn't possible. */
async function draftTextCv(env: Env, ctx: Context, insights: JobInsights, feedback: string[]): Promise<CvDraft> {
  const { knowledge: k, job, profile } = ctx;
  const { data, generator } = await generateJson(env, { ...tailorCvFromTextPrompt({ profile, knowledge: k, job, insights, compact: compactPrompts(env), feedback }), schema: FullCvSchema });
  const doc = fullCvToDoc(data);
  const text = cvToPlainText(doc, { urls: true });
  return {
    doc,
    text,
    generator,
    changes: data.changes,
    bulletChanges: [],
    omitted: [],
    checks: cvChecks(ctx, insights, text),
    warnings: [
      "Your master CV isn't a LaTeX file, so the template was filled from its extracted text and bullet-by-bullet tracing isn't available. Upload your résumé's .tex source under Documents to keep its exact wording and structure.",
      ...missingContactDetails(cvToPlainText({ header: doc.header, sections: [] }, { urls: true }), headerText(k.master!.content)),
    ],
  };
}

async function reviewCv(env: Env, ctx: Context, insights: JobInsights, draft: { text: string; checks: QualityIssue[] }, attempts: number): Promise<QualityReview> {
  const { data, generator } = await generateJson(env, {
    ...reviewPrompt({ kind: "cv", content: draft.text, knowledge: ctx.knowledge, job: ctx.job, insights, checks: draft.checks, compact: compactPrompts(env) }),
    schema: CvReviewSchema,
  });
  return toReview(data, CV_CRITERIA, draft.checks, attempts, generator);
}

/** Tailored CVs are always LaTeX in the résumé template (shared/cvTemplate.ts). */
export async function generateTailoredCv(env: Env, jobId: number): Promise<number> {
  const ctx = await loadContext(env, jobId);
  const insights = await ensureInsights(env, ctx);
  const draftCv = ctx.knowledge.doc?.sections.length ? draftLatexCv : draftTextCv;
  const { draft, review } = await draftWithReview(
    (feedback) => draftCv(env, ctx, insights, feedback),
    (d, attempts) => reviewCv(env, ctx, insights, d, attempts),
  );

  return insertDocument(env, {
    kind: "tailored_cv",
    title: await versionedTitle(env, jobId, "tailored_cv", `CV for ${ctx.job.company}`),
    jobId,
    parentId: ctx.knowledge.master!.id,
    content: cvToLatex(draft.doc),
    meta: {
      format: "latex",
      generator: draft.generator,
      changes: draft.changes,
      warnings: draft.warnings,
      bulletChanges: draft.bulletChanges,
      omitted: draft.omitted,
      strategy: insights.strategy,
      requirements: insights.requirements,
      matches: insights.matches,
      evidence: citedEvidence(insights, draft.bulletChanges.flatMap((b) => b.evidenceIds)),
      review,
    },
  });
}

// ---------- Cover letter ----------

interface LetterDraft {
  content: string;
  generator: string;
  plan: LetterPlan;
  grounding: Grounding[];
  evidenceIds: string[];
  checks: QualityIssue[];
}

/** The CV a cover letter accompanies: the job's approved or latest tailored CV, else the master. */
async function letterCvText(env: Env, ctx: Context): Promise<string> {
  const cv = await getLatestJobDocument(env.DB, ctx.job.id, "tailored_cv");
  return documentText(cv?.content ?? ctx.knowledge.master!.content, { urls: false });
}

function letterChecks(ctx: Context, insights: JobInsights, content: string, cvText: string, angle: string): QualityIssue[] {
  return letterIssues(content, {
    company: ctx.job.company,
    evidence: `${evidenceText(ctx.knowledge)}\n${documentText(ctx.knowledge.master!.content, { urls: true })}\n${angle}`,
    posting: `${ctx.job.description}\n${insights.companyFacts.map((f) => f.text).join("\n")}`,
    cvText,
  });
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

async function draftLetter(env: Env, ctx: Context, insights: JobInsights, cvText: string, angle: string, feedback: string[]): Promise<LetterDraft> {
  const { knowledge: k, job, profile } = ctx;
  const input = { profile, knowledge: k, job, insights, cvText, angle, compact: compactPrompts(env), feedback };
  const factIds = new Set(["posting", ...insights.companyFacts.map((f) => f.id)]);
  const requirementIds = new Set(insights.requirements.map((r) => r.id));
  const validEvidence = (ids: string[]) => [...new Set(ids)].filter((id) => k.byId.has(id) || (angle && id === "angle"));
  const validFacts = (ids: string[]) => [...new Set(ids)].filter((id) => factIds.has(id));

  const { data: p } = await generateJson(env, { ...coverLetterPlanPrompt(input), schema: LetterPlanSchema });
  const narrative = p.narrative.map((n) => ({
    need: n.need.trim(),
    experience: n.experience.trim(),
    whyItMatters: n.why_it_matters.trim(),
    requirementIds: n.requirement_ids.filter((id) => requirementIds.has(id)),
    evidenceIds: validEvidence(n.evidence_ids),
  }));
  const plan: LetterPlan = {
    companyNeed: p.company_need.trim(),
    whyRole: p.why_role.trim(),
    whyCompany: p.why_company.trim(),
    companyFactIds: validFacts(p.company_fact_ids),
    narrative,
    contribution: p.contribution.trim(),
    motivation: p.motivation.trim(),
  };

  // Smaller models occasionally return an empty letter: retry once, then fail rather than save it.
  const write = () => generateJson(env, { ...coverLetterWritePrompt({ ...input, plan }), schema: LetterSchema });
  let written = await write();
  if (wordCount(written.data.letter_markdown) < 120) written = await write();
  const { data, generator } = written;
  const content = data.letter_markdown.trim();
  if (wordCount(content) < 120) throw new AiError("The model didn't return a complete letter. Try again.");

  const checks = letterChecks(ctx, insights, content, cvText, angle);
  for (const claim of data.claims) {
    if (!validEvidence(claim.evidence_ids).length && !validFacts(claim.company_fact_ids).length) {
      checks.push({ severity: "blocking", message: "This claim doesn't trace to your knowledge base or to a cited source.", quote: claim.claim, source: "check" });
    }
  }

  const sourceLabel = (id: string) => {
    if (id === "angle") return "What you asked the letter to reflect";
    if (id === "posting") return "Job posting";
    const fact = insights.companyFacts.find((f) => f.id === id);
    if (fact) return fact.sources.map((s) => s.title || s.url).join(", ");
    const e = k.byId.get(id);
    return e ? `${e.label} (${id})` : id;
  };
  return {
    content,
    generator,
    checks,
    plan,
    grounding: data.claims.map((c) => ({
      claim: c.claim,
      source: [...validEvidence(c.evidence_ids), ...validFacts(c.company_fact_ids)].map(sourceLabel).join("; ") || "Nothing supports this claim.",
    })),
    evidenceIds: [...data.claims.flatMap((c) => validEvidence(c.evidence_ids)), ...narrative.flatMap((n) => n.evidenceIds)],
  };
}

async function reviewLetter(
  env: Env,
  ctx: Context,
  insights: JobInsights,
  draft: { content: string; checks: QualityIssue[] },
  cvText: string,
  attempts: number,
): Promise<QualityReview> {
  const { data, generator } = await generateJson(env, {
    ...reviewPrompt({ kind: "cover_letter", content: draft.content, knowledge: ctx.knowledge, job: ctx.job, insights, checks: draft.checks, cvText, compact: compactPrompts(env) }),
    schema: LetterReviewSchema,
  });
  return toReview(data, COVER_LETTER_CRITERIA, draft.checks, attempts, generator);
}

export async function generateCoverLetter(env: Env, jobId: number, angle = ""): Promise<number> {
  const ctx = await loadContext(env, jobId);
  const insights = await ensureInsights(env, ctx);
  const cvText = await letterCvText(env, ctx);
  const { draft, review } = await draftWithReview(
    (feedback) => draftLetter(env, ctx, insights, cvText, angle.trim(), feedback),
    (d, attempts) => reviewLetter(env, ctx, insights, d, cvText, attempts),
  );

  return insertDocument(env, {
    kind: "cover_letter",
    title: await versionedTitle(env, jobId, "cover_letter", `Cover letter for ${ctx.job.company}`),
    jobId,
    parentId: ctx.knowledge.master!.id,
    content: draft.content,
    meta: {
      generator: draft.generator,
      grounding: draft.grounding,
      warnings: [],
      plan: draft.plan,
      strategy: insights.strategy,
      requirements: insights.requirements,
      matches: insights.matches,
      companyFacts: insights.companyFacts,
      evidence: citedEvidence(insights, draft.evidenceIds),
      review,
      ...(angle.trim() ? { angle: angle.trim() } : {}),
    },
  });
}

// ---------- Application answers ----------

export async function generateAnswers(env: Env, jobId: number, questions?: string[]): Promise<number> {
  const ctx = await loadContext(env, jobId);
  const insights = await ensureInsights(env, ctx);
  const qs = questions?.map((q) => q.trim()).filter(Boolean);
  const finalQuestions = qs?.length ? qs : DEFAULT_QUESTIONS(ctx.job.company);
  const { data, generator } = await generateJson(env, {
    ...answersPrompt({ profile: ctx.profile, knowledge: ctx.knowledge, job: ctx.job, insights, questions: finalQuestions, compact: compactPrompts(env) }),
    schema: AnswersSchema,
  });
  const content = renderAnswersMarkdown(data);
  return insertDocument(env, {
    kind: "answers",
    title: await versionedTitle(env, jobId, "answers", `Application answers for ${ctx.job.company}`),
    jobId,
    parentId: ctx.knowledge.master!.id,
    content,
    meta: {
      generator,
      questions: finalQuestions,
      grounding: data.answers.map((a) => ({ claim: a.question, source: a.based_on })),
      warnings: verifyGenerated(content, { evidence: evidenceText(ctx.knowledge), context: ctx.job.description }),
    },
  });
}

// ---------- Review and edits ----------

const blocking = (message: string): QualityIssue => ({ severity: "blocking", message, quote: "", source: "check" });

/** Runs the quality review on a document's current content, e.g. after the user edits it. */
export async function reviewDocument(env: Env, id: number): Promise<void> {
  const doc = await getDocument(env.DB, id);
  if (!doc) throw new HTTPException(404, { message: "Document not found." });
  if (!doc.jobId || (doc.kind !== "tailored_cv" && doc.kind !== "cover_letter")) {
    throw new HTTPException(400, { message: "Only tailored CVs and cover letters are reviewed." });
  }
  const ctx = await loadContext(env, doc.jobId);
  const insights = await ensureInsights(env, ctx);
  const attempts = doc.meta.review?.attempts ?? 1;

  let review: QualityReview;
  if (doc.kind === "tailored_cv") {
    const text = documentText(doc.content, { urls: true });
    const checks = [
      ...(isLatexCv(doc.content) && !parseLatexCv(doc.content) ? [blocking("This LaTeX couldn't be read. Check for unbalanced braces.")] : []),
      ...missingContactDetails(headerText(doc.content), headerText(ctx.knowledge.master!.content)).map(blocking),
      ...cvChecks(ctx, insights, text),
    ];
    review = await reviewCv(env, ctx, insights, { text, checks }, attempts);
  } else {
    const cvText = await letterCvText(env, ctx);
    const checks = letterChecks(ctx, insights, doc.content, cvText, doc.meta.angle ?? "");
    review = await reviewLetter(env, ctx, insights, { content: doc.content, checks }, cvText, attempts);
  }

  const { parentContent: _omit, ...meta } = doc.meta;
  await env.DB.batch([
    env.DB.prepare("UPDATE documents SET meta = ? WHERE id = ?").bind(JSON.stringify({ ...meta, review, warnings: [] }), id),
    eventStmt(env.DB, "document", id, "reviewed", { kind: doc.kind, verdict: review.verdict }),
  ]);
}

/** Metadata after the user edits a generated document: fabrication checks re-run and the review is marked stale. */
export async function metaAfterEdit(env: Env, doc: Document, content: string): Promise<DocumentMeta> {
  const { parentContent: _omit, ...meta } = doc.meta;
  const profile = await getProfile(env.DB);
  const [knowledge, master, job] = await Promise.all([
    loadKnowledge(env.DB, profile),
    doc.parentId ? getDocument(env.DB, doc.parentId) : Promise.resolve(null),
    doc.jobId ? env.DB.prepare("SELECT description FROM jobs WHERE id = ?").bind(doc.jobId).first<{ description: string }>() : Promise.resolve(null),
  ]);
  const source = master ?? knowledge.master;
  const review = meta.review ? { review: { ...meta.review, stale: true } } : {};
  if (!source) return { ...meta, ...review, warnings: [] };

  const evidence = [evidenceText(knowledge), documentText(source.content), meta.angle ?? ""].join("\n");
  const checks = verifyGenerated(documentText(content), { evidence, context: job?.description ?? "" });
  if (doc.kind !== "tailored_cv") return { ...meta, ...review, warnings: checks };
  const unreadable = isLatexCv(content) && !parseLatexCv(content) ? ["This LaTeX couldn't be read. Check for unbalanced braces."] : [];
  return { ...meta, ...review, warnings: [...unreadable, ...missingContactDetails(headerText(content), headerText(source.content)), ...checks] };
}
