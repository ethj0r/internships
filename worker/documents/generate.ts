// Evidence-based document generation (docs/personalization.md).
//
// Only postings that passed the eligibility filter (shared/eligibility.ts) are tailored. Every document starts from
// the job's insights (role analysis, semantic requirement → evidence map, strategy) and cites the knowledge base.
// CVs: the model's bullet rewrites pass deterministic guards, then a claim-by-claim verification; anything
// unsupported falls back to the master CV's wording. Letters: written in the candidate's voice, linted
// mechanically and regenerated until clean, critiqued by a skeptical-recruiter pass and revised once. Drafts still
// need the user's approval.

import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import {
  applyTailoring,
  cvToLatex,
  cvToPlainText,
  describeTailoring,
  documentText,
  estimateLines,
  headerText,
  isLatexCv,
  parseLatexCv,
  plain,
  withHeaderItems,
  type CvDoc,
  type CvEntry,
  type CvItem,
  type CvSection,
} from "../../shared/cv";
import { canGenerate, ELIGIBILITY_LABELS, quoteAppears, type EligibilityStatus } from "../../shared/eligibility";
import {
  COVER_LETTER_CRITERIA,
  CV_CRITERIA,
  type BulletChange,
  type ClaimCheck,
  type EvidenceItem,
  type JobInsights,
  type LetterCritique,
  type LetterLintReport,
  type LetterPlan,
  type OmittedEntry,
  type QualityCriterion,
  type QualityIssue,
  type QualityReview,
} from "../../shared/personalization";
import { extractSkills } from "../../shared/skills";
import type { Document, DocumentChange, DocumentMeta, Grounding, JobDetail } from "../../shared/types";
import {
  AnswersSchema,
  answersPrompt,
  coverLetterPlanPrompt,
  coverLetterWritePrompt,
  CvPlanSchema,
  CvReviewSchema,
  cvVerifyPrompt,
  CvVerifySchema,
  DEFAULT_QUESTIONS,
  FullCvSchema,
  letterCritiquePrompt,
  LetterCritiqueSchema,
  LetterPlanSchema,
  letterRevisePrompt,
  LetterReviewSchema,
  LetterSchema,
  letterVerifyPrompt,
  LetterVerifySchema,
  renderAnswersMarkdown,
  reviewPrompt,
  tailorCvFromTextPrompt,
  tailorCvPrompt,
  type LetterInput,
} from "../ai/prompts";
import { AiError, compactPrompts, generateJson } from "../ai/provider";
import { LETTER_RULES, lintFeedback, lintLetter, locationGuidance, normalizeHyphens, type LintContext, type LintResult } from "../letters/lint";
import { voiceBlock } from "../letters/voice";
import { eventStmt, getDocument, getLatestJobDocument, getProfile, nowIso } from "../lib/db";
import { plainText } from "../lib/text";
import { missingContactDetails, verifyGenerated } from "../matching/verify";
import { ensureInsights, loadContext, type Context } from "../personalization/insights";
import { evidenceText, groupEvidence, loadKnowledge } from "../personalization/knowledge";
import { applyBulletProposals, cvIssues, letterIssues } from "../personalization/validate";

// ---------- Eligibility gate ----------

/** Tailoring spends model calls, so only postings the candidate can realistically take get through. */
export function assertCanGenerate(job: JobDetail): void {
  const status = job.eligibilityStatus;
  if (canGenerate(job.eligibility ? { status, approvedAt: job.eligibility.approvedAt ?? null } : null)) return;
  const why: Partial<Record<EligibilityStatus, string>> = {
    EXCLUDED: `This posting was excluded: ${job.eligibility?.reason ?? "it's outside the locations you can work from."} Override it on the job page if that's wrong.`,
    CHECK_MANUALLY: `This posting needs a manual check first: ${job.eligibility?.reason ?? ""} Approve it on the job page to generate documents.`,
    UNCLASSIFIED: "This posting hasn't been through the eligibility check yet. Reclassify it on the job page.",
  };
  throw new HTTPException(409, { message: why[status] ?? `Documents can't be generated for postings marked ${ELIGIBILITY_LABELS[status]}.` });
}

