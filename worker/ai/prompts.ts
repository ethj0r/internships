// Output schemas and the context blocks prompts are assembled from. The instructions themselves live in
// worker/prompts/*.md so they can be edited without touching code (see worker/prompts/index.ts).
//
// Every step sees the candidate's knowledge base with evidence ids and must cite them. The Worker validates
// every citation (worker/personalization/validate.ts) before anything reaches a document.

import { z } from "zod";
import { isAlwaysIncluded, plain } from "../../shared/cv";
import {
  COVER_LETTER_CRITERIA,
  CV_CRITERIA,
  EVIDENCE_STRENGTHS,
  REQUIREMENT_KINDS,
  STRENGTH_LABELS,
  type CompanyFact,
  type JobInsights,
  type JobRequirement,
  type LetterPlan,
  type QualityIssue,
} from "../../shared/personalization";
import { findCompany } from "../../shared/priority";
import { ROLE_LABELS } from "../../shared/roles";
import type { JobDetail, Profile } from "../../shared/types";
import { LETTER_RULES, bannedForPrompt } from "../letters/lint";
import { truncate } from "../lib/text";
import { knowledgeForPrompt, type Knowledge } from "../personalization/knowledge";
import type { Retrieval } from "../personalization/semantic";
import { block, render, type Rendered } from "../prompts";

// ---------- Schemas ----------

const RequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(REQUIREMENT_KINDS),
  importance: z.number(),
  competencies: z.array(z.string()),
  why_it_matters: z.string(),
  convincing_evidence: z.string(),
  employer_terms: z.array(z.string()),
});

export const RoleAnalysisSchema = z.object({
  requirements: z.array(RequirementSchema),
  role: z.object({
    core_problems: z.array(z.string()),
    intern_scope: z.string(),
    implicit_signals: z.array(z.object({ signal: z.string(), posting_phrase: z.string() })),
  }),
  role_summary: z.string(),
  company_context: z.string(),
  concerns: z.array(z.string()),
});

export const EvidenceJudgeSchema = z.object({
  matches: z.array(
    z.object({ requirement_id: z.string(), strength: z.enum(EVIDENCE_STRENGTHS), evidence_ids: z.array(z.string()), rationale: z.string(), cv_action: z.string() }),
  ),
  strategy: z.object({
    target_role: z.string(),
    top_hiring_signals: z.array(z.string()),
    strongest_evidence: z.array(z.string()),
    secondary_evidence: z.array(z.string()),
    deemphasize: z.array(z.string()),
    cv_strategy: z.string(),
    cover_letter_angle: z.string(),
  }),
});

/** Choices applied to a LaTeX master CV: entries, bullet rewrites with their evidence, skill order. */
export const CvPlanSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      bullets: z.array(
        z.object({ text: z.string(), from: z.array(z.number()), evidence_ids: z.array(z.string()), requirement_ids: z.array(z.string()), reason: z.string() }),
      ),
      drop: z.array(z.object({ bullet: z.number(), reason: z.string() })),
    }),
  ),
  omit: z.array(z.object({ id: z.string(), reason: z.string() })),
  skills: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
});

/** A complete CV in the template's structure, for masters that aren't LaTeX. */
export const FullCvSchema = z.object({
  name: z.string(),
  contacts: z.array(z.object({ text: z.string(), url: z.string() })),
  sections: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(["entries", "items", "skills"]),
      entries: z.array(z.object({ title: z.string(), title_right: z.string(), subtitle: z.string(), subtitle_right: z.string(), bullets: z.array(z.string()) })),
      items: z.array(z.object({ heading: z.string(), date: z.string(), bullets: z.array(z.string()) })),
      skill_lines: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
    }),
  ),
  changes: z.array(z.object({ section: z.string(), change: z.string(), reason: z.string() })),
});

export const CvVerifySchema = z.object({
  bullets: z.array(
    z.object({
      bullet_id: z.string(),
      claims: z.array(z.object({ claim: z.string(), support: z.enum(["supported", "partial", "unsupported"]), evidence_ids: z.array(z.string()), problem: z.string() })),
    }),
  ),
});

