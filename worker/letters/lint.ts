// Mechanical rules for cover letters. A letter that breaks one is rejected and regenerated with the violations as
// feedback (worker/documents/generate.ts). Rules are configured in config/letter.json, banned phrases in
// config/banned_phrases.txt. Pure functions, unit-tested in test/letters.test.ts.

import bannedText from "../../config/banned_phrases.txt?raw";
import letterConfig from "../../config/letter.json";
import type { EligibilityStatus } from "../../shared/eligibility";

export interface LetterRules {
  minWords: number;
  maxWords: number;
  maxLintAttempts: number;
  maxRecruiterRevisions: number;
  banEmDash: boolean;
  banSemicolon: boolean;
  banColonInProse: boolean;
  banExclamation: boolean;
}

export const LETTER_RULES: LetterRules = letterConfig;

export interface BannedEntry {
  /** The line as written, for messages. */
  label: string;
  pattern: RegExp;
}

/** Parses the banned-phrase file: one phrase per line, "re:" for a regular expression, "#" for comments. */
export function parseBanned(text: string): BannedEntry[] {
  const out: BannedEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("re:")) {
      try {
        out.push({ label: line.slice(3).trim(), pattern: new RegExp(line.slice(3).trim(), "i") });
      } catch {
        console.warn(JSON.stringify({ message: "letters.bad_banned_regex", line }));
      }
      continue;
    }
    const escaped = line.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]");
    out.push({ label: line, pattern: new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "i") });
  }
  return out;
}

export const BANNED = parseBanned(bannedText);

/** Plain phrases from the banned list, for telling the model what not to write. */
export function bannedForPrompt(entries: BannedEntry[] = BANNED): string {
  return entries
    .filter((e) => !/[\\[\]()?*+|]/.test(e.label))
    .map((e) => `"${e.label}"`)
    .join(", ");
}

export interface Violation {
  rule: string;
  message: string;
  quote: string;
}

export interface LintContext {
  company: string;
  status: EligibilityStatus;
  /** The candidate's confirmed Singapore work authorization, or empty. */
  sgWorkAuthorization: string;
  /** Words that identify the candidate's real experience: organizations, projects, technologies they used. */
  candidateTerms: string[];
  /** Words that identify this company, team or product: its name, products, technologies from the posting. */
  companyTerms: string[];
  rules?: LetterRules;
  banned?: BannedEntry[];
}

export interface LintResult {
  ok: boolean;
  words: number;
  violations: Violation[];
  /** Worth a look but not grounds for rejection (e.g. a placeholder to fill in). */
  warnings: Violation[];
}

const GREETING = /^(dear|hi|hello)\b.*,\s*$/i;
const SIGNOFF = /^(best|best regards|regards|kind regards|sincerely|thanks|thank you|cheers|warm regards),?\s*$/i;

/** The letter's body paragraphs: greeting, sign-off and the name after it removed. */
export function bodyParagraphs(letter: string): string[] {
  const paragraphs = letter
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of paragraphs) {
    const lines = p.split("\n").map((l) => l.trim());
    const kept: string[] = [];
    let signedOff = false;
    for (const l of lines) {
      if (GREETING.test(l)) continue;
      if (SIGNOFF.test(l)) {
        signedOff = true;
        continue;
      }
      if (signedOff) continue; // the name after the sign-off
      kept.push(l);
    }
    if (kept.join(" ").trim()) out.push(kept.join(" ").trim());
    if (signedOff) break;
  }
  return out;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function snippet(text: string, index: number, radius = 40): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius)).replace(/\s+/g, " ").trim();
}

const STOP = new Set(
  "the a an and or but of to in on for with at by from as is are was were be been this that these those it its i my me we our you your they their he she his her them us not no so if then than into over under about after before during while can could would should will may might must also just very more most such each any all some other only own same too how what which who whom why when where there here team role work working intern internship company experience".split(
    " ",
  ),
);

