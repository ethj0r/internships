// Prompts and output schemas for evidence-based personalization (docs/personalization.md).
//
// Every step sees the candidate's knowledge base with evidence ids and must cite them. The Worker validates
// every citation (worker/personalization/validate.ts) before anything reaches a document.

import { z } from "zod";
import { plain, isAlwaysIncluded } from "../../shared/cv";
import {
  COVER_LETTER_CRITERIA,
  CV_CRITERIA,
  EVIDENCE_STRENGTHS,
  REQUIREMENT_KINDS,
  STRENGTH_LABELS,
  type CompanyFact,
  type JobInsights,
  type LetterPlan,
  type QualityIssue,
} from "../../shared/personalization";
import { ROLE_LABELS } from "../../shared/roles";
import type { JobDetail, Profile } from "../../shared/types";
import { truncate } from "../lib/text";
import { knowledgeForPrompt, type Knowledge } from "../personalization/knowledge";

// ---------- Schemas ----------

export const InsightsSchema = z.object({
  requirements: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      kind: z.enum(REQUIREMENT_KINDS),
      importance: z.number(),
      competencies: z.array(z.string()),
      why_it_matters: z.string(),
      convincing_evidence: z.string(),
      employer_terms: z.array(z.string()),
    }),
  ),
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
  role_summary: z.string(),
  company_context: z.string(),
  concerns: z.array(z.string()),
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

export const LetterPlanSchema = z.object({
  company_need: z.string(),
  why_role: z.string(),
  why_company: z.string(),
  company_fact_ids: z.array(z.string()),
  narrative: z.array(
    z.object({ need: z.string(), experience: z.string(), why_it_matters: z.string(), requirement_ids: z.array(z.string()), evidence_ids: z.array(z.string()) }),
  ),
  contribution: z.string(),
  motivation: z.string(),
});