export const LetterPlanSchema = z.object({
  company_need: z.string(),
  why_role: z.string(),
  why_company: z.string(),
  company_fact_ids: z.array(z.string()),
  opening: z.string(),
  narrative: z.array(
    z.object({ need: z.string(), experience: z.string(), why_it_matters: z.string(), requirement_ids: z.array(z.string()), evidence_ids: z.array(z.string()) }),
  ),
  contribution: z.string(),
  motivation: z.string(),
  location_sentence: z.string(),
});

export const LetterSchema = z.object({
  letter_markdown: z.string(),
  claims: z.array(z.object({ claim: z.string(), evidence_ids: z.array(z.string()), company_fact_ids: z.array(z.string()) })),
});

export const LetterVerifySchema = z.object({
  unsupported: z.array(z.object({ quote: z.string(), problem: z.string() })),
});

export const LetterCritiqueSchema = z.object({
  flags: z.array(z.object({ quote: z.string(), problem: z.string(), fix: z.string() })),
  strongest_line: z.string(),
  verdict: z.enum(["send", "revise"]),
  summary: z.string(),
});

const reviewSchema = <C extends readonly [string, ...string[]]>(criteria: C) =>
  z.object({
    scores: z.array(z.object({ criterion: z.enum(criteria), score: z.number(), note: z.string() })),
    issues: z.array(z.object({ severity: z.enum(["blocking", "warning"]), quote: z.string(), problem: z.string(), fix: z.string() })),
    verdict: z.enum(["ready", "revise"]),
    summary: z.string(),
  });
export const CvReviewSchema = reviewSchema(CV_CRITERIA);
export const LetterReviewSchema = reviewSchema(COVER_LETTER_CRITERIA);

export const AnswersSchema = z.object({
  introduction: z.string(),
  answers: z.array(z.object({ question: z.string(), answer: z.string(), based_on: z.string() })),
  project_explanations: z.array(z.object({ project: z.string(), explanation: z.string() })),
});

// ---------- Shared blocks ----------

const grounding = () => block("grounding_rules");
const cvPrinciples = () => block("cv_principles");
export const letterStyle = () => block("letter_style", { minWords: LETTER_RULES.minWords, maxWords: LETTER_RULES.maxWords, banned: bannedForPrompt() });

function profileBlock(p: Profile): string {
  const lines = [
    p.fullName && `Name: ${p.fullName}`,
    p.headline && `Headline: ${p.headline}`,
    p.education && `Education: ${p.education}`,
    p.graduationDate && `Expected graduation: ${p.graduationDate}`,
    p.location && `Location: ${p.location}`,
    p.targetRoles.length && `Target roles: ${p.targetRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}`,
  ].filter(Boolean);
  return `<candidate_profile>\n${lines.join("\n")}\n</candidate_profile>`;
}

function candidateBasics(p: Profile, k: Knowledge): string {
  const education = p.education || k.evidence.find((e) => e.section.toLowerCase().includes("education"))?.label || "";
  return [education && `Education: ${education}`, p.graduationDate && `Expected graduation: ${p.graduationDate}`, `Based in: ${p.location || "Bandung, Indonesia"} (UTC+7)`]
    .filter(Boolean)
    .join("\n");
}

function knowledgeBlock(k: Knowledge, compact: boolean): string {
  const text = knowledgeForPrompt(k);
  return `<knowledge_base>
Everything known about the candidate, grouped by CV entry. Cite evidence by id, e.g. exp1.b2 (bullet), exp1.h (heading), note4 (note).
${compact ? truncate(text, 14_000) : text}
</knowledge_base>`;
}

function jobBlock(job: JobDetail, compact: boolean): string {
  const header = [`Company: ${job.company}`, `Title: ${job.title}`, job.department && `Team: ${job.department}`, job.location && `Location: ${job.location}`, job.duration && `Duration: ${job.duration}`]
    .filter(Boolean)
    .join("\n");
  return `<job_posting>\n${header}\n\n${compact ? truncate(job.description, 9_000) : job.description}\n</job_posting>`;
}

