// Job insights: what a posting is really evaluating, the candidate's evidence for each requirement, a tailoring
// strategy and cited company research. Built once per job and reused by every document until its inputs change.

import { HTTPException } from "hono/http-exception";
import { quoteAppears } from "../../shared/eligibility";
import type { CompanyFact, JobInsights, JobRequirement, RoleAnalysis } from "../../shared/personalization";
import type { JobDetail, Profile } from "../../shared/types";
import { companySignals, EvidenceJudgeSchema, evidenceJudgePrompt, researchPrompt, RoleAnalysisSchema, roleAnalysisPrompt } from "../ai/prompts";
import { compactPrompts, generateJson, researchWeb, usesClaude } from "../ai/provider";
import { eventStmt, getJobDetailRow, getProfile, nowIso, parseJson, toJobDetail } from "../lib/db";
import { plainText, sha256Hex } from "../lib/text";
import { loadKnowledge, type Knowledge } from "./knowledge";
import { retrieveEvidence, type Retrieval } from "./semantic";
import { parseResearchFacts, validateMatches } from "./validate";

export const INSIGHTS_VERSION = 3;
const MAX_REQUIREMENTS = 14;

export interface Context {
  job: JobDetail;
  profile: Profile;
  knowledge: Knowledge;
}

export async function loadContext(env: Env, jobId: number): Promise<Context> {
  const row = await getJobDetailRow(env.DB, jobId);
  if (!row) throw new HTTPException(404, { message: "Job not found." });
  const profile = await getProfile(env.DB);
  const knowledge = await loadKnowledge(env.DB, profile);
  if (!knowledge.master?.content.trim()) throw new HTTPException(400, { message: "Add your master CV first, under Documents." });
  return { job: toJobDetail(row, [], []), profile, knowledge };
}

/** Changes when the posting, master CV, knowledge notes or relevant profile fields change. */
export function insightsHash({ job, profile, knowledge }: Context): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      INSIGHTS_VERSION,
      job.company,
      job.title,
      job.description,
      knowledge.master?.content ?? "",
      knowledge.notes.map((n) => [n.id, n.entryKey, n.kind, n.title, n.body, n.links]),
      profile.headline,
      profile.education,
      profile.skills,
      profile.targetRoles,
      companySignals(job.company),
    ]),
  );
}

export async function getStoredInsights(db: D1Database, jobId: number): Promise<JobInsights | null> {
  const row = await db.prepare("SELECT content FROM job_insights WHERE job_id = ?").bind(jobId).first<{ content: string }>();
  const insights = row ? parseJson<JobInsights | null>(row.content, null) : null;
  return insights?.version === INSIGHTS_VERSION ? insights : null;
}

/** Stored insights for a job, and whether their inputs have changed since. */
export async function insightsState(db: D1Database, job: JobDetail): Promise<{ insights: JobInsights | null; stale: boolean }> {
  const insights = await getStoredInsights(db, job.id);
  if (!insights) return { insights: null, stale: false };
  const profile = await getProfile(db);
  const knowledge = await loadKnowledge(db, profile);
  return { insights, stale: insights.inputsHash !== (await insightsHash({ job, profile, knowledge })) };
}