export const LetterSchema = z.object({
  letter_markdown: z.string(),
  claims: z.array(z.object({ claim: z.string(), evidence_ids: z.array(z.string()), company_fact_ids: z.array(z.string()) })),
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

// ---------- Shared guidance ----------

/** What strong applications do, distilled from recruiter and hiring-manager sources (docs/personalization.md). */
const CV_PRINCIPLES = `How strong software engineering CVs read:
- A recruiter decides in seconds whether to keep reading. The strongest evidence for this role has to be visible first: in which entries lead, which bullets lead each entry, and the first words of each bullet.
- Accomplishments, not responsibilities. A bullet says what was built or solved, in what technical context, with which decisions, and what came of it: action → technical context → problem → result. "Accomplished X, as measured by Y, by doing Z" only when a real measure exists in the evidence.
- Technologies appear where they were used, in context, rather than as keywords.
- Tailoring is selection and emphasis, not vocabulary swapping. Lead with what proves fit, compress or drop what doesn't, and use the employer's term only where it accurately names the candidate's work (if they built CI/CD pipelines, say "CI/CD"; never add a tool they haven't used).
- Specific beats impressive-sounding. Vague claims about teamwork or passion persuade no one.`;

const LETTER_PRINCIPLES = `What makes a cover letter worth reading:
- It isn't the CV in paragraphs. It gives the context a CV can't: why this role and this team, how the candidate's path leads here, what they learned or built that matters for this work, and what they can realistically contribute.
- It builds one chain of reasoning: the team's need → a problem the candidate has actually faced → what they built or learned → why that matters here → why this role specifically.
- Company-specific means things a reader at the company would recognize as true, from the posting or cited research. Never pretend to know internal teams, systems, culture or plans.
- Motivation must be the candidate's own. Use their notes about interests and motivation, or what they asked the letter to reflect. Otherwise don't invent feelings: write a bracketed placeholder such as [Add a sentence on what draws you to payments infrastructure] for them to fill in.
- Plain, confident, specific sentences. No filler ("I am passionate about", "I am excited to apply", "fast-paced", "leverage", "proven track record", "team player", "cutting-edge") and no opening that just announces the application.
- 250–350 words in three or four paragraphs.`;

const GROUNDING_RULES = `Ground rules. These override every other instruction:
- The knowledge base is the only source of facts about the candidate, and every claim must trace to its evidence ids.
- Never invent or embellish employers, dates, titles, projects, metrics, technologies, scale, users, results or responsibilities.
- Never claim a technology or practice because the job asks for it. If the evidence doesn't show it, it's a gap: name it where asked, and keep it out of documents.
- Never inflate scope. "Contributed to" stays "contributed to"; "led", "owned", "architected" and "managed" need evidence that says so.
- Never add numbers the evidence doesn't contain, and don't force metrics into bullets.
- Items marked "candidate's note" are the candidate's own statements and count as evidence.`;

const TEMPLATE_NOTE =
  "The CV is typeset with the candidate's fixed LaTeX résumé template. You only choose and reword content: layout, section titles, organizations, roles, dates, locations, headings and contact details come from the master CV automatically.";

// ---------- Blocks ----------

function profileBlock(p: Profile): string {
  const lines = [
    p.fullName && `Name: ${p.fullName}`,
    p.headline && `Headline: ${p.headline}`,
    p.education && `Education: ${p.education}`,
    p.graduationDate && `Expected graduation: ${p.graduationDate}`,
    p.location && `Location: ${p.location}`,
    p.targetRoles.length && `Target roles: ${p.targetRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}`,
    p.workAuthorization && `Work authorization: ${p.workAuthorization}`,
  ].filter(Boolean);
  return `<candidate_profile>\n${lines.join("\n")}\n</candidate_profile>`;
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

function factsBlock(facts: CompanyFact[]): string {
  if (!facts.length) return "<company_research>\nNo verified research is available. Use only the job posting for facts about the company.\n</company_research>";
  return `<company_research>
Facts from public sources. Beyond the job posting, these are the only facts about the company you may use.
${facts.map((f) => `${f.id}: ${f.text} (${f.sources.map((s) => s.url).join(", ")})`).join("\n")}
</company_research>`;
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
${insights.roleSummary}
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

export function researchPrompt(job: JobDetail) {
  return {
    system:
      "You research a company for a student's internship application. Report only what public sources say, and cite them. Never guess about internal teams, systems, culture or plans.",
    prompt: `Company: ${job.company}
Role: ${job.title}${job.department ? `\nTeam: ${job.department}` : ""}${job.location ? `\nLocation: ${job.location}` : ""}
Posting: ${job.url}

Posting excerpt:
${truncate(job.description, 3_000)}

Find what a well-prepared applicant would genuinely know:
- what the company builds and for whom
- the product, team or domain this role supports, where public
- engineering challenges, engineering blog posts or talks related to this role's work
- technical developments from the last two years
- stated values or product principles

Write 4–10 findings. Each finding is its own paragraph of one or two sentences, stated as fact and supported by a source. Leave out anything you can't verify. If several companies share this name, use the posting to identify the right one; if you still can't, say so in one sentence and stop.`,
  };
}

// ---------- Job insights ----------

export function insightsPrompt(input: { profile: Profile; knowledge: Knowledge; job: JobDetail; facts: CompanyFact[]; compact: boolean }) {
  const { profile, knowledge, job, facts, compact } = input;
  return {
    system: `You are an experienced technical recruiter working with an engineering hiring manager to prepare a student's application for one internship. You read a posting for what the team actually needs, and you judge fit only on evidence.\n\n${GROUNDING_RULES}`,
    prompt: `${profileBlock(profile)}

${knowledgeBlock(knowledge, compact)}

${jobBlock(job, compact)}

${factsBlock(facts)}

Analyze this role in three steps.

1. requirements: what the employer is evaluating. Split the posting into its distinct requirements, at most ${compact ? 10 : 14}; merge near-duplicates and skip boilerplate such as equal-opportunity statements. Cover the whole posting, not only its requirements list: what the intern will actually do (responsibilities, such as making services reliable or writing tests) and signals about the team and product (context) often matter more to the hiring manager than the listed skills. For each:
- id: R1, R2, … in order.
- text: the requirement, close to the posting's wording.
- kind: required (must-have), preferred (nice-to-have), responsibility (what the intern will do) or context (a signal about the team, product or way of working).
- importance: 1–5, relative to the rest of this posting, judged by emphasis and the role's purpose rather than position.
- competencies: the underlying competencies being evaluated. "Experience building scalable backend services" can imply API design, database design, performance, reliability, production ownership or distributed systems; list only what this posting implies.
- why_it_matters: why this team needs it, in one sentence.
- convincing_evidence: what would convince a hiring manager, in one sentence.
- employer_terms: the posting's own terms for it, for reuse where they accurately describe the candidate's work.

2. matches: one per requirement, judged on meaning rather than shared words. "Worked with designers, backend developers and project leads to ship a platform" is evidence of cross-functional collaboration without using that phrase, while a tool named only in a skills list is weaker evidence than having built something with it.
- strength: strong (directly demonstrated), relevant (demonstrated by closely related experience), transferable (the underlying competency exists in a different context), weak (some indication, not enough proof), gap (no credible evidence) or unknown (the posting or the evidence is too vague to judge). Judge in both directions: evidence that explicitly shows the requirement being done in real work (e.g. "built CI/CD pipelines with GitHub Actions and Docker" for "familiarity with Docker and CI/CD") is strong, and adjacent experience is never strong.
- evidence_ids: the specific evidence, strongest first. Empty for gap and unknown.
- rationale: one or two sentences explaining the judgment and naming the experience.
- cv_action: how the CV should use this, e.g. "Lead Concorde Systems with the schema and REST API bullet". For a gap: "Don't claim" and what, if anything, is adjacent and true.

3. strategy:
- target_role: the role as its hiring manager would describe it.
- top_hiring_signals: the 3–5 things most likely to decide this hire.
- strongest_evidence and secondary_evidence: evidence group ids (e.g. exp1, proj2), best first.
- deemphasize: group ids that add little for this role.
- cv_strategy: two or three sentences on what to emphasize, compress and leave out.
- cover_letter_angle: the single connection between this team's need and the candidate's experience that a cover letter should build on.

Also:
- role_summary: two sentences on what the intern will actually do and for whom.
- company_context: what the posting${facts.length ? " and the research" : ""} establish about the company, product or team. Don't infer internal details.
- concerns: eligibility, location, timing or seniority risks. Empty if none.`,
  };
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

export function tailorCvPrompt(input: { profile: Profile; knowledge: Knowledge; job: JobDetail; insights: JobInsights; compact: boolean; feedback: string[] }) {
  const { profile, knowledge, job, insights, compact, feedback } = input;
  return {
    system: `You tailor a student's CV for one internship the way a strong candidate who understands the role would. ${TEMPLATE_NOTE}\n\n${CV_PRINCIPLES}\n\n${GROUNDING_RULES}`,
    prompt: `${profileBlock(profile)}

<master_cv>
Entries with their numbered bullets, each bullet's evidence id in brackets, and any notes the candidate added.
${cvForTailoring(knowledge)}
</master_cv>

${jobBlock(job, compact)}

${analysisBlock(insights)}${feedbackBlock(feedback)}

Tailor the CV to the role analysis.

entries: the entries to include, with their exact ids, most relevant to this role first within each section. List every entry of a section marked always_included. Keep the CV substantial: all experience and the projects with the strongest evidence.
- bullets: the entry's bullets for this role, strongest evidence for this role first, at most as many as the entry has. Normally include every master bullet, rewritten or copied; master bullets you neither use nor drop are kept after yours, unchanged.
  - text: the bullet. Rewrite only where the same facts can be presented more relevantly: lead with what matters for this role, keep the technical context and whatever result the evidence gives, and use the employer's term where it accurately names the work. If a bullet already does this, copy it exactly. Keep a similar length, and put **double asterisks** around key technologies and outcomes as the master does.
  - from: the numbers of the master bullets this bullet is based on, usually one.
  - evidence_ids: the ids of this entry's evidence the bullet's facts come from, including this entry's candidate's notes. Never use another entry's evidence.
  - requirement_ids: the requirements this bullet gives evidence for.
  - reason: one sentence on why this bullet is written and placed this way for this role.
- drop: master bullets (by number) to leave out because they add little for this role, each with a one-sentence reason tied to the role. Drop only when it sharpens the CV, and never drop evidence for a top hiring signal. Usually empty.
omit: entries you leave out, each with a one-sentence reason tied to the role.
skills: for each skill line, its label and its items, most relevant to this role first. Only items already in that line.`,
  };
}

/** For a master CV that isn't LaTeX: rebuild it in the template's structure. */
export function tailorCvFromTextPrompt(input: { profile: Profile; knowledge: Knowledge; job: JobDetail; insights: JobInsights; compact: boolean; feedback: string[] }) {
  const { profile, knowledge, job, insights, compact, feedback } = input;
  return {
    system: `You tailor a student's CV for one internship without changing any facts. The result is typeset with a fixed LaTeX résumé template, so you return its content as structured fields.\n\n${CV_PRINCIPLES}\n\n${GROUNDING_RULES}`,
    prompt: `${profileBlock(profile)}

<master_cv>
${compact ? truncate(knowledge.master?.content ?? "", 12_000) : (knowledge.master?.content ?? "")}
</master_cv>

${knowledgeBlock(knowledge, compact)}

${jobBlock(job, true)}

${analysisBlock(insights)}${feedbackBlock(feedback)}

Produce a tailored CV for this role in the template's structure.

- name and contacts: exactly as in the master CV (phone, email, website, LinkedIn, GitHub). Use the link as url, or an empty string when there isn't one.
- sections, in this order when the master CV has them: Education, Technical Skills, Certifications & Awards, Experiences, Leadership & Activities, Projects, Research Papers. Don't add sections the master CV doesn't have, such as a summary or objective.
  - Education, Experiences, Leadership & Activities use kind "entries": title is the school or organization; subtitle is the degree or role. For Education, title_right is the dates and subtitle_right the location; for the others, title_right is the location and subtitle_right the dates.
  - Certifications & Awards, Projects, Research Papers use kind "items": heading is the name in **bold**, then " | " and details such as technologies or issuer; date is the date.
  - Technical Skills uses kind "skills" with skill_lines, each a label and its items.
  - Leave the arrays a section doesn't use empty.
- Copy organizations, roles, degrees, dates and locations exactly. Follow the CV strategy: choose and order entries and bullets by the strength of their evidence for this role; keep all education.
- Put **double asterisks** around key technologies and outcomes.

changes: each meaningful change, with the section, what changed, and which requirement it serves.`,
  };
}

// ---------- Cover letter ----------

interface LetterInput {
  profile: Profile;
  knowledge: Knowledge;
  job: JobDetail;
  insights: JobInsights;
  cvText: string;
  angle: string;
  compact: boolean;
  feedback: string[];
}

function letterContext({ profile, knowledge, job, insights, cvText, angle, compact, feedback }: LetterInput): string {
  return `${profileBlock(profile)}

${knowledgeBlock(knowledge, compact)}

${jobBlock(job, compact)}

${factsBlock(insights.companyFacts)}

${analysisBlock(insights)}

<tailored_cv>
The CV this letter accompanies. Stay consistent with it without repeating its bullets.
${truncate(cvText, compact ? 5_000 : 12_000)}
</tailored_cv>${
    angle ? `\n\n<candidate_angle>\nThe candidate asked the letter to reflect this, in their own words. It counts as evidence with the id "angle":\n${angle}\n</candidate_angle>` : ""
  }${feedbackBlock(feedback)}`;
}

/** Cover letters are planned first, so the narrative is explicit and reviewable, then written from the plan. */
export function coverLetterPlanPrompt(input: LetterInput) {
  return {
    system: `You plan internship cover letters with a student: short, specific letters that give a hiring manager the context a CV can't.\n\n${LETTER_PRINCIPLES}\n\n${GROUNDING_RULES}`,
    prompt: `${letterContext(input)}

Plan the letter. Don't write it yet.
- company_need: what this team needs from the role, from the posting and research.
- why_role: why this specific role fits where the candidate is heading, grounded in their experience.
- why_company: what makes the application specific to this company or product, using only the posting and research.
- company_fact_ids: research fact ids used, and "posting" when using facts from the job posting.
- narrative: two or three links in the chain. need: the team's need; experience: the candidate's real experience that answers it, specifically; why_it_matters: why it carries over to this work; requirement_ids; evidence_ids.
- contribution: what the candidate can realistically contribute as an intern.
- motivation: why this opportunity matters to the candidate, from their notes or angle, or "placeholder" when neither says.`,
  };
}

export function coverLetterWritePrompt(input: LetterInput & { plan: LetterPlan }) {
  const { profile, knowledge, plan } = input;
  return {
    system: `You write internship cover letters with a student from an agreed plan: short, specific letters that give a hiring manager the context a CV can't.\n\n${LETTER_PRINCIPLES}\n\n${GROUNDING_RULES}`,
    prompt: `${letterContext(input)}

<letter_plan>
${JSON.stringify(plan, null, 2)}
</letter_plan>

Write the letter from the plan.

letter_markdown: the complete letter, 250–350 words in three or four paragraphs. Begin with "Dear Hiring Team," unless the posting names a person, and end with "Sincerely," and ${candidateName(profile, knowledge) || "the candidate's name"}. Follow the plan's narrative, name the company, and don't restate the CV's bullets. No address or date block. If the plan's motivation is "placeholder", write a bracketed placeholder for the candidate to fill in instead of inventing one.

claims: every factual statement the letter makes about the candidate or the company, with the evidence_ids and company_fact_ids that support it.`,
  };
}

// ---------- Quality review ----------

const CV_CRITERIA_TEXT: Record<(typeof CV_CRITERIA)[number], string> = {
  relevance: "Scanning for a few seconds, would a recruiter see why this candidate fits this role?",
  evidence: "Are the top hiring signals backed by the strongest evidence in the knowledge base?",
  credibility: "Do technical claims read as real, specific engineering work?",
  clarity: "Is each bullet easy to parse, with its point first?",
  impact: "Do bullets show outcomes where the evidence has them, without artificial metrics?",
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
  authenticity: "Does it sound like this candidate, without manufactured feelings or familiarity?",
  conciseness: "About 250–350 words, with nothing that could be cut without loss?",
  natural_language: "Free of generic AI phrasing and filler?",
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
}) {
  const { kind, content, knowledge, job, insights, checks, cvText, compact } = input;
  const letter = kind === "cover_letter";
  const criteria = letter ? LETTER_CRITERIA_TEXT : CV_CRITERIA_TEXT;
  return {
    system:
      "You are the final reviewer for an internship application: a senior engineer who screens applications, working with a recruiter. You decide whether a document is ready to send. Judge against the evidence, quote the exact text you're judging, and hold a high bar: generic, keyword-stuffed or unsupported writing isn't ready.",
    prompt: `${knowledgeBlock(knowledge, compact)}

${jobBlock(job, true)}

${analysisBlock(insights)}${letter ? `\n\n${factsBlock(insights.companyFacts)}\n\n<tailored_cv>\n${truncate(cvText ?? "", 8_000)}\n</tailored_cv>` : ""}

<${letter ? "cover_letter" : "cv"}>
${content}
</${letter ? "cover_letter" : "cv"}>

<automated_checks>
${checks.length ? checks.map((c) => `- [${c.severity}] ${c.message}${c.quote ? ` (“${c.quote}”)` : ""}`).join("\n") : "None."}
</automated_checks>

Score the ${letter ? "letter" : "CV"} from 1 to 5 on each criterion (5: would impress a hiring manager; 3: acceptable; 2 or lower: must be fixed before sending):
${Object.entries(criteria)
  .map(([key, text]) => `- ${key}: ${text}`)
  .join("\n")}

scores: one per criterion, each with a one-sentence note.
issues: specific problems, each with the exact quote, the problem and a concrete fix. blocking: unsupported or inflated claims, invented familiarity, generic or keyword-stuffed writing, anything that would hurt the application. warning: worthwhile improvements. Don't repeat the automated checks.
verdict: "ready" only if nothing blocking remains and no criterion scores 2 or lower; otherwise "revise".
summary: two sentences on whether it's ready and the most important fix.`,
  };
}

// ---------- Application answers ----------

export const DEFAULT_QUESTIONS = (company: string) => [
  "Why are you interested in this role?",
  `Why do you want to work at ${company}?`,
  "Tell us about a technical project you're proud of.",
  "Describe a challenge you faced on a project and how you handled it.",
];

export function answersPrompt(input: { profile: Profile; knowledge: Knowledge; job: JobDetail; insights: JobInsights; questions: string[]; compact: boolean }) {
  const { profile, knowledge, job, insights, questions, compact } = input;
  return {
    system: `You help a student prepare application answers for one internship: specific, first-person and grounded in real experience.\n\n${GROUNDING_RULES}`,
    prompt: `${profileBlock(profile)}

${knowledgeBlock(knowledge, compact)}

${jobBlock(job, compact)}

${factsBlock(insights.companyFacts)}

${analysisBlock(insights)}

<questions>
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
</questions>

Prepare:
- introduction: a 2–3 sentence professional introduction (about 50 words) for recruiter messages or "Tell us about yourself", built on the strongest evidence for this role.
- answers: one per question, in order, 80–150 words unless the question implies a short answer. Build each on the evidence that best answers what the question is really asking. When a question needs something the knowledge base doesn't contain (start date, salary, availability, personal motivation), write a bracketed placeholder such as [Add your available start date] instead of guessing. In based_on, list the evidence ids used.
- project_explanations: the two projects or experiences with the strongest evidence for this role, about 80 words each: what it is, what the candidate did, the technical decisions and technologies, and why it matters for this role.`,
  };
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