/** The posting's header only, for steps that already have the role analysis (saves the full posting's tokens). */
function jobHeaderBlock(job: JobDetail): string {
  const header = [`Company: ${job.company}`, `Title: ${job.title}`, job.department && `Team: ${job.department}`, job.location && `Location: ${job.location}`, job.duration && `Duration: ${job.duration}`]
    .filter(Boolean)
    .join("\n");
  return `<job_posting>\n${header}\n(The full posting has been analysed; its requirements and employer terms are in the role analysis.)\n</job_posting>`;
}

/** CV entries that matter for this role (cited in the evidence map or retrieved for a requirement), plus every note. */
function relevantKnowledgeBlock(k: Knowledge, insights: JobInsights): string {
  const ids = new Set([...insights.matches.flatMap((m) => m.evidenceIds), ...(insights.retrieval ?? []).flatMap((r) => r.candidates.slice(0, 3).map((c) => c.id))]);
  const groups = new Set(k.evidence.filter((e) => ids.has(e.id)).map((e) => e.group));
  const kept = k.evidence.filter((e) => groups.has(e.group) || e.kind === "note");
  const byGroup = new Map<string, typeof kept>();
  for (const e of kept) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
  const lines: string[] = [];
  for (const [group, items] of byGroup) {
    lines.push(`[${group}] ${items[0]!.section}: ${items[0]!.label}`);
    for (const e of items) lines.push(`  ${e.id}${e.kind === "note" ? " (candidate's note)" : ""}: ${e.text}`);
  }
  return `<knowledge_base>
The candidate's experience relevant to this role, grouped by CV entry (other entries were judged irrelevant). Cite evidence by id.
${lines.join("\n")}
</knowledge_base>`;
}

/** One line per CV entry, for the judge to spot evidence retrieval missed without reading everything. */
function knowledgeIndex(k: Knowledge): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of k.evidence) {
    if (seen.has(e.group)) continue;
    seen.add(e.group);
    const heading = k.evidence.find((x) => x.group === e.group && x.kind === "heading");
    const bullets = k.evidence.filter((x) => x.group === e.group && x.kind !== "heading").map((x) => x.id);
    lines.push(`[${e.group}] ${e.section}: ${e.label}${heading ? ` (${heading.id})` : ""}. Evidence ids: ${bullets.join(", ") || "none"}`);
  }
  return lines.join("\n");
}

function factsBlock(facts: CompanyFact[]): string {
  if (!facts.length) return "<company_research>\nNo verified research is available. Use only the job posting for facts about the company.\n</company_research>";
  return `<company_research>
Facts from public sources. Beyond the job posting, these are the only facts about the company you may use.
${facts.map((f) => `${f.id}: ${f.text} (${f.sources.map((s) => s.url).join(", ")})`).join("\n")}
</company_research>`;
}

/** What this company's interviewers tend to weigh (config/companies.json). Steers selection; never quoted. */
export function companySignals(company: string): string[] {
  return findCompany(company)?.signals ?? [];
}

function companySignalsBlock(company: string): string {
  const signals = companySignals(company);
  if (!signals.length) return "";
  return `<company_signals>
What interviewers at ${findCompany(company)!.name} tend to weigh, from the candidate's own notes. Use it only to decide which real experiences to put forward. Never quote these words, name company values, or describe the candidate with them.
${signals.map((s) => `- ${s}`).join("\n")}
</company_signals>`;
}