/** Current insights for a job, rebuilding them when missing, out of date, or when refresh is set. */
export async function ensureInsights(env: Env, ctx: Context, opts: { refresh?: boolean } = {}): Promise<JobInsights> {
  const hash = await insightsHash(ctx);
  if (!opts.refresh) {
    const stored = await getStoredInsights(env.DB, ctx.job.id);
    if (stored?.inputsHash === hash) return stored;
  }
  const insights = await buildInsights(env, ctx, hash);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO job_insights (job_id, inputs_hash, content, generator, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (job_id) DO UPDATE SET inputs_hash = excluded.inputs_hash, content = excluded.content, generator = excluded.generator, created_at = excluded.created_at`,
    ).bind(ctx.job.id, hash, JSON.stringify(insights), insights.generator, insights.createdAt),
    eventStmt(env.DB, "job", ctx.job.id, "analyzed", { generator: insights.generator, research: insights.research }),
  ]);
  return insights;
}

/** Public facts about the company, each with a citation. Research is best-effort and needs Claude's web search. */
async function researchCompany(env: Env, job: JobDetail): Promise<CompanyFact[]> {
  if (!usesClaude(env)) return [];
  try {
    return parseResearchFacts(await researchWeb(env, researchPrompt(job)));
  } catch (err) {
    console.error(JSON.stringify({ message: "insights.research_failed", jobId: job.id, error: String(err) }));
    return [];
  }
}

async function buildInsights(env: Env, ctx: Context, inputsHash: string): Promise<JobInsights> {
  const { job, profile, knowledge } = ctx;
  const compact = compactPrompts(env);
  const companyFacts = await researchCompany(env, job);

  // 1. Understand the role, without the candidate's CV in view.
  const analysis = await generateJson(env, {
    ...roleAnalysisPrompt({ profile, knowledge, job, facts: companyFacts, compact, maxRequirements: compact ? 10 : MAX_REQUIREMENTS }),
    schema: RoleAnalysisSchema,
  });
  const a = analysis.data;
  const renamed = new Map<string, string>();
  const requirements = a.requirements.slice(0, MAX_REQUIREMENTS).map((r, i): JobRequirement => {
    const id = `R${i + 1}`;
    if (!renamed.has(r.id)) renamed.set(r.id, id);
    return {
      id,
      text: r.text.trim(),
      kind: r.kind,
      importance: Math.min(5, Math.max(1, Math.round(r.importance))),
      competencies: r.competencies.map((c) => c.trim()).filter(Boolean),
      whyItMatters: r.why_it_matters.trim(),
      convincingEvidence: r.convincing_evidence.trim(),
      employerTerms: r.employer_terms.map((t) => t.trim()).filter(Boolean),
    };
  });
  const text = plainText(job.description);
  const role: RoleAnalysis = {
    coreProblems: a.role.core_problems.map((p) => p.trim()).filter(Boolean),
    internScope: a.role.intern_scope.trim(),
    // Signals must point at a real phrase in the posting.
    implicitSignals: a.role.implicit_signals
      .filter((s) => s.signal.trim() && quoteAppears(s.posting_phrase, text))
      .map((s) => ({ signal: s.signal.trim(), quote: s.posting_phrase.trim() })),
    companySignals: companySignals(job.company),
  };
  const roleSummary = a.role_summary.trim();

  // 2. Retrieve the closest real experiences per requirement by meaning (open embeddings).
  let retrieval: Retrieval[] | null = null;
  try {
    retrieval = await retrieveEvidence(env, requirements, knowledge.evidence);
  } catch (err) {
    console.warn(JSON.stringify({ message: "insights.retrieval_failed", jobId: job.id, error: String(err) }));
  }

  // 3. Judge which evidence demonstrates each requirement, and why.
  const judged = await generateJson(env, {
    ...evidenceJudgePrompt({ profile, knowledge, job, requirements, role: { role, roleSummary }, retrieval, compact }),
    schema: EvidenceJudgeSchema,
  });
  const j = judged.data;
  const matches = validateMatches(
    requirements,
    j.matches.map((m) => ({ ...m, requirement_id: renamed.get(m.requirement_id) ?? m.requirement_id })),
    knowledge.byId,
  );

  const labelOf = (id: string) => knowledge.evidence.find((e) => e.group === id || e.id === id)?.label;
  const labels = (ids: string[]) => [...new Set(ids.map(labelOf).filter((l): l is string => Boolean(l)))];
  // Gaps come from the validated map, not the model's summary, so none are hidden.
  const importantGaps = requirements
    .filter((r) => {
      const strength = matches.find((m) => m.requirementId === r.id)?.strength;
      return (strength === "gap" || strength === "weak") && (r.kind === "required" || r.importance >= 3);
    })
    .sort((x, y) => y.importance - x.importance)
    .map((r) => r.text);

  return {
    version: INSIGHTS_VERSION,
    role,
    matching: retrieval ? "semantic" : "llm",
    retrieval: retrieval ?? undefined,
    roleSummary,
    companyContext: a.company_context.trim(),
    requirements,
    matches,
    strategy: {
      targetRole: j.strategy.target_role.trim(),
      topHiringSignals: j.strategy.top_hiring_signals.map((x) => x.trim()).filter(Boolean),
      strongestEvidence: labels(j.strategy.strongest_evidence),
      secondaryEvidence: labels(j.strategy.secondary_evidence),
      deemphasize: labels(j.strategy.deemphasize),
      importantGaps,
      cvStrategy: j.strategy.cv_strategy.trim(),
      coverLetterAngle: j.strategy.cover_letter_angle.trim(),
    },
    companyFacts,
    research: companyFacts.length ? "web" : "posting",
    concerns: a.concerns.map((c) => c.trim()).filter(Boolean),
    evidence: knowledge.evidence,
    generator: judged.generator,
    createdAt: nowIso(),
    inputsHash,
  };
}
