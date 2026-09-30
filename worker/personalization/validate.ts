// Deterministic guards for personalization. The model proposes; these checks decide what may be presented as
// the candidate's experience, and flag what a reader would find generic, stuffed or unsupported.

import type Anthropic from "@anthropic-ai/sdk";
import { plain } from "../../shared/cv";
import {
  EVIDENCED_STRENGTHS,
  findGenericPhrases,
  type BulletChange,
  type CompanyFact,
  type EvidenceItem,
  type EvidenceStrength,
  type JobRequirement,
  type QualityIssue,
  type RequirementMatch,
} from "../../shared/personalization";
import { extractSkills } from "../../shared/skills";
import { unsupportedFigures, verifyGenerated } from "../matching/verify";

export function listText(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ---------- Requirement → evidence map ----------

export interface ProposedMatch {
  requirement_id: string;
  strength: EvidenceStrength;
  evidence_ids: string[];
  rationale: string;
  cv_action: string;
}

/**
 * One match per requirement, citing only evidence that exists. A strength that needs evidence but cites none
 * becomes a gap, and a strong or relevant match for a named technology the evidence never mentions becomes
 * transferable: related experience is not the same as having used the tool.
 */
export function validateMatches(requirements: JobRequirement[], proposed: ProposedMatch[], byId: Map<string, EvidenceItem>): RequirementMatch[] {
  return requirements.map((req): RequirementMatch => {
    const p = proposed.find((m) => m.requirement_id === req.id);
    if (!p) return { requirementId: req.id, strength: "unknown", evidenceIds: [], rationale: "This requirement wasn't assessed.", cvAction: "" };

    const evidenceIds = [...new Set(p.evidence_ids)].filter((id) => byId.has(id));
    const base = { requirementId: req.id, evidenceIds, rationale: p.rationale, cvAction: p.cv_action };
    if (EVIDENCED_STRENGTHS.includes(p.strength) && !evidenceIds.length) {
      const why = p.evidence_ids.length ? "the evidence it cited doesn't exist" : "no evidence was cited";
      return { ...base, strength: "gap", correction: `Classified as ${p.strength}, but ${why}, so it's treated as a gap.` };
    }
    if (p.strength === "strong" || p.strength === "relevant") {
      const named = extractSkills(req.text);
      const shown = new Set(extractSkills(evidenceIds.map((id) => byId.get(id)!.text).join("\n"), { includeImplied: true }));
      if (named.length && !named.some((s) => shown.has(s))) {
        return { ...base, strength: "transferable", correction: `The cited evidence never mentions ${listText(named)}, so this is at most transferable.` };
      }
    }
    return { ...base, strength: p.strength };
  });
}

// ---------- CV bullets ----------

/** Scope a bullet claims → words the evidence must contain for the claim to stand. */
const SCOPE_CLAIMS: [RegExp, RegExp][] = [
  [/\b(?:led|leading)\b/i, /\b(?:led|lead\w*|director|head|captain|chair\w*|president|coordinator)\b/i],
  [/\bspearhead\w*/i, /\b(?:spearhead\w*|led|lead\w*|director|head)\b/i],
  [/\bmanag(?:ed|es|ing)\b/i, /\b(?:manag\w*|director|head|lead\w*)\b/i],
  [/\b(?:owned|owns|owning|ownership)\b/i, /\bown(?:ed|s|ing|ership)\b/i],
  [/\barchitect(?:ed|s|ing)\b/i, /\barchitect\w*/i],
  [/\b(?:mentor(?:ed|s|ing)?|coach(?:ed|es|ing)?)\b/i, /\b(?:mentor\w*|mentee\w*|coach\w*|teach\w*|taught|guid\w*|assistant)\b/i],
  [/\bdirect(?:ed|s|ing)\b/i, /\bdirect(?:ed|s|ing|or)\b/i],
  [/\bfound(?:ed|er|ing)\b/i, /\bfound(?:ed|er|ing)\b/i],
  [/\b(?:supervis\w*|oversaw|oversee\w*)\b/i, /\b(?:supervis\w*|oversaw|oversee\w*|manag\w*|director|head|lead\w*)\b/i],
];

/** Clauses that tell the reader what a bullet proves instead of letting the work show it. */
const SELF_ASSESSMENT = /(?:,\s*|\bby\s+|\bthus\s+|\bthereby\s+)(?:demonstrat|showcas|highlight|reflect|underscor|illustrat|prov|exhibit|display)\w*\b|\b(?:ability|abilities|capacity|eagerness|willingness) to (?:learn|adapt|apply|work|grow)\b|\bexpertise in\b|\bstrong (?:problem[- ]solving|analytical|communication) skills\b/i;

/**
 * The concrete details of a bullet: technologies, numbers, and acronyms or proper names inside the sentence
 * (BFS, DOM, MTTR, ConcordeOS). A rewrite that loses most of them has become vaguer, whatever it gained.
 */
export function specifics(text: string): Set<string> {
  const lower = text.toLowerCase();
  const literal = (t: string) => new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(lower);
  // Canonical skill names only count when written as such ("CI pipelines" implies CI/CD but doesn't say it).
  const out = new Set<string>(extractSkills(text).map((x) => x.toLowerCase()).filter(literal));
  for (const m of text.matchAll(/\b\d[\d.,+%]*\b/g)) out.add(m[0].toLowerCase());
  const words = text.replace(/[()*,.;:]/g, " ").split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    if (i === 0) return; // sentence-initial capital
    if (/^[A-Z][A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*$/.test(w) || /^[A-Z]{2,}s?$/.test(w)) out.add(w.toLowerCase());
  });
  return out;
}