function roleBlock(insights: Pick<JobInsights, "role" | "roleSummary">): string {
  const r = insights.role;
  if (!r) return insights.roleSummary;
  return [
    insights.roleSummary,
    r.coreProblems.length && `Core problems: ${r.coreProblems.join("; ")}`,
    r.internScope && `Intern scope: ${r.internScope}`,
    r.implicitSignals.length && `Implicit signals: ${r.implicitSignals.map((s) => `${s.signal} (“${s.quote}”)`).join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function analysisBlock(insights: JobInsights): string {
  const s = insights.strategy;
  const requirements = insights.requirements.map((r) => {
    const m = insights.matches.find((x) => x.requirementId === r.id);
    const evidence = m ? `${STRENGTH_LABELS[m.strength]}${m.evidenceIds.length ? ` (${m.evidenceIds.join(", ")})` : ""}. ${m.rationale}` : "Not assessed.";
    return `${r.id} [${r.kind}, importance ${r.importance}/5] ${r.text}
  Competencies: ${r.competencies.join(", ")}
  Evidence: ${evidence}${m?.cvAction ? `\n  CV action: ${m.cvAction}` : ""}${r.employerTerms.length ? `\n  Employer terms: ${r.employerTerms.join(", ")}` : ""}`;
  });
  return `<role_analysis>
Target role: ${s.targetRole}
${roleBlock(insights)}
Top hiring signals: ${s.topHiringSignals.join("; ")}
Strongest evidence: ${s.strongestEvidence.join("; ") || "none"}
Secondary evidence: ${s.secondaryEvidence.join("; ") || "none"}
De-emphasize: ${s.deemphasize.join("; ") || "nothing"}
Gaps, never to be claimed: ${s.importantGaps.join("; ") || "none"}
CV strategy: ${s.cvStrategy}
Cover letter angle: ${s.coverLetterAngle}

Requirements:
${requirements.join("\n")}
</role_analysis>`;
}

function feedbackBlock(feedback: string[]): string {
  if (!feedback.length) return "";
  return `\n\n<review_feedback>
A reviewer rejected the previous draft for these reasons. Fix every one while keeping to the ground rules:
${feedback.map((f) => `- ${f}`).join("\n")}
</review_feedback>`;
}

function candidateName(profile: Profile, k: Knowledge): string {
  return profile.fullName || k.doc?.header.name || "";
}

// ---------- Company research ----------

export function researchPrompt(job: JobDetail): Rendered {
  return render("research", {
    company: job.company,
    title: job.title,
    team: job.department ? `\nTeam: ${job.department}` : "",
    location: job.location ? `\nLocation: ${job.location}` : "",
    url: job.url,
    excerpt: truncate(job.description, 3_000),
  });
}

// ---------- Job insights ----------

export function roleAnalysisPrompt(input: { profile: Profile; knowledge: Knowledge; job: JobDetail; facts: CompanyFact[]; compact: boolean; maxRequirements: number }): Rendered {
  const { profile, knowledge, job, facts, compact, maxRequirements } = input;
  return render("role_analysis", {
    candidate_basics: candidateBasics(profile, knowledge),
    job: jobBlock(job, compact),
    facts: factsBlock(facts),
    company_signals: companySignalsBlock(job.company),
    max_requirements: maxRequirements,
  });
}

function candidatesBlock(requirements: JobRequirement[], retrieval: Retrieval[] | null, k: Knowledge): string {
  return requirements
    .map((r) => {
      const found = retrieval?.find((x) => x.requirementId === r.id)?.candidates ?? [];
      const lines = found.map((c) => {
        const e = k.byId.get(c.id);
        return e ? `  - ${c.id} (${c.score.toFixed(2)}) ${e.label}: ${e.text}` : "";
      });
      return `${r.id} [${r.kind}, importance ${r.importance}/5] ${r.text}\n  Competencies: ${r.competencies.join(", ")}\n${lines.filter(Boolean).join("\n") || "  (no close matches found; check the index)"}`;
    })
    .join("\n\n");
}

export function evidenceJudgePrompt(input: {
  profile: Profile;
  knowledge: Knowledge;
  job: JobDetail;
  requirements: JobRequirement[];
  role: Pick<JobInsights, "role" | "roleSummary">;
  retrieval: Retrieval[] | null;
  compact: boolean;
}): Rendered {
  const { profile, knowledge, job, requirements, role, retrieval, compact } = input;
  return render("evidence_judge", {
    grounding_rules: grounding(),
    profile: profileBlock(profile),
    role: roleBlock(role),
    company_signals: companySignalsBlock(job.company),
    candidates: candidatesBlock(requirements, retrieval, knowledge),
    // With retrieval, the candidates carry the text and a one-line-per-entry index is enough to spot misses.
    knowledge_index: retrieval ? knowledgeIndex(knowledge) : compact ? truncate(knowledgeForPrompt(knowledge), 12_000) : knowledgeForPrompt(knowledge),
  });
}

// ---------- Tailored CV ----------

function cvForTailoring(k: Knowledge): string {
  const lines: string[] = [];
  for (const s of k.doc?.sections ?? []) {
    if (s.type === "skills") {
      lines.push(`## ${s.title}`, ...s.lines.map((l) => `- ${l.label}: ${l.items.map((x) => plain(x)).join(", ")}`));
      continue;
    }
    if (s.type !== "entries" && s.type !== "items") continue;
    lines.push(`## ${s.title}${isAlwaysIncluded(s) ? " (always_included)" : ""}`);
    for (const x of s.type === "entries" ? s.entries : s.items) {
      const group = k.groupOfEntryId.get(x.id)!;
      const evidence = k.evidence.filter((e) => e.group === group);
      lines.push(`entry ${x.id} (evidence group ${group}): ${evidence.find((e) => e.kind === "heading")?.text ?? ""}`);
      x.bullets.forEach((b, i) => lines.push(`  ${i + 1}. [${group}.b${i + 1}] ${b}`));
      for (const note of evidence.filter((e) => e.kind === "note")) lines.push(`  candidate's note [${note.id}]: ${note.text}`);
    }
  }
  return lines.join("\n");
}