async function loadEligibleContext(env: Env, jobId: number): Promise<Context> {
  const ctx = await loadContext(env, jobId);
  assertCanGenerate(ctx.job);
  return ctx;
}

// ---------- Storage ----------

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

function eligibilityMeta(job: JobDetail): DocumentMeta["eligibility"] {
  return { status: job.eligibilityStatus, reason: job.eligibility?.reason ?? "", workAuthorizationNote: job.eligibility?.workAuthorizationNote ?? null };
}

/** Rebuilds a job's insights: role analysis, semantic evidence map, strategy and company research. */
export async function analyzeJob(env: Env, jobId: number): Promise<JobInsights> {
  return ensureInsights(env, await loadEligibleContext(env, jobId), { refresh: true });
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
  verification: ClaimCheck[];
  checks: QualityIssue[];
  warnings: string[];
}

/**
 * Location in the header: the candidate's real location, with UTC+7 for remote roles. A Singapore work
 * authorization line appears only when the profile confirms one; otherwise it's flagged for the candidate.
 */
function headerFor(ctx: Context): { items: string[]; warnings: string[] } {
  const { profile, job } = ctx;
  const location = profile.location.trim() || "Bandung, Indonesia";
  const status = job.eligibilityStatus;
  const items = [status === "ELIGIBLE_REMOTE" ? `${location} (UTC+7)` : location];
  const warnings: string[] = [];
  if (status === "ELIGIBLE_SINGAPORE") {
    if (profile.sgWorkAuthorization.trim()) items.push(`Singapore: ${profile.sgWorkAuthorization.trim()}`);
    else {
      warnings.push(
        `No Singapore work authorization is confirmed in your profile, so this CV doesn't mention one. ${job.eligibility?.workAuthorizationNote ?? ""} Add it under Profile once it's confirmed.`.trim(),
      );
    }
  }
  return { items, warnings };
}

function cvChecks(ctx: Context, insights: JobInsights, text: string, headerItems: string[] = []): QualityIssue[] {
  return cvIssues(text, {
    evidence: evidenceText(ctx.knowledge),
    masterText: `${documentText(ctx.knowledge.master!.content, { urls: true })}\n${headerItems.join("\n")}`,
    posting: ctx.job.description,
    employerTerms: insights.requirements.flatMap((r) => r.employerTerms),
  });
}

function lengthWarning(master: CvDoc, tailored: CvDoc): string[] {
  const before = estimateLines(master);
  const after = estimateLines(tailored);
  return after > before + 1
    ? [`This version is about ${after - before} lines longer than your master CV. If your master fills one page, this one may spill onto a second; check the PDF and trim a bullet.`]
    : [];
}

/**
 * Checks every rewritten bullet claim by claim against its own evidence. A bullet with an unsupported claim is
 * replaced by the master CV's bullet it was based on; partly supported claims are flagged for the candidate.
 */