/** Share of the original's specifics that survive in the rewrite (1 when the original has none). */
export function detailRetention(original: string, rewrite: string): { kept: number; lost: string[] } {
  const before = specifics(original);
  if (!before.size) return { kept: 1, lost: [] };
  const after = rewrite.toLowerCase();
  const lost = [...before].filter((t) => !new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(after));
  return { kept: 1 - lost.length / before.size, lost };
}

export interface BulletCheck {
  /** Unsupported claims: the rewrite is rejected and the original bullet is kept. */
  blocking: string[];
  warnings: string[];
}

/** Checks a rewritten bullet (plain text) against the evidence of its own CV entry. */
export function checkBullet(bullet: string, support: EvidenceItem[], originalLength: number): BulletCheck {
  const text = support.map((e) => e.text).join("\n");
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (!bullet.trim()) blocking.push("The rewrite was empty.");

  const known = new Set(extractSkills(text, { includeImplied: true }));
  const added = extractSkills(bullet).filter((s) => !known.has(s));
  if (added.length) blocking.push(`Adds ${listText(added)}, which this entry's evidence doesn't mention.`);

  const figures = unsupportedFigures(bullet, text);
  if (figures.length) blocking.push(`Adds ${listText(figures.map((f) => `“${f}”`))}, which this entry's evidence doesn't contain.`);

  for (const [claim, required] of SCOPE_CLAIMS) {
    const m = bullet.match(claim);
    if (m && !required.test(text)) blocking.push(`Says “${m[0]}”, but this entry's evidence doesn't show that scope.`);
  }

  const selfAssessment = bullet.match(SELF_ASSESSMENT);
  if (selfAssessment) blocking.push(`Tells the reader what it proves (“${selfAssessment[0].replace(/^[,\s]+/, "")}”) instead of showing the work.`);

  const generic = findGenericPhrases(bullet);
  if (generic.length) warnings.push(`Uses filler: ${listText(generic)}.`);
  if (originalLength && bullet.length > Math.max(260, originalLength * 1.6)) warnings.push("Much longer than the original bullet.");
  return { blocking, warnings };
}

export interface ProposedBullet {
  text: string;
  from: number[];
  evidence_ids: string[];
  requirement_ids: string[];
  reason: string;
}

/**
 * Applies a model's bullets for one CV entry. A rewrite may only use this entry's own evidence (its heading, the
 * master bullets it rewrites, notes attached to the entry). Rewrites that add technologies, figures or scope the
 * evidence doesn't show are rejected and the original bullet is kept instead.
 */