interface CvInput {
  profile: Profile;
  knowledge: Knowledge;
  job: JobDetail;
  insights: JobInsights;
  compact: boolean;
  feedback: string[];
}

export function tailorCvPrompt({ profile, knowledge, job, insights, feedback }: CvInput): Rendered {
  return render("cv_tailor", {
    cv_principles: cvPrinciples(),
    grounding_rules: grounding(),
    profile: profileBlock(profile),
    master_cv: cvForTailoring(knowledge),
    job: jobHeaderBlock(job),
    analysis: analysisBlock(insights),
    company_signals: companySignalsBlock(job.company),
    feedback: feedbackBlock(feedback),
  });
}

/** For a master CV that isn't LaTeX: rebuild it in the template's structure. */
export function tailorCvFromTextPrompt({ profile, knowledge, job, insights, compact, feedback }: CvInput): Rendered {
  return render("cv_from_text", {
    cv_principles: cvPrinciples(),
    grounding_rules: grounding(),
    profile: profileBlock(profile),
    master_cv: compact ? truncate(knowledge.master?.content ?? "", 12_000) : (knowledge.master?.content ?? ""),
    knowledge: knowledgeBlock(knowledge, compact),
    job: jobBlock(job, true),
    analysis: analysisBlock(insights),
    feedback: feedbackBlock(feedback),
  });
}

export function cvVerifyPrompt(bullets: { id: string; entryLabel: string; text: string; evidence: { id: string; text: string }[] }[]): Rendered {
  return render("cv_verify", {
    bullets: bullets
      .map((b) => `${b.id} (${b.entryLabel}): ${b.text}\n  Evidence:\n${b.evidence.map((e) => `  - ${e.id}: ${e.text}`).join("\n")}`)
      .join("\n\n"),
  });
}

// ---------- Cover letter ----------

export interface LetterInput {
  profile: Profile;
  knowledge: Knowledge;
  job: JobDetail;
  insights: JobInsights;
  cvText: string;
  angle: string;
  compact: boolean;
  /** Status-dependent instruction for the one location sentence (worker/letters/lint.ts). */
  locationGuidance: string;
  voice: string;
}