async function verifyRewrites(
  env: Env,
  ctx: Context,
  entries: { id: string; bullets: string[] }[],
  changesByEntry: Map<string, BulletChange[]>,
  masterBulletsOf: (entryId: string) => string[],
): Promise<{ checks: ClaimCheck[]; warnings: string[] }> {
  const k = ctx.knowledge;
  const items: { id: string; entryId: string; change: BulletChange; evidence: EvidenceItem[] }[] = [];
  for (const [entryId, changes] of changesByEntry) {
    const support = groupEvidence(k, k.groupOfEntryId.get(entryId)!);
    for (const change of changes) {
      if (change.status !== "rewritten") continue;
      items.push({ id: `B${items.length + 1}`, entryId, change, evidence: support.filter((e) => e.kind === "heading" || change.evidenceIds.includes(e.id)) });
    }
  }
  if (!items.length) return { checks: [], warnings: [] };

  let data: z.infer<typeof CvVerifySchema>;
  try {
    ({ data } = await generateJson(env, {
      tier: "fast",
      ...cvVerifyPrompt(items.map((it) => ({ id: it.id, entryLabel: it.change.entryLabel, text: it.change.tailored, evidence: it.evidence.map((e) => ({ id: e.id, text: e.text })) }))),
      schema: CvVerifySchema,
    }));
  } catch (err) {
    console.warn(JSON.stringify({ message: "cv.verify_failed", error: String(err) }));
    return { checks: [], warnings: ["The claim-by-claim verification couldn't run this time. Check the rewritten bullets against your master CV yourself."] };
  }

  const checks: ClaimCheck[] = [];
  for (const it of items) {
    const result = data.bullets.find((b) => b.bullet_id === it.id);
    if (!result) continue;
    const claims = result.claims.map((c) => ({ claim: c.claim.trim(), support: c.support, evidenceIds: c.evidence_ids.filter((id) => k.byId.has(id)), problem: c.problem.trim() }));
    const unsupported = claims.filter((c) => c.support === "unsupported");
    const partial = claims.filter((c) => c.support === "partial");
    let action: ClaimCheck["action"] = "kept";
    if (unsupported.length) {
      const entry = entries.find((e) => e.id === it.entryId);
      const index = entry?.bullets.findIndex((b) => plain(b) === it.change.tailored) ?? -1;
      if (entry && index >= 0) {
        // Back to the master bullet the rewrite was based on, unless the CV already has it (then just drop the
        // rewrite, so the same bullet never appears twice).
        const present = new Set(entry.bullets.map((b) => plain(b)));
        const original = masterBulletsOf(it.entryId).find((m) => it.change.original.includes(plain(m)) && !present.has(plain(m)));
        it.change.proposed = it.change.tailored;
        if (original) {
          entry.bullets[index] = original;
          it.change.tailored = plain(original);
        } else {
          entry.bullets.splice(index, 1);
          it.change.tailored = "";
        }
        it.change.status = "reverted";
        action = "reverted";
      }
      it.change.issues.push(...unsupported.map((c) => `Verification: “${c.claim}” isn't supported by this entry's evidence${c.problem ? ` (${c.problem})` : ""}.`));
    }
    it.change.issues.push(...partial.map((c) => `Verification: “${c.claim}” goes beyond the evidence${c.problem ? `: ${c.problem}` : ""}. Check the wording.`));
    checks.push({ entryLabel: it.change.entryLabel, bullet: it.change.proposed ?? it.change.tailored, claims, action });
  }
  return { checks, warnings: [] };
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

  const verified = await verifyRewrites(env, ctx, entries, changesByEntry, (id) => located.get(id)?.x.bullets ?? []);
  // Safety net: a bullet never appears twice in one entry, whatever path put it there.
  for (const entry of entries) {
    const seen = new Set<string>();
    entry.bullets = entry.bullets.filter((b) => {
      const key = plain(b).toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const header = headerFor(ctx);
  const doc = withHeaderItems(applyTailoring(master, { entries, skills: data.skills, omit: data.omit.map((o) => o.id) }, job.skills), header.items);
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
    verification: verified.checks,
    checks: cvChecks(ctx, insights, text, header.items),
    warnings: [...header.warnings, ...verified.warnings, ...lengthWarning(master, doc)],
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
  const header = headerFor(ctx);
  const doc = withHeaderItems(fullCvToDoc(data), header.items);
  const text = cvToPlainText(doc, { urls: true });
  return {
    doc,
    text,
    generator,
    changes: data.changes,
    bulletChanges: [],
    omitted: [],
    verification: [],
    checks: cvChecks(ctx, insights, text, header.items),
    warnings: [
      "Your master CV isn't a LaTeX file, so the template was filled from its extracted text and bullet-by-bullet tracing isn't available. Upload your résumé's .tex source under Documents to keep its exact wording and structure.",
      ...header.warnings,
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
  const ctx = await loadEligibleContext(env, jobId);
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
      verification: draft.verification,
      strategy: insights.strategy,
      requirements: insights.requirements,
      matches: insights.matches,
      evidence: citedEvidence(insights, draft.bulletChanges.flatMap((b) => b.evidenceIds)),
      eligibility: eligibilityMeta(ctx.job),
      review,
    },
  });
}

// ---------- Cover letter ----------

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

const CAPITALIZED_STOP = new Set("The We You Our This In At For As If And Or But With From About What Who How Why When Where Your Their They It Is Are Be To Of On By An A Us All Any Each More Most Other Some Such No Not Only Own Same So Than Too Very Can Will Just Should Now Join Apply Please Benefits Requirements Responsibilities Qualifications Internship Intern Role Team".split(" "));

/** Terms that make a paragraph specific to the candidate or to this company, for the lint's specificity rule. */
function specificityTerms(ctx: Context, insights: JobInsights): Pick<LintContext, "candidateTerms" | "companyTerms"> {
  const k = ctx.knowledge;
  const evidence = evidenceText(k);
  const candidateTerms = [
    ...new Set([
      ...k.evidence.filter((e) => e.kind === "heading" || e.kind === "note").map((e) => e.label.split(/[,|(]/)[0]!.trim()),
      ...k.evidence.flatMap((e) => e.technologies),
      ...extractSkills(evidence),
      ...(evidence.match(/\b\d[\d,.+%]*\b/g) ?? []).filter((n) => n.length >= 2),
    ]),
  ].filter((t) => t.length >= 2);
  const posting = plainText(ctx.job.description);
  const capitalized = (posting.match(/\b[A-Z][A-Za-z0-9]{2,}(?:\s[A-Z][A-Za-z0-9]+)*\b/g) ?? []).filter((w) => !CAPITALIZED_STOP.has(w.split(" ")[0]!));
  const companyTerms = [
    ...new Set([
      ctx.job.company,
      ...ctx.job.company.split(/\s+/),
      ...capitalized,
      ...extractSkills(posting),
      ...insights.requirements.flatMap((r) => r.employerTerms),
      ...(insights.role?.coreProblems ?? []).flatMap((p) => p.split(/\s+/).filter((w) => w.length >= 6)),
      ...insights.companyFacts.flatMap((f) => f.text.match(/\b[A-Z][A-Za-z0-9]{2,}\b/g) ?? []),
    ]),
  ].filter((t) => t.length >= 2);
  return { candidateTerms, companyTerms };
}

interface LetterDraft {
  content: string;
  generator: string;
  claims: z.infer<typeof LetterSchema>["claims"];
  lint: LintResult;
}

function lintRank(l: LintResult): number {
  return l.violations.length;
}

/** Writes (or revises) until the lint passes or the attempts run out. Returns the draft with the fewest violations. */
async function untilClean(
  write: (feedback: string) => Promise<{ content: string; generator: string; claims: LetterDraft["claims"] }>,
  lint: (content: string) => Promise<LintResult>,
  attempts: number,
) {
  let best: LetterDraft | null = null;
  let feedback = "";
  let tries = 0;
  for (; tries < attempts; tries++) {
    const written = await write(feedback);
    const result = await lint(written.content);
    const draft = { ...written, lint: result };
    if (!best || lintRank(result) < lintRank(best.lint)) best = draft;
    if (result.ok) break;
    feedback = lintFeedback(result);
  }
  return { draft: best!, attempts: Math.min(tries + 1, attempts) };
}

function critiqueText(c: z.infer<typeof LetterCritiqueSchema>): string {
  return [
    `Verdict: ${c.verdict}. ${c.summary}`,
    ...c.flags.map((f) => `- “${f.quote}”: ${f.problem} Fix: ${f.fix}`),
    c.strongest_line ? `Strongest line, keep its style: “${c.strongest_line}”` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateCoverLetter(env: Env, jobId: number, angle = ""): Promise<number> {
  const ctx = await loadEligibleContext(env, jobId);
  const insights = await ensureInsights(env, ctx);
  const cvText = await letterCvText(env, ctx);
  const { knowledge: k, job, profile } = ctx;
  const trimmedAngle = angle.trim();

  const guidance = locationGuidance(job.eligibilityStatus, {
    location: profile.location,
    sgWorkAuthorization: profile.sgWorkAuthorization,
    timezoneNote: job.eligibility?.timezoneNote ?? null,
    asyncEvidence: /\b(async|asynchronous|remote|distributed|across time zones)\b/i.test(evidenceText(k)),
  });
  const input: LetterInput = { profile, knowledge: k, job, insights, cvText, angle: trimmedAngle, compact: compactPrompts(env), locationGuidance: guidance, voice: voiceBlock() };
  const lintCtx: LintContext = { company: job.company, status: job.eligibilityStatus, sgWorkAuthorization: profile.sgWorkAuthorization, ...specificityTerms(ctx, insights) };
  // Mechanical rules, then a fact-check (fast model): claims the evidence or posting don't support must be fixed
  // like any other rule. If the fact-check fails to run, the mechanical result stands.
  const lint = async (content: string): Promise<LintResult> => {
    const text = normalizeHyphens(content);
    const result = lintLetter(text, lintCtx);
    try {
      const { data } = await generateJson(env, { ...letterVerifyPrompt({ knowledge: k, insights, job, letter: text }), schema: LetterVerifySchema, tier: "fast" });
      const found = data.unsupported
        .filter((u) => u.quote.trim() && quoteAppears(u.quote, text))
        .map((u) => ({ rule: "unsupported_claim", message: `Not supported by your experience or the posting: ${u.problem.trim()} Cut it or replace it with something the sources say.`, quote: u.quote.trim() }));
      if (found.length) return { ...result, ok: false, violations: [...result.violations, ...found] };
    } catch (err) {
      console.warn(JSON.stringify({ message: "letter.verify_failed", error: String(err) }));
    }
    return result;
  };

  const factIds = new Set(["posting", ...insights.companyFacts.map((f) => f.id)]);
  const requirementIds = new Set(insights.requirements.map((r) => r.id));
  const validEvidence = (ids: string[]) => [...new Set(ids)].filter((id) => k.byId.has(id) || (trimmedAngle && id === "angle"));
  const validFacts = (ids: string[]) => [...new Set(ids)].filter((id) => factIds.has(id));

  // 1. Plan.
  const { data: p } = await generateJson(env, { ...coverLetterPlanPrompt(input), schema: LetterPlanSchema });
  const narrative = p.narrative.map((n) => ({
    need: n.need.trim(),
    experience: n.experience.trim(),
    whyItMatters: n.why_it_matters.trim(),
    requirementIds: n.requirement_ids.filter((id) => requirementIds.has(id)),
    evidenceIds: validEvidence(n.evidence_ids),
  }));
  const plan: LetterPlan = {
    opening: p.opening.trim(),
    locationSentence: p.location_sentence.trim(),
    companyNeed: p.company_need.trim(),
    whyRole: p.why_role.trim(),
    whyCompany: p.why_company.trim(),
    companyFactIds: validFacts(p.company_fact_ids),
    narrative,
    contribution: p.contribution.trim(),
    motivation: p.motivation.trim(),
  };

  // 2. Write, lint, and rewrite with the violations until clean.
  const written = await untilClean(
    async (feedback) => {
      const r = await generateJson(env, { ...coverLetterWritePrompt({ ...input, plan, lintFeedback: feedback }), schema: LetterSchema, temperature: 0.7 });
      return { content: normalizeHyphens(r.data.letter_markdown.trim()), generator: r.generator, claims: r.data.claims };
    },
    lint,
    LETTER_RULES.maxLintAttempts,
  );
  let draft = written.draft;
  let lintAttempts = written.attempts;
  if (draft.lint.words < 80) throw new AiError("The model didn't return a complete letter. Try again.");

  // 3. A skeptical recruiter reads it; one revision from the critique, linted again.
  let critique: LetterCritique | undefined;
  try {
    const { data: c } = await generateJson(env, { ...letterCritiquePrompt({ job, insights, letter: draft.content, compact: input.compact }), schema: LetterCritiqueSchema });
    critique = { flags: c.flags, strongestLine: c.strongest_line, verdict: c.verdict, summary: c.summary, revised: false };
    if (LETTER_RULES.maxRecruiterRevisions > 0 && (c.verdict === "revise" || c.flags.length)) {
      const revision = await untilClean(
        async (feedback) => {
          const r = await generateJson(env, {
            ...letterRevisePrompt({ ...input, letter: draft.content, critique: critiqueText(c), lintFeedback: feedback }),
            schema: LetterSchema,
            temperature: 0.6,
          });
          return { content: normalizeHyphens(r.data.letter_markdown.trim()), generator: r.generator, claims: r.data.claims };
        },
        lint,
        Math.max(1, LETTER_RULES.maxLintAttempts - 1),
      );
      // The revision replaces the draft unless it breaks more rules than the draft did.
      if (lintRank(revision.draft.lint) <= lintRank(draft.lint) && revision.draft.lint.words >= 80) {
        critique = { ...critique, revised: true, before: draft.content };
        draft = revision.draft;
        lintAttempts += revision.attempts;
      }
    }
  } catch (err) {
    console.warn(JSON.stringify({ message: "letter.critique_failed", jobId, error: String(err) }));
  }

  // 4. Grounding and the final scored review.
  const checks = letterChecks(ctx, insights, draft.content, cvText, trimmedAngle);
  for (const v of draft.lint.violations) checks.push({ severity: "blocking", message: `Rule: ${v.message}`, quote: v.quote, source: "check" });
  for (const claim of draft.claims) {
    if (!validEvidence(claim.evidence_ids).length && !validFacts(claim.company_fact_ids).length) {
      checks.push({ severity: "blocking", message: "This claim doesn't trace to your knowledge base or to a cited source.", quote: claim.claim, source: "check" });
    }
  }
  // The recruiter pass already judged it, so there's no extra reviewer call here (fast mode). "Review Again" on the
  // document runs the full scored review on demand.
  const blockingCount = checks.filter((c) => c.severity === "blocking").length;
  const review: QualityReview = {
    verdict: blockingCount ? "needs_work" : "ready",
    summary: [
      blockingCount ? `${blockingCount === 1 ? "1 issue" : `${blockingCount} issues`} to fix before sending.` : "Passes the writing rules and the grounding checks.",
      critique ? `Recruiter: ${critique.summary}${critique.revised ? " (revised once after this)" : ""}` : "",
      "Run Review Again for per-criterion scores.",
    ]
      .filter(Boolean)
      .join(" "),
    scores: [],
    issues: checks,
    attempts: 1,
    generator: "Writing rules and recruiter critique",
    reviewedAt: nowIso(),
    stale: false,
  };

  const sourceLabel = (id: string) => {
    if (id === "angle") return "What you asked the letter to reflect";
    if (id === "posting") return "Job posting";
    const fact = insights.companyFacts.find((f) => f.id === id);
    if (fact) return fact.sources.map((s) => s.title || s.url).join(", ");
    const e = k.byId.get(id);
    return e ? `${e.label} (${id})` : id;
  };
  const grounding: Grounding[] = draft.claims.map((c) => ({
    claim: c.claim,
    source: [...validEvidence(c.evidence_ids), ...validFacts(c.company_fact_ids)].map(sourceLabel).join("; ") || "Nothing supports this claim.",
  }));
  const evidenceIds = [...draft.claims.flatMap((c) => validEvidence(c.evidence_ids)), ...narrative.flatMap((n) => n.evidenceIds)];
  const lintReport: LetterLintReport = { ok: draft.lint.ok, words: draft.lint.words, attempts: lintAttempts, violations: draft.lint.violations, warnings: draft.lint.warnings };

  return insertDocument(env, {
    kind: "cover_letter",
    title: await versionedTitle(env, jobId, "cover_letter", `Cover letter for ${job.company}`),
    jobId,
    parentId: k.master!.id,
    content: draft.content,
    meta: {
      generator: draft.generator,
      grounding,
      warnings: [
        ...draft.lint.warnings.map((w) => w.message),
        ...(draft.lint.ok ? [] : [`The letter still breaks ${draft.lint.violations.length} writing rule(s) after ${lintAttempts} attempts. Fix them before sending.`]),
      ],
      plan,
      strategy: insights.strategy,
      requirements: insights.requirements,
      matches: insights.matches,
      companyFacts: insights.companyFacts,
      evidence: citedEvidence(insights, evidenceIds),
      eligibility: eligibilityMeta(job),
      lint: lintReport,
      critique,
      review,
      ...(trimmedAngle ? { angle: trimmedAngle } : {}),
    },
  });
}

// ---------- Application answers ----------

export async function generateAnswers(env: Env, jobId: number, questions?: string[]): Promise<number> {
  const ctx = await loadEligibleContext(env, jobId);
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

/** Runs the quality review on a document's current content, e.g. after the user edits it. Letters are re-linted too. */
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
  let lintReport: LetterLintReport | undefined;
  if (doc.kind === "tailored_cv") {
    const text = documentText(doc.content, { urls: true });
    const checks = [
      ...(isLatexCv(doc.content) && !parseLatexCv(doc.content) ? [blocking("This LaTeX couldn't be read. Check for unbalanced braces.")] : []),
      ...missingContactDetails(headerText(doc.content), headerText(ctx.knowledge.master!.content)).map(blocking),
      ...cvChecks(ctx, insights, text, headerFor(ctx).items),
    ];
    review = await reviewCv(env, ctx, insights, { text, checks }, attempts);
  } else {
    const cvText = await letterCvText(env, ctx);
    const checks = letterChecks(ctx, insights, doc.content, cvText, doc.meta.angle ?? "");
    const result = lintLetter(doc.content, { company: ctx.job.company, status: ctx.job.eligibilityStatus, sgWorkAuthorization: ctx.profile.sgWorkAuthorization, ...specificityTerms(ctx, insights) });
    for (const v of result.violations) checks.push({ severity: "blocking", message: `Rule: ${v.message}`, quote: v.quote, source: "check" });
    lintReport = { ok: result.ok, words: result.words, attempts: doc.meta.lint?.attempts ?? 1, violations: result.violations, warnings: result.warnings };
    const { data, generator } = await generateJson(env, {
      ...reviewPrompt({ kind: "cover_letter", content: doc.content, knowledge: ctx.knowledge, job: ctx.job, insights, checks, cvText, compact: compactPrompts(env) }),
      schema: LetterReviewSchema,
    });
    review = toReview(data, COVER_LETTER_CRITERIA, checks, attempts, generator);
  }

  const { parentContent: _omit, ...meta } = doc.meta;
  await env.DB.batch([
    env.DB.prepare("UPDATE documents SET meta = ? WHERE id = ?").bind(JSON.stringify({ ...meta, review, ...(lintReport ? { lint: lintReport } : {}), warnings: [] }), id),
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

  const evidence = [evidenceText(knowledge), documentText(source.content), meta.angle ?? "", profile.location].join("\n");
  const checks = verifyGenerated(documentText(content), { evidence, context: job?.description ?? "" });
  if (doc.kind !== "tailored_cv") return { ...meta, ...review, warnings: checks };
  const unreadable = isLatexCv(content) && !parseLatexCv(content) ? ["This LaTeX couldn't be read. Check for unbalanced braces."] : [];
  return { ...meta, ...review, warnings: [...unreadable, ...missingContactDetails(headerText(content), headerText(source.content)), ...checks] };
}