export function applyBulletProposals(input: {
  masterBullets: string[];
  group: string;
  support: EvidenceItem[];
  proposals: ProposedBullet[];
  requirementIds: Set<string>;
  section: string;
  label: string;
  /** Master bullets (1-based) the model chose to leave out, with its reason. */
  drops?: { bullet: number; reason: string }[];
}): { bullets: string[]; changes: BulletChange[] } {
  const { masterBullets, group, support, section, label } = input;
  const supportIds = new Set(support.map((e) => e.id));
  const normalize = (s: string) => plain(s).toLowerCase().replace(/\s+/g, " ").trim();
  const bullets: string[] = [];
  const changes: BulletChange[] = [];
  const used = new Set<number>();

  for (const p of input.proposals) {
    if (bullets.length >= masterBullets.length) break;
    const from = [...new Set(p.from)].filter((n) => Number.isInteger(n) && n >= 1 && n <= masterBullets.length);
    const originals = from.map((n) => masterBullets[n - 1]!);
    const cited = [...new Set(p.evidence_ids)].filter((id) => supportIds.has(id));
    const foreign = p.evidence_ids.filter((id) => !supportIds.has(id));
    const basis = [...new Set([...from.map((n) => `${group}.b${n}`), ...cited])];
    const facts = support.filter((e) => e.kind === "heading" || basis.includes(e.id));
    const text = p.text.trim();

    const result = checkBullet(plain(text), facts, Math.max(0, ...originals.map((o) => plain(o).length)));
    // Merging bullets naturally drops some detail, so the bar is lower for merges.
    const retention = detailRetention(originals.map((o) => plain(o)).join(" "), plain(text));
    if (originals.length && retention.kept < (originals.length > 1 ? 0.4 : 0.6)) {
      result.blocking.push(`Drops concrete detail from your bullet (${listText(retention.lost.slice(0, 5))}), which makes it vaguer.`);
    }
    if (foreign.length) result.blocking.unshift(`Cites evidence from outside this entry (${foreign.join(", ")}).`);
    if (!basis.some((id) => !id.endsWith(".h"))) result.blocking.push("Doesn't trace to any of this entry's facts.");

    const change = {
      section,
      entryLabel: label,
      original: originals.map((o) => plain(o)),
      reason: p.reason.trim(),
      requirementIds: [...new Set(p.requirement_ids)].filter((id) => input.requirementIds.has(id)),
      issues: [...result.blocking, ...result.warnings],
    };

    if (result.blocking.length) {
      const fallback = from.find((n) => !used.has(n));
      const kept = fallback !== undefined && !bullets.some((b) => normalize(b) === normalize(masterBullets[fallback - 1]!));
      if (kept) {
        used.add(fallback);
        bullets.push(masterBullets[fallback - 1]!);
      }
      changes.push({
        ...change,
        tailored: kept ? plain(masterBullets[fallback - 1]!) : "",
        proposed: plain(text),
        status: "reverted",
        evidenceIds: kept ? [`${group}.b${fallback}`] : [],
      });
      continue;
    }
    if (bullets.some((b) => normalize(b) === normalize(text))) continue;
    from.forEach((n) => used.add(n));
    bullets.push(text);
    const status = originals.some((o) => normalize(o) === normalize(text)) ? "kept" : "rewritten";
    changes.push({ ...change, tailored: plain(text), status, evidenceIds: basis });
  }

  // Bullets the model didn't use stay, after the tailored ones, unless it dropped them with a reason: strong
  // evidence is never lost silently.
  masterBullets.forEach((b, i) => {
    const n = i + 1;
    if (used.has(n)) return;
    const drop = input.drops?.find((d) => d.bullet === n);
    const duplicate = bullets.some((x) => normalize(x) === normalize(b));
    const base = { section, entryLabel: label, original: [plain(b)], requirementIds: [], evidenceIds: [`${group}.b${n}`], issues: [] };
    if (!drop && !duplicate && bullets.length < masterBullets.length) {
      bullets.push(b);
      changes.push({ ...base, tailored: plain(b), status: "kept", reason: "Kept as in your master CV." });
    } else {
      const reason = drop?.reason.trim() || (duplicate ? "Already covered by a tailored bullet." : "No room after the tailored bullets.");
      changes.push({ ...base, tailored: "", status: "removed", reason });
    }
  });
  return { bullets, changes };
}

// ---------- Whole documents ----------

const check = (severity: QualityIssue["severity"], message: string, quote = ""): QualityIssue => ({ severity, message, quote, source: "check" });

/** Whole-word occurrences of a term, ignoring URLs ("git" doesn't count inside "github.com"). */
function countTerm(text: string, term: string): number {
  const pattern = new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "g");
  return (text.toLowerCase().replace(/https?:\/\/[^\s)]+/g, " ").match(pattern) ?? []).length;
}

/**
 * Checks a whole tailored CV. The master CV's own text counts as evidence (its header, links and figures), and
 * a posting term only reads as stuffing when it's frequent and tailoring added at least two more uses.
 */