function letterContext({ profile, knowledge, job, insights, angle, compact }: LetterInput): string {
  // Slimmed: only relevant CV entries and a trimmed posting. The CV itself isn't included; a deterministic check
  // flags a letter that repeats it word for word.
  return `${profileBlock(profile)}

${relevantKnowledgeBlock(knowledge, insights)}

<job_posting>
Company: ${job.company}
Title: ${job.title}${job.location ? `\nLocation: ${job.location}` : ""}

${truncate(job.description, compact ? 4_000 : 6_000)}
</job_posting>

${factsBlock(insights.companyFacts)}

${analysisBlock(insights)}${
    angle ? `\n\n<candidate_angle>\nThe candidate asked the letter to reflect this, in their own words. It counts as evidence with the id "angle":\n${angle}\n</candidate_angle>` : ""
  }`;
}

/** Cover letters are planned first, so the narrative is explicit and reviewable, then written from the plan. */
export function coverLetterPlanPrompt(input: LetterInput): Rendered {
  return render("letter_plan", { grounding_rules: grounding(), context: letterContext(input), location_guidance: input.locationGuidance });
}

export function coverLetterWritePrompt(input: LetterInput & { plan: LetterPlan; lintFeedback: string }): Rendered {
  const { profile, knowledge, plan } = input;
  return render("letter_write", {
    letter_style: letterStyle(),
    grounding_rules: grounding(),
    context: letterContext(input),
    voice: input.voice,
    plan: JSON.stringify(plan, null, 2),
    lint_feedback: input.lintFeedback,
    name: candidateName(profile, knowledge) || "the candidate's name",
    company: input.job.company,
    targetWords: Math.round((LETTER_RULES.minWords + LETTER_RULES.maxWords) / 2),
    location_guidance: input.locationGuidance,
  });
}

/** Fact-check of a letter draft against the relevant evidence and the posting (fast model). */
export function letterVerifyPrompt(input: { knowledge: Knowledge; insights: JobInsights; job: JobDetail; letter: string }): Rendered {
  return render("letter_verify", {
    evidence: relevantKnowledgeBlock(input.knowledge, input.insights),
    posting: truncate(input.job.description, 6_000),
    letter: input.letter,
  });
}

export function letterCritiquePrompt(input: { job: JobDetail; insights: JobInsights; letter: string; compact: boolean }): Rendered {
  const { job, insights } = input;
  const summary = [`${job.company}: ${job.title}${job.location ? ` (${job.location})` : ""}`, roleBlock(insights), `Hiring signals: ${insights.strategy.topHiringSignals.join("; ")}`].join("\n");
  return render("letter_critique", {
    job_summary: summary,
    posting: truncate(job.description, input.compact ? 4_000 : 7_000),
    facts: factsBlock(insights.companyFacts),
    letter: input.letter,
  });
}

export function letterRevisePrompt(input: LetterInput & { letter: string; critique: string; lintFeedback: string }): Rendered {
  const { profile, knowledge } = input;
  return render("letter_revise", {
    letter_style: letterStyle(),
    grounding_rules: grounding(),
    context: letterContext(input),
    voice: input.voice,
    letter: input.letter,
    critique: input.critique,
    lint_feedback: input.lintFeedback,
    name: candidateName(profile, knowledge) || "the candidate's name",
    location_guidance: input.locationGuidance,
  });
}

// ---------- Quality review ----------

const CV_CRITERIA_TEXT: Record<(typeof CV_CRITERIA)[number], string> = {
  relevance: "Scanning for a few seconds, would a recruiter see why this candidate fits this role?",
  evidence: "Are the top hiring signals backed by the strongest evidence in the knowledge base?",
  credibility: "Do technical claims read as real, specific engineering work, with the concrete details kept?",
  clarity: "Is each bullet easy to parse, with its point first?",
  impact: "Do bullets lead with outcomes where the evidence has them, without artificial metrics?",
  ats: "Standard sections and plain wording that a parser reads correctly?",
  keywords: "Are the posting's terms used only where accurate, without stuffing?",
  consistency: "Consistent tense, emphasis, formatting and facts?",
  truthfulness: "Is every claim supported by the knowledge base, with no inflated scope?",
};