/** Distinctive lowercase tokens of a phrase, for matching paragraphs against candidate and company terms. */
export function termTokens(terms: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of terms) {
    const whole = t.toLowerCase().trim();
    if (whole.length >= 2 && !STOP.has(whole)) out.add(whole);
    for (const w of whole.split(/[^a-z0-9.+#-]+/)) if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

function hasTerm(paragraph: string, tokens: Set<string>): boolean {
  const lower = paragraph.toLowerCase();
  for (const t of tokens) {
    const pattern = new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`);
    if (pattern.test(lower)) return true;
  }
  return false;
}

const AUTH_CLAIM = /\b(employment pass|work pass|training employment pass|TEP|work permit|work visa|visa|authori[sz]ed to work|eligible to work|right to work|work authori[sz]ation|sponsorship)\b/i;
const LOCATION_SENTENCE = /\b(indonesia|bandung|jakarta|time ?zones?|utc|gmt|wib|async(?:hronous(?:ly)?)?|relocat\w*|on-?site|hybrid|in person|singapore office)\b/i;
const OPENER = /^(?:i am|i'm|i am writing|i'm writing|my name is|as an? (?:passionate|motivated|dedicated|enthusiastic|aspiring)|i would like to|i wish to|please accept|allow me)\b/i;

export function lintLetter(letter: string, ctx: LintContext): LintResult {
  const rules = ctx.rules ?? LETTER_RULES;
  const banned = ctx.banned ?? BANNED;
  const violations: Violation[] = [];
  const warnings: Violation[] = [];
  const paragraphs = bodyParagraphs(letter);
  const body = paragraphs.join("\n\n");
  const words = countWords(body);

  if (words < rules.minWords) violations.push({ rule: "length", message: `${words} words; it must be at least ${rules.minWords}.`, quote: "" });
  if (words > rules.maxWords) violations.push({ rule: "length", message: `${words} words; it must be at most ${rules.maxWords}. Cut the least specific sentences.`, quote: "" });
  if (paragraphs.length < 3 || paragraphs.length > 4) warnings.push({ rule: "paragraphs", message: `${paragraphs.length} paragraphs; aim for three or four.`, quote: "" });

  const mark = (rule: string, re: RegExp, message: string) => {
    const m = re.exec(body);
    if (m) violations.push({ rule, message, quote: snippet(body, m.index) });
  };
  if (rules.banEmDash) mark("em_dash", /—|–|(?<=\w)\s-{1,2}\s(?=\w)|(?<=\w)--(?=\w)/, "Uses a dash as punctuation. Use a full stop or a comma.");
  if (rules.banSemicolon) mark("semicolon", /;/, "Uses a semicolon. Split the sentence or use a comma.");
  if (rules.banColonInProse) mark("colon", /(?<!https?|\d):(?!\/\/|\d)/, "Uses a colon in a sentence. Rephrase without it.");
  if (rules.banExclamation) mark("exclamation", /!/, "Uses an exclamation mark.");

  for (const entry of banned) {
    const m = entry.pattern.exec(body);
    if (m) violations.push({ rule: "banned_phrase", message: `Uses a banned phrase (“${entry.label}”).`, quote: snippet(body, m.index) });
  }

  // Forced groups of three: three single lowercase words in a list ("fast, reliable, and scalable").
  const triple = /\b([a-z]{3,}), ([a-z]{3,}),? and ([a-z]{3,})\b/.exec(body);
  if (triple) violations.push({ rule: "triplet", message: "Lists three things in a row. Keep one specific example, or two.", quote: triple[0] });

  const first = sentencesOf(paragraphs[0] ?? "")[0] ?? "";
  if (OPENER.test(first)) violations.push({ rule: "generic_opener", message: "Opens by announcing yourself or the application. Open with something specific.", quote: first.slice(0, 120) });

  const company = ctx.company.replace(/\s*\(.*\)\s*$/, "").trim();
  if (company && !body.toLowerCase().includes(company.toLowerCase())) violations.push({ rule: "company", message: `Doesn't mention ${company} by name.`, quote: "" });

  // Location stays one plain sentence, and never claims authorization that isn't confirmed.
  const locationSentences = sentencesOf(body).filter((s) => LOCATION_SENTENCE.test(s));
  if (locationSentences.length > 1) {
    violations.push({ rule: "location", message: "Location or work arrangements take more than one sentence. Keep it to one plain sentence.", quote: locationSentences[1]!.slice(0, 120) });
  }
  const auth = AUTH_CLAIM.exec(body);
  if (auth && !ctx.sgWorkAuthorization.trim()) {
    violations.push({ rule: "authorization", message: "Mentions work authorization, a pass or a visa, which isn't confirmed in your profile. Leave it out.", quote: snippet(body, auth.index) });
  }

  // Specificity: every paragraph needs a detail from the candidate's experience and one about this company or role.
  const candidate = termTokens(ctx.candidateTerms);
  const companyTokens = termTokens(ctx.companyTerms);
  paragraphs.forEach((p, i) => {
    const mine = hasTerm(p, candidate);
    const theirs = hasTerm(p, companyTokens);
    const last = i === paragraphs.length - 1 && countWords(p) <= 45;
    if (last ? !(mine || theirs) : !(mine && theirs)) {
      const missing = [!mine && "your experience", !theirs && "this team or product"].filter(Boolean).join(" or ");
      violations.push({ rule: "specificity", message: `Paragraph ${i + 1} has no concrete detail about ${missing}.`, quote: p.slice(0, 120) });
    }
  });

  for (const m of body.matchAll(/\[([^\]]{3,})\](?!\()/g)) warnings.push({ rule: "placeholder", message: `Fill in the placeholder before sending: ${m[0]}`, quote: m[0] });

  return { ok: violations.length === 0, words, violations, warnings };
}

/** Feedback for the next attempt, one line per violation. */
export function lintFeedback(result: LintResult): string {
  if (result.ok) return "";
  return `\n\n<rule_violations>\nA program rejected the previous draft for these reasons. The next draft must fix every one:\n${result.violations
    .map((v) => `- ${v.message}${v.quote ? ` (“${v.quote}”)` : ""}`)
    .join("\n")}\n</rule_violations>`;
}

/** The status-dependent instruction for the letter's one location sentence. */
export function locationGuidance(status: EligibilityStatus, opts: { location: string; sgWorkAuthorization: string; timezoneNote: string | null; asyncEvidence: boolean }): string {
  const where = opts.location || "Bandung, Indonesia";
  switch (status) {
    case "ELIGIBLE_REMOTE":
      return `Remote role. Only if the posting stresses remote work, time zones or async collaboration, one plain sentence that the candidate works from ${where} (UTC+7)${opts.timezoneNote ? ` and can cover the overlap the posting asks for (${opts.timezoneNote})` : ""}${opts.asyncEvidence ? ", and how they already work asynchronously, from the knowledge base" : ""}. Otherwise no location sentence.`;
    case "ELIGIBLE_SINGAPORE":
      return opts.sgWorkAuthorization.trim()
        ? `Singapore role. One plain sentence that the candidate can work on-site or hybrid in Singapore for the internship dates, and this confirmed authorization: ${opts.sgWorkAuthorization.trim()}.`
        : "Singapore role. At most one plain sentence that the candidate is available to work on-site or hybrid in Singapore for the internship. Say nothing about passes, visas, sponsorship or work authorization.";
    case "ELIGIBLE_INDONESIA":
      return `Role in Indonesia. At most one plain sentence, only if useful, that the candidate is based in ${where} and can work from the office the posting names. Otherwise no location sentence.`;
    default:
      return "No location sentence unless the posting asks about location, and never mention work authorization.";
  }
}
