// Prompts and output schemas for analysis and document generation.
// Every prompt is grounded in the candidate's own material; see GROUNDING_RULES.

import { z } from "zod";
import { cvForPrompt, type CvDoc } from "../../shared/cv";
import { ROLE_LABELS } from "../../shared/roles";
import type { JobDetail, MatchResult, Profile } from "../../shared/types";
import { truncate } from "../lib/text";

const ChangesSchema = z.array(z.object({ section: z.string(), change: z.string(), reason: z.string() }));

export const FitAnalysisSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  concerns: z.array(z.string()),
  key_qualifications: z.array(z.string()),
  talking_points: z.array(z.string()),
});

/** Choices applied to a LaTeX master CV (see applyTailoring in shared/cv.ts). */
export const CvTailoringSchema = z.object({
  entries: z.array(z.object({ id: z.string(), bullets: z.array(z.string()) })),
  skills: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
  changes: ChangesSchema,
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
  changes: ChangesSchema,
});

export const CoverLetterSchema = z.object({
  letter_markdown: z.string(),
  grounding: z.array(z.object({ claim: z.string(), source: z.string() })),
});

export const AnswersSchema = z.object({
  introduction: z.string(),
  answers: z.array(z.object({ question: z.string(), answer: z.string(), based_on: z.string() })),
  project_explanations: z.array(z.object({ project: z.string(), explanation: z.string() })),
});

const GROUNDING_RULES = `Ground rules. These override every other instruction:
- Use only facts stated in the candidate's master CV and profile. Never invent or embellish employers, dates, job titles, projects, metrics, technologies, coursework, awards, or responsibilities.
- If the job asks for something the candidate's material doesn't show, do not claim it.
- Never introduce numbers, percentages, or scale claims that aren't in the candidate's material.
- Never inflate scope: if the CV says "contributed to", do not write "led".
- Write plainly and specifically. No clichés or filler ("passionate", "I am excited to", "fast-paced", "leverage", "synergy", "proven track record", "team player").`;

function profileBlock(p: Profile): string {
  const lines = [
    p.fullName && `Name: ${p.fullName}`,
    p.headline && `Headline: ${p.headline}`,
    p.education && `Education: ${p.education}`,
    p.graduationDate && `Expected graduation: ${p.graduationDate}`,
    p.location && `Location: ${p.location}`,
    p.skills.length && `Skills: ${p.skills.join(", ")}`,
    p.targetRoles.length && `Target roles: ${p.targetRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}`,
    p.workAuthorization && `Work authorization: ${p.workAuthorization}`,
    p.links.length && `Links: ${p.links.map((l) => `${l.label} ${l.url}`).join("; ")}`,
  ].filter(Boolean);
  return lines.join("\n");
}

function candidateBlock(profile: Profile, masterCv: string, compact: boolean): string {
  return `<candidate_profile>\n${profileBlock(profile)}\n</candidate_profile>\n\n<master_cv>\n${compact ? truncate(masterCv, 12_000) : masterCv}\n</master_cv>`;
}

function jobBlock(job: JobDetail, compact: boolean): string {
  const header = [`Company: ${job.company}`, `Title: ${job.title}`, job.location && `Location: ${job.location}`, job.duration && `Duration: ${job.duration}`]
    .filter(Boolean)
    .join("\n");
  return `<job_posting>\n${header}\n\n${compact ? truncate(job.description, 9_000) : job.description}\n</job_posting>`;
}

export function fitAnalysisPrompt(profile: Profile, masterCv: string, job: JobDetail, match: MatchResult | null, compact: boolean) {
  return {
    system: `You evaluate how well a student's background fits a specific internship. Be candid and concrete; the student uses this to decide whether and how to apply.\n\n${GROUNDING_RULES}`,
    prompt: `${candidateBlock(profile, masterCv, compact)}

${jobBlock(job, compact)}

<keyword_match>
Matched skills: ${match?.matchedSkills.join(", ") || "none"}
Missing required skills: ${match?.missingRequired.join(", ") || "none"}
Flags: ${match?.concerns.join("; ") || "none"}
</keyword_match>

Evaluate the fit. Fields:
- summary: 2–3 direct sentences on overall fit and whether it's worth applying.
- strengths: specific evidence from the CV mapped to what the job needs (name the CV item).
- gaps: requirements the CV doesn't demonstrate.
- concerns: eligibility, location, timing, seniority or other risks. Empty if none.
- key_qualifications: the 3–6 most important requirements in the posting.
- talking_points: what to emphasize in the application, each tied to a real CV item.`,
  };
}

const TEMPLATE_NOTE =
  "The CV is typeset with the candidate's fixed LaTeX résumé template. You only choose and reword content: layout, section titles, organizations, roles, dates, locations, headings and contact details are filled in from the master CV automatically.";