export function cvIssues(cvText: string, sources: { evidence: string; masterText: string; posting: string; employerTerms: string[] }): QualityIssue[] {
  const issues = verifyGenerated(cvText, { evidence: `${sources.evidence}\n${sources.masterText}`, context: sources.posting }).map((m) => check("blocking", m));
  for (const term of new Set(sources.employerTerms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2))) {
    const count = countTerm(cvText, term);
    const before = countTerm(sources.masterText, term);
    if (count >= 4 && count - before >= 2) {
      issues.push(check("warning", `“${term}” appears ${count} times (${before} in your master CV). Repeating the posting's wording reads as keyword stuffing.`, term));
    }
  }
  const bullets = cvText
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
  const seen = new Set<string>();
  for (const b of bullets) {
    if (seen.has(b.toLowerCase())) issues.push(check("warning", "The same bullet appears twice.", b));
    seen.add(b.toLowerCase());
  }
  const generic = findGenericPhrases(bullets.join("\n"));
  if (generic.length) issues.push(check("warning", `Uses filler phrases: ${listText(generic)}.`, generic[0]));
  return issues;
}

function shingles(text: string, size = 6): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

/** Share of the letter's six-word runs that also appear in the CV. */
export function overlapWithCv(letter: string, cvText: string): number {
  const a = shingles(letter);
  if (!a.size) return 0;
  const b = shingles(cvText);
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / a.size;
}

export function letterIssues(letter: string, s: { company: string; evidence: string; posting: string; cvText: string }): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const words = letter.split(/\s+/).filter(Boolean).length;
  if (words > 450) issues.push(check("blocking", `${words} words. Keep it under about 400 so it gets read in full.`));
  else if (words > 380) issues.push(check("warning", `${words} words. A little long; aim for 250–350.`));
  else if (words < 170) issues.push(check("warning", `Only ${words} words. It may be too thin to make the case.`));

  const generic = findGenericPhrases(letter);
  if (generic.length >= 3) issues.push(check("blocking", `Relies on generic phrases: ${listText(generic)}.`, generic[0]));
  else for (const g of generic) issues.push(check("warning", `“${g}” is a phrase hiring managers skip over.`, g));

  const company = s.company.replace(/\s*\(.*\)\s*$/, "").trim();
  if (company && !letter.toLowerCase().includes(company.toLowerCase())) issues.push(check("blocking", `Doesn't mention ${company} by name.`));

  // Naming a technology from the posting or research can be about the company; the reviewer judges how it's used.
  issues.push(...verifyGenerated(letter, { evidence: s.evidence, context: s.posting }).map((m) => check(m.includes("from the job posting") ? "warning" : "blocking", m)));

  for (const m of letter.matchAll(/\[([^\]]{3,})\](?!\()/g)) issues.push(check("warning", `Fill in the placeholder before sending: ${m[0]}`, m[0]));

  if (s.cvText && overlapWithCv(letter, s.cvText) > 0.3) {
    issues.push(check("warning", "Much of it repeats your CV word for word. A cover letter should add context the CV can't."));
  }
  return issues;
}

// ---------- Company research ----------

function cleanFact(text: string): string {
  return text
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turns a web-search response into company facts. Only paragraphs that carry a citation to a public source are
 * kept, so the application can't claim familiarity the research didn't verify.
 */
export function parseResearchFacts(content: Anthropic.Beta.BetaContentBlock[], max = 10): CompanyFact[] {
  const facts: CompanyFact[] = [];
  let text = "";
  let sources = new Map<string, string>();
  const flush = () => {
    const fact = cleanFact(text);
    if (fact.length >= 20 && sources.size && facts.length < max) {
      facts.push({ id: `F${facts.length + 1}`, text: fact.slice(0, 400), sources: [...sources].map(([url, title]) => ({ url, title })) });
    }
    text = "";
    sources = new Map();
  };

  for (const block of content) {
    if (block.type !== "text") continue;
    block.text.split(/\n+/).forEach((part, i) => {
      if (i > 0) flush();
      text += part;
      if (!part.trim()) return;
      for (const c of block.citations ?? []) {
        if ("url" in c && typeof c.url === "string" && /^https?:\/\//.test(c.url)) sources.set(c.url, ("title" in c && c.title) || c.url);
      }
    });
  }
  flush();
  return facts;
}