const LETTER_CRITERIA_TEXT: Record<(typeof COVER_LETTER_CRITERIA)[number], string> = {
  company_specificity: "Does it say something true and specific about this company or product, from the posting or cited research?",
  role_specificity: "Is it clearly about this role and its work rather than any internship?",
  narrative: "Does it build a logical chain from the team's need to the candidate's experience to why this role?",
  evidence: "Are its claims backed by concrete experience?",
  authenticity: "Does it sound like this candidate, a person, without manufactured feelings or familiarity?",
  conciseness: `About ${LETTER_RULES.minWords}–${LETTER_RULES.maxWords} words, with nothing that could be cut without loss?`,
  natural_language: "Free of generic AI phrasing, filler and machine rhythm?",
  cv_consistency: "Consistent with the CV, adding context rather than repeating it?",
  reason_for_applying: "Is the reason for applying clear and believable?",
};

export function reviewPrompt(input: {
  kind: "cv" | "cover_letter";
  content: string;
  knowledge: Knowledge;
  job: JobDetail;
  insights: JobInsights;
  checks: QualityIssue[];
  cvText?: string;
  compact: boolean;
}): Rendered {
  const { kind, content, knowledge, job, insights, checks, cvText, compact } = input;
  const letter = kind === "cover_letter";
  const criteria = letter ? LETTER_CRITERIA_TEXT : CV_CRITERIA_TEXT;
  return render("review", {
    knowledge: letter ? relevantKnowledgeBlock(knowledge, insights) : knowledgeBlock(knowledge, compact),
    job: jobHeaderBlock(job),
    analysis: analysisBlock(insights),
    letter_context: letter ? `\n\n${factsBlock(insights.companyFacts)}\n\n<tailored_cv>\n${truncate(cvText ?? "", 8_000)}\n</tailored_cv>` : "",
    tag: letter ? "cover_letter" : "cv",
    content,
    checks: checks.length ? checks.map((c) => `- [${c.severity}] ${c.message}${c.quote ? ` (“${c.quote}”)` : ""}`).join("\n") : "None.",
    unit: letter ? "sentence" : "bullet",
    label: letter ? "letter" : "CV",
    criteria: Object.entries(criteria)
      .map(([key, text]) => `- ${key}: ${text}`)
      .join("\n"),
  });
}

// ---------- Application answers ----------

export const DEFAULT_QUESTIONS = (company: string) => [
  "Why are you interested in this role?",
  `Why do you want to work at ${company}?`,
  "Tell us about a technical project you're proud of.",
  "Describe a challenge you faced on a project and how you handled it.",
];

export function answersPrompt(input: { profile: Profile; knowledge: Knowledge; job: JobDetail; insights: JobInsights; questions: string[]; compact: boolean }): Rendered {
  const { profile, knowledge, job, insights, questions, compact } = input;
  return render("answers", {
    letter_style_short: "Plain, direct sentences. No em dashes, no semicolons, and none of the usual application filler (passionate, excited, leverage, dynamic, fast-paced).",
    grounding_rules: grounding(),
    profile: profileBlock(profile),
    knowledge: knowledgeBlock(knowledge, compact),
    job: jobBlock(job, compact),
    facts: factsBlock(insights.companyFacts),
    analysis: analysisBlock(insights),
    questions: questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
  });
}

export function renderAnswersMarkdown(data: z.infer<typeof AnswersSchema>): string {
  const parts = ["## Introduction", data.introduction.trim(), "## Application answers"];
  for (const a of data.answers) parts.push(`### ${a.question.trim()}`, a.answer.trim());
  if (data.project_explanations.length) {
    parts.push("## Project explanations");
    for (const p of data.project_explanations) parts.push(`### ${p.project.trim()}`, p.explanation.trim());
  }
  return parts.join("\n\n");
}