/** Tailoring for a LaTeX master CV: choose entries, reword bullets, order skills. */
export function tailorCvPrompt(profile: Profile, master: CvDoc, job: JobDetail, compact: boolean) {
  return {
    system: `You tailor a student's CV for one specific internship without changing any facts. ${TEMPLATE_NOTE}\n\n${GROUNDING_RULES}`,
    prompt: `<candidate_profile>
${profileBlock(profile)}
</candidate_profile>

<master_cv>
${JSON.stringify(cvForPrompt(master), null, compact ? undefined : 2)}
</master_cv>

${jobBlock(job, compact)}

Tailor the CV for this job.

entries: every entry to include, using the exact ids from master_cv. Within each section, list entries in the order they should appear, most relevant to this job first.
- Always include every entry of a section marked always_included.
- Keep entries that show skills or experience this job values, and leave out entries that add little for this role. A section with no entries listed is removed, so list at least one entry for every section worth keeping. Keep the CV substantial: most experiences and the most relevant projects.
- bullets: rewrite that entry's master bullets so what matters most for this job comes first, using the posting's terminology only where it accurately describes the work. Keep the same facts and a similar length. Use at most as many bullets as the master entry has, or an empty list to keep the master bullets unchanged.
- Put **double asterisks** around key technologies, methods and outcomes, the way the master bullets do.
- Never move a fact from one entry to another, and never add tools, numbers, scope or results that the entry's own master bullets don't state.

skills: for each skill line, its label and the items to show, most relevant to this job first. Only use items that already appear in that line.

changes: each meaningful change, with the section, what changed, and why it helps for this job.`,
  };
}

/** Tailoring for a master CV that isn't LaTeX: rebuild it in the template's structure. */
export function tailorCvFromTextPrompt(profile: Profile, masterCv: string, job: JobDetail, compact: boolean) {
  return {
    system: `You tailor a student's CV for one specific internship without changing any facts. The result is typeset with a fixed LaTeX résumé template, so you return its content as structured fields.\n\n${GROUNDING_RULES}`,
    prompt: `${candidateBlock(profile, masterCv, compact)}

${jobBlock(job, compact)}

Produce a tailored CV for this job in the template's structure.

- name and contacts: exactly as in the master CV (phone, email, website, LinkedIn, GitHub). Use the link as url, or an empty string when there isn't one.
- sections, in this order when the master CV has them: Education, Technical Skills, Certifications & Awards, Experiences, Leadership & Activities, Projects, Research Papers. Don't add sections the master CV doesn't have, such as a summary or objective.
  - Education, Experiences, Leadership & Activities use kind "entries": title is the school or organization; subtitle is the degree or role. For Education, title_right is the dates and subtitle_right the location; for the others, title_right is the location and subtitle_right the dates.
  - Certifications & Awards, Projects, Research Papers use kind "items": heading is the name in **bold**, then " | " and details such as technologies or issuer; date is the date.
  - Technical Skills uses kind "skills" with skill_lines, each a label and its items.
  - Leave the arrays a section doesn't use empty.
- Copy organizations, roles, degrees, dates and locations exactly. Choose the entries most relevant to this job and order them by relevance within each section; keep all education.
- Rewrite bullets so what matters most for this job comes first, using the posting's terminology only where it accurately describes the work. Put **double asterisks** around key technologies and outcomes.

changes: each meaningful change, with the section, what changed, and why it helps for this job.`,
  };
}

export function coverLetterPrompt(profile: Profile, masterCv: string, job: JobDetail, compact: boolean) {
  return {
    system: `You write concise, specific cover letters for internship applications.\n\n${GROUNDING_RULES}`,
    prompt: `${candidateBlock(profile, masterCv, compact)}

${jobBlock(job, compact)}

Write a cover letter of 250–350 words in Markdown.
- Open with the specific role and why it fits the candidate's direction. Only use facts about the company that appear in the job posting.
- Give two or three concrete pieces of evidence from the CV, each mapped to a key requirement of the posting.
- If an important requirement isn't covered by the CV, don't mention it.
- Close briefly. Address it to "Hiring Team" unless the posting names a person. Sign with the candidate's name.

In grounding, list each factual claim the letter makes about the candidate and the CV item that supports it.`,
  };
}

export const DEFAULT_QUESTIONS = (company: string) => [
  "Why are you interested in this role?",
  `Why do you want to work at ${company}?`,
  "Tell us about a technical project you're proud of.",
  "Describe a challenge you faced on a project and how you handled it.",
];

export function answersPrompt(profile: Profile, masterCv: string, job: JobDetail, questions: string[], compact: boolean) {
  return {
    system: `You help a student prepare application materials for a specific internship.\n\n${GROUNDING_RULES}`,
    prompt: `${candidateBlock(profile, masterCv, compact)}

${jobBlock(job, compact)}

<questions>
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
</questions>

Prepare:
- introduction: a 2–3 sentence professional introduction (about 50 words) for recruiter messages or "Tell us about yourself".
- answers: one answer per question, in order, 80–150 words unless the question implies a short answer. If a question needs information the material doesn't contain (start date, salary, availability), answer with a bracketed placeholder such as [Add your available start date] instead of guessing. In based_on, name the CV items used.
- project_explanations: the two projects or experiences from the CV most relevant to this job, about 80 words each: what it is, what the candidate did, the technologies used, and why it's relevant here.`,
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
