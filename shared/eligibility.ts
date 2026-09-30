// Location and work-mode eligibility for a candidate in Bandung, Indonesia (UTC+7).
//
// Postings are classified before any tailoring: remote roles open to Indonesia, on-site or hybrid roles in
// Indonesia, and on-site or hybrid roles in Singapore (the one foreign exception) are eligible; everything else is
// excluded or, when the wording is ambiguous, left for the candidate to check. The model only extracts facts, each
// with a verbatim quote from the posting; decide() turns facts into a status, so the rules stay auditable.

export const ELIGIBILITY_STATUSES = ["ELIGIBLE_REMOTE", "ELIGIBLE_INDONESIA", "ELIGIBLE_SINGAPORE", "CHECK_MANUALLY", "EXCLUDED", "UNCLASSIFIED"] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

/** Statuses that may go through CV and cover letter generation. CHECK_MANUALLY also needs the candidate's approval. */
export const GENERATABLE_STATUSES: readonly EligibilityStatus[] = ["ELIGIBLE_REMOTE", "ELIGIBLE_INDONESIA", "ELIGIBLE_SINGAPORE"];

export const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  ELIGIBLE_REMOTE: "Remote, open to Indonesia",
  ELIGIBLE_INDONESIA: "In Indonesia",
  ELIGIBLE_SINGAPORE: "Singapore",
  CHECK_MANUALLY: "Check manually",
  EXCLUDED: "Excluded",
  UNCLASSIFIED: "Not classified yet",
};

/** Shortlist order: statuses first, then priority within each. */
export const STATUS_ORDER: readonly EligibilityStatus[] = ["ELIGIBLE_REMOTE", "ELIGIBLE_INDONESIA", "ELIGIBLE_SINGAPORE", "CHECK_MANUALLY", "UNCLASSIFIED", "EXCLUDED"];

export type WorkMode = "remote" | "hybrid" | "onsite" | "unknown";
export type Sponsorship = "offered" | "not_offered" | "unknown";

/** What a posting says about where and how the work happens. Every non-empty field should be backed by a quote. */
export interface EligibilityFacts {
  workMode: WorkMode;
  /** Places named for the role, as written ("Singapore", "Remote - US", "Jakarta, Indonesia"). */
  locations: string[];
  /** Countries the role can be done from, normalized to English country names. "Worldwide" and regions allowed. */
  countries: string[];
  /** For remote roles: the countries or regions candidates must be in, as written. Empty when the posting doesn't say. */
  remoteRestriction: string[];
  /** Required working-hour overlap, as written ("4 hours overlap with PST"). */
  timezoneRequirement: string | null;
  /** Work authorization, citizenship or clearance requirement, as written. */
  authorizationRequirement: string | null;
  citizenshipRequired: boolean;
  sponsorship: Sponsorship;
  /** Internship length, as written ("12 weeks"). */
  duration: string | null;
  /** Verbatim sentences from the posting behind the facts above. */
  quotes: { field: string; text: string }[];
}

export interface Eligibility {
  status: EligibilityStatus;
  facts: EligibilityFacts;
  /** Why this status, in one sentence. Logged for exclusions. */
  reason: string;
  /** CHECK_MANUALLY: the exact sentence that caused the doubt. */
  doubtQuote: string | null;
  /** ELIGIBLE_SINGAPORE: what pass is likely needed and what is unknown. */
  workAuthorizationNote: string | null;
  /** Remote roles with a stated overlap: what it means in Western Indonesia Time. */
  timezoneNote: string | null;
  /** "rules" when deterministic rules decided; "model" when a model extracted the facts first. */
  classifier: "rules" | "model";
  version: number;
  classifiedAt: string;
  /** CHECK_MANUALLY postings the candidate approved for generation. */
  approvedAt?: string | null;
}

export const ELIGIBILITY_VERSION = 1;
export const CANDIDATE_UTC_OFFSET = 7;

// ---------- Places ----------

const INDONESIA_RE =
  /\b(indonesia|jakarta|jabodetabek|bandung|surabaya|yogyakarta|jogja|bali|denpasar|medan|semarang|malang|tangerang|bsd city|bekasi|depok|bogor|batam|makassar|cikarang|balikpapan|palembang)\b/i;
const SINGAPORE_RE = /\bsingapore\b|\bSG\b/;
const OPEN_REMOTE_RE =
  /\b(worldwide|anywhere|global(ly)?|international|apac|asia[- ]?pacific|asia|south[- ]?east asia|sea region|emea ?& ?apac|gmt ?\+ ?[5-9]|utc ?\+ ?[5-9])\b/i;
const OTHER_ASIA_RE =
  /\b(malaysia|kuala lumpur|penang|thailand|bangkok|vietnam|viet nam|ho chi minh|hanoi|philippines|manila|taiwan|taipei|japan|tokyo|osaka|korea|seoul|hong kong|china|shanghai|beijing|shenzhen|hangzhou)\b/i;
const ELSEWHERE_RE =
  /\b(united states|americas?|north america|canada|mexico|brazil|argentina|colombia|chile|latam|united kingdom|uk|england|ireland|europe|eu|emea|germany|france|spain|portugal|netherlands|poland|romania|italy|sweden|denmark|norway|finland|switzerland|austria|israel|india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurugram|chennai|australia|sydney|melbourne|new zealand|africa|nigeria|kenya|egypt|turkey|uae|dubai|saudi arabia|qatar|doha|pakistan|san francisco|new york|seattle|boston|austin|chicago|los angeles|bellevue|mountain view|toronto|vancouver|montreal|london|dublin|berlin|paris|amsterdam|madrid|bucharest)\b|,\s*(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|il|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b/i;

export function mentionsIndonesia(text: string): boolean {
  return INDONESIA_RE.test(text);
}
export function mentionsSingapore(text: string): boolean {
  return SINGAPORE_RE.test(text) || /singapore/i.test(text);
}
export function isOpenRegion(text: string): boolean {
  return OPEN_REMOTE_RE.test(text);
}
// Case-sensitive, so the pronoun "us" doesn't count.
const US_RE = /\b(US|U\.S\.?|USA|U\.S\.A\.)(?![a-z])/;

export function mentionsElsewhere(text: string): boolean {
  return ELSEWHERE_RE.test(text) || US_RE.test(text) || OTHER_ASIA_RE.test(text);
}
/** Places outside Asia-Pacific (the US, Europe, India…). */
export function mentionsOutsideAsia(text: string): boolean {
  return ELSEWHERE_RE.test(text) || US_RE.test(text);
}
export function mentionsOtherAsia(text: string): boolean {
  return OTHER_ASIA_RE.test(text) && !ELSEWHERE_RE.test(text) && !US_RE.test(text);
}

// ---------- Sentence helpers ----------

/** Splits text into sentences and list items, for quoting. */
export function sentences(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.replace(/^[\s>*#\-•]+|\s+$/g, "").replace(/\*\*/g, ""))
    .filter((s) => s.length > 3);
}

// Equal-opportunity statements mention citizenship and national origin without requiring anything.
const BOILERPLATE_RE = /\b(regardless of|without regard to|equal (?:employment )?opportunit|discriminat|protected (?:veteran|characteristic|status))/i;

function firstSentence(text: string, re: RegExp): string | null {
  for (const s of sentences(text)) if (re.test(s) && !BOILERPLATE_RE.test(s)) return s.length > 300 ? `${s.slice(0, 297)}...` : s;
  return null;
}

const normalizeSpace = (s: string) => s.replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim().toLowerCase();

/** True when the quote appears in the source text (whitespace, quote style and case aside). Model quotes are checked with this. */
export function quoteAppears(quote: string, source: string): boolean {
  const q = normalizeSpace(quote.replace(/\.{3}$|…$/, ""));
  if (q.length < 4) return false;
  return normalizeSpace(source.replace(/\*\*/g, "")).includes(q);
}

// ---------- Rule-based facts ----------

const RESTRICTION_RE =
  /\b(must|need to|needs to|required to|should|have to)\s+(be\s+)?(currently\s+)?(located|based|residing|reside|live|living)\s+(in|within)\s+(the\s+)?([A-Z][\w .,&-]{1,60})|\b(open|available) (only )?to (candidates|applicants|students|residents) (located |based |residing )?(in|from) (the )?([A-Z][\w .,&-]{1,60})|\bremote[^.\n]{0,20}\((?:[^)]{2,40})\)|\b(us|u\.s\.|usa|uk|eu|canada|india)[- ]based (candidates|applicants|students|only)\b/i;
const TIMEZONE_RE =
  /\b(\d{1,2}(?:\.\d)?\+?\s*(?:-\s*\d{1,2}\s*)?hours?\s+(?:of\s+)?(?:overlap|overlapping)|overlap(?:ping)?\s+(?:with|in)\s+[^.\n]{2,60}|(?:working|core|business)\s+hours\s+(?:in|of|aligned with)\s+[^.\n]{2,60}|\b(?:pst|pdt|pt|est|edt|et|cst|cet|cest|gmt|bst|ist|sgt|jst|aest|utc|gmt)\s*(?:[+-−]\s*\d{1,2})?\s+(?:time ?zone|hours|business hours|working hours)|time ?zones?\s+(?:between|from|of|within)\s+[^.\n]{2,60})/i;
const AUTH_RE =
  /\b(authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work|legally (?:able|permitted|allowed) to work|citizen(?:ship)?|permanent resident|green card|security clearance|valid (?:work )?(?:visa|permit)|work permit|employment pass|without (?:the need for )?(?:visa )?sponsorship|require (?:visa )?sponsorship)\b/i;
const CITIZENSHIP_RE =
  /\b(must be (?:a |an )?(?:u\.?s\.?|singapore(?:an)?|canadian|uk|british|australian|indian)? ?citizens?|citizenship (?:is )?required|(?:citizens?|permanent residents?|PRs?) only|only (?:open to )?(?:singapore )?(?:citizens|permanent residents)|security clearance|(?:singapore(?:an)? )?citizens? (?:or|and) (?:permanent residents|PRs?) only|us person)\b/i;
const NO_SPONSOR_RE =
  /\b(not (?:able to |be able to )?(?:offer|provide|sponsor)[^.\n]{0,30}(?:sponsorship|visa)|(?:no|without) (?:visa |immigration )?sponsorship|unable to sponsor|does not sponsor|do not sponsor|will not sponsor|cannot sponsor|won't sponsor|sponsorship (?:is )?not (?:available|offered|provided))\b/i;
const SPONSOR_RE = /\b((?:visa|immigration|work pass|employment pass) sponsorship (?:is )?(?:available|provided|offered)|we (?:will |can )?sponsor|sponsorship available|relocation (?:support|assistance|package))\b/i;
const REMOTE_RE = /\b(fully remote|100% remote|remote[- ]first|remote(?:ly)?|work from home|wfh|work from anywhere|distributed team)\b/i;
const HYBRID_RE = /\bhybrid\b/i;
const ONSITE_RE = /\b(on[- ]?site|in[- ]office|in the office|in person|in-person|office[- ]based|days? (?:a|per) week in (?:the )?office)\b/i;
const DURATION_RE = /\b(\d{1,2})\s*(?:-|to|–)?\s*(\d{1,2})?\s*(weeks?|months?)\b/i;

function detectWorkMode(location: string, title: string, text: string, hint: WorkMode): WorkMode {
  if (hint !== "unknown") return hint;
  const head = `${title} ${location}`;
  if (HYBRID_RE.test(head)) return "hybrid";
  if (REMOTE_RE.test(head)) return "remote";
  if (HYBRID_RE.test(text)) return "hybrid";
  if (ONSITE_RE.test(text)) return "onsite";
  if (/\bfully remote|100% remote|remote[- ]first|this (?:role|position|internship) is remote\b/i.test(text)) return "remote";
  return location.trim() ? "onsite" : "unknown";
}

function countriesIn(text: string): string[] {
  const out = new Set<string>();
  if (INDONESIA_RE.test(text)) out.add("Indonesia");
  if (/singapore/i.test(text)) out.add("Singapore");
  if (OPEN_REMOTE_RE.test(text)) out.add("Worldwide or regional");
  const other = text.match(new RegExp(OTHER_ASIA_RE.source, "gi")) ?? [];
  const elsewhere = text.match(new RegExp(ELSEWHERE_RE.source, "gi")) ?? [];
  const us = text.match(new RegExp(US_RE.source, "g")) ?? [];
  for (const m of [...other, ...elsewhere, ...us]) out.add(m.replace(/^,\s*/, "").trim());
  return [...out];
}

export interface PostingInput {
  title: string;
  location: string;
  /** Plain text description. May be empty when only the listing is known. */
  description: string;
  workplace: WorkMode;
}

/** Facts deterministic rules can read from a posting. */
export function ruleFacts(p: PostingInput): EligibilityFacts {
  const text = p.description;
  const quotes: EligibilityFacts["quotes"] = [];
  const quote = (field: string, re: RegExp) => {
    const s = firstSentence(text, re);
    if (s) quotes.push({ field, text: s });
    return s;
  };
  const workMode = detectWorkMode(p.location, p.title, text, p.workplace);
  const restriction = quote("remoteRestriction", RESTRICTION_RE);
  const tz = quote("timezoneRequirement", TIMEZONE_RE);
  const auth = quote("authorizationRequirement", AUTH_RE);
  const citizenship = firstSentence(text, CITIZENSHIP_RE) !== null;
  const noSponsor = firstSentence(text, NO_SPONSOR_RE) !== null;
  const sponsor = !noSponsor && firstSentence(text, SPONSOR_RE) !== null;
  if (noSponsor) quote("sponsorship", NO_SPONSOR_RE);
  else if (sponsor) quote("sponsorship", SPONSOR_RE);
  const d = text.match(DURATION_RE) ?? p.title.match(DURATION_RE);

  const locations = p.location
    .split(/\s*(?:;|•|\||\n)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const remoteRestriction: string[] = [];
  if (workMode === "remote") {
    // "Remote - US: All locations", "Remote (Canada)", "Remote, Worldwide"
    const fromLocation = p.location.replace(/\bremote\b/gi, "").replace(/^[\s,:\-–()/|]+|[\s,:\-–()/|]+$/g, "");
    if (fromLocation) remoteRestriction.push(fromLocation);
    if (restriction) remoteRestriction.push(restriction);
  }
  return {
    workMode,
    locations,
    countries: countriesIn(p.location),
    remoteRestriction,
    timezoneRequirement: tz,
    authorizationRequirement: auth,
    citizenshipRequired: citizenship,
    sponsorship: noSponsor ? "not_offered" : sponsor ? "offered" : "unknown",
    duration: d ? d[0] : null,
    quotes,
  };
}

// ---------- Decision ----------

export interface Decision {
  status: Exclude<EligibilityStatus, "UNCLASSIFIED">;
  reason: string;
  doubtQuote: string | null;
  /** The rules can't settle it; a model should read the full posting. */
  needsModel: boolean;
}

const joined = (xs: string[]) => xs.join("; ");

/**
 * The status for a set of facts. Pure: the same facts always give the same status.
 * `hasDescription` is false when only the listing (title, location) is known.
 */
export function decide(f: EligibilityFacts, opts: { hasDescription: boolean }): Decision {
  const where = joined([...f.locations, ...f.countries]);
  const inIndonesia = mentionsIndonesia(where);
  const inSingapore = mentionsSingapore(where);
  const elsewhere = mentionsElsewhere(where.replace(/\bremote\b/gi, ""));
  const authQuote = f.quotes.find((q) => q.field === "authorizationRequirement" || q.field === "sponsorship")?.text ?? f.authorizationRequirement;

  if (f.workMode === "remote") {
    const restriction = joined(f.remoteRestriction);
    if (restriction && mentionsIndonesia(restriction)) {
      return { status: "ELIGIBLE_REMOTE", reason: `Remote and open to candidates in Indonesia (${restriction}).`, doubtQuote: null, needsModel: false };
    }
    // "APAC - Remote; Hong Kong SAR": an open region, plus Asian offices, still includes Indonesia.
    if (restriction && isOpenRegion(restriction) && !mentionsOutsideAsia(restriction)) {
      if (f.citizenshipRequired) {
        return { status: "CHECK_MANUALLY", reason: "Remote and open by region, but the posting mentions a citizenship or clearance requirement.", doubtQuote: authQuote, needsModel: false };
      }
      return { status: "ELIGIBLE_REMOTE", reason: `Remote with an open region (${restriction}).`, doubtQuote: null, needsModel: false };
    }
    if (restriction && mentionsOtherAsia(restriction) && !mentionsSingapore(restriction)) {
      // "Remote, Minato City, Japan" often means remote within Japan, but not always.
      return { status: "CHECK_MANUALLY", reason: `Remote, listed in ${restriction}. It may require living there.`, doubtQuote: restriction, needsModel: opts.hasDescription };
    }
    if (restriction && (mentionsElsewhere(restriction) || mentionsSingapore(restriction))) {
      if (inIndonesia || isOpenRegion(restriction)) {
        return { status: "CHECK_MANUALLY", reason: "Remote, but the eligible countries are mixed.", doubtQuote: restriction, needsModel: opts.hasDescription };
      }
      return { status: "EXCLUDED", reason: `Remote only for candidates in ${restriction}, which doesn't include Indonesia.`, doubtQuote: null, needsModel: false };
    }
    if (inIndonesia) return { status: "ELIGIBLE_REMOTE", reason: "Remote, listed in Indonesia.", doubtQuote: null, needsModel: false };
    if (f.citizenshipRequired) {
      return { status: "EXCLUDED", reason: "Remote, but requires a citizenship or clearance the candidate doesn't hold.", doubtQuote: null, needsModel: false };
    }
    return {
      status: "CHECK_MANUALLY",
      reason: "Remote, but the posting doesn't say which countries it hires from.",
      doubtQuote: f.locations.find((l) => /remote/i.test(l)) ?? f.locations[0] ?? "Remote",
      needsModel: opts.hasDescription,
    };
  }

  if (f.workMode === "onsite" || f.workMode === "hybrid") {
    const mode = f.workMode === "hybrid" ? "Hybrid" : "On-site";
    if (inIndonesia) return { status: "ELIGIBLE_INDONESIA", reason: `${mode} in Indonesia (${joined(f.locations) || "Indonesia"}).`, doubtQuote: null, needsModel: false };
    if (inSingapore) {
      if (f.citizenshipRequired) {
        return { status: "EXCLUDED", reason: `${mode} in Singapore, open only to citizens or permanent residents.`, doubtQuote: null, needsModel: false };
      }
      if (f.sponsorship === "not_offered") {
        return {
          status: "EXCLUDED",
          reason: `${mode} in Singapore, and the posting says it won't sponsor a work pass. Interns from overseas universities need the employer to apply for one.`,
          doubtQuote: null,
          needsModel: false,
        };
      }
      const also = elsewhere ? " It's also listed in other locations; apply for the Singapore one." : "";
      return { status: "ELIGIBLE_SINGAPORE", reason: `${mode} in Singapore.${also}`, doubtQuote: null, needsModel: false };
    }
    if (!where.trim()) {
      return { status: "CHECK_MANUALLY", reason: "The posting doesn't state a location.", doubtQuote: null, needsModel: opts.hasDescription };
    }
    return { status: "EXCLUDED", reason: `${mode} in ${joined(f.locations) || where}, outside Indonesia and Singapore.`, doubtQuote: null, needsModel: false };
  }

  // Work mode unknown.
  if (inIndonesia) return { status: "ELIGIBLE_INDONESIA", reason: "Located in Indonesia; work mode not stated.", doubtQuote: null, needsModel: false };
  if (inSingapore) return { status: "ELIGIBLE_SINGAPORE", reason: "Located in Singapore; work mode not stated.", doubtQuote: null, needsModel: opts.hasDescription };
  if (elsewhere) return { status: "EXCLUDED", reason: `Located in ${where}; no remote option stated.`, doubtQuote: null, needsModel: false };
  return { status: "CHECK_MANUALLY", reason: "The posting doesn't say where or how the work happens.", doubtQuote: null, needsModel: opts.hasDescription };
}

// ---------- Notes ----------

function weeksOf(duration: string | null): number | null {
  const m = duration?.match(DURATION_RE);
  if (!m) return null;
  const n = Math.max(Number(m[1]), Number(m[2] ?? 0));
  return /month/i.test(m[3]) ? n * 4.3 : n;
}

/**
 * What a Singapore internship likely needs, from Singapore's Ministry of Manpower (checked September 2026):
 * the Training Employment Pass is applied for by the employer, lasts up to 3 months and isn't renewable, and
 * waives the S$3,000 salary floor for students at acceptable institutions. The Work Holiday Programme covers
 * only universities in 10 countries, not Indonesia.
 */
export function singaporeNote(f: EligibilityFacts, confirmedAuthorization: string): string {
  if (confirmedAuthorization.trim()) {
    return `Your profile confirms: ${confirmedAuthorization.trim()}. Check it covers this internship's dates.`;
  }
  const parts = [
    "Likely pass: a Training Employment Pass (TEP), which the employer applies for. It lasts up to 3 months, can't be renewed, and waives the S$3,000 salary floor for students at acceptable institutions. Check whether ITB counts.",
  ];
  const weeks = weeksOf(f.duration);
  if (weeks !== null && weeks > 13) {
    parts.push(`The posting says ${f.duration}, longer than a TEP allows. Ask which pass they use for longer internships (often an Employment Pass, with salary thresholds).`);
  } else if (weeks !== null) {
    parts.push(`The posting says ${f.duration}, within the TEP limit.`);
  }
  if (f.sponsorship === "offered") parts.push("The posting says it offers sponsorship or relocation support.");
  else parts.push("Unknown: the posting doesn't say whether they apply for passes for interns from overseas universities. Ask the recruiter before investing in the application.");
  parts.push("The Work Holiday Programme doesn't apply (it's limited to universities in Australia, France, Germany, Hong Kong, Japan, the Netherlands, New Zealand, Switzerland, the UK and the US).");
  return parts.join(" ");
}

const ZONES: Record<string, number> = {
  pst: -8, pdt: -7, pt: -7, pacific: -7, mst: -7, mdt: -6, mt: -6, cst: -6, cdt: -5, ct: -5, central: -6, est: -5, edt: -4, et: -4, eastern: -4,
  gmt: 0, utc: 0, bst: 1, uk: 0, cet: 1, cest: 2, eet: 2, ist: 5.5, india: 5.5, sgt: 8, singapore: 8, hkt: 8, jst: 9, kst: 9, aest: 10, aedt: 11, sydney: 10,
};

/** What a stated overlap requirement means from Western Indonesia Time (UTC+7). */
export function timezoneNote(requirement: string | null): string | null {
  if (!requirement) return null;
  const lower = requirement.toLowerCase();
  const offsetMatch = lower.match(/\b(utc|gmt)\s*([+−-])\s*(\d{1,2})/);
  let offset: number | null = offsetMatch ? (offsetMatch[2] === "+" ? 1 : -1) * Number(offsetMatch[3]) : null;
  let zone = offsetMatch ? `${offsetMatch[1].toUpperCase()}${offsetMatch[2] === "+" ? "+" : "−"}${offsetMatch[3]}` : "";
  if (offset === null) {
    for (const [name, value] of Object.entries(ZONES)) {
      if (new RegExp(`\\b${name}\\b`).test(lower)) {
        offset = value;
        zone = name.toUpperCase();
        break;
      }
    }
  }
  const hours = lower.match(/(\d{1,2})(?:\.\d)?\+?\s*(?:-\s*\d{1,2}\s*)?hours?/);
  const needed = hours ? `${hours[1]} hours of overlap` : "overlap";
  if (offset === null) return `The posting asks for ${needed} ("${requirement}"). The zone isn't clear; ask which hours they mean in WIB (UTC+7).`;
  const diff = CANDIDATE_UTC_OFFSET - offset;
  // Their 9:00–17:00 in WIB.
  const start = (((9 + diff) % 24) + 24) % 24;
  const end = (((17 + diff) % 24) + 24) % 24;
  const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;
  const severity = Math.abs(diff) >= 10 ? "Hard: most of it falls at night in Bandung." : Math.abs(diff) >= 5 ? "Workable with early mornings or late evenings." : "Easy: the working days mostly overlap.";
  return `Asks for ${needed} with ${zone} (UTC${offset >= 0 ? "+" : "−"}${Math.abs(offset)}). Their 09:00–17:00 is ${fmt(start)}–${fmt(end)} WIB. ${severity}`;
}

/** Assembles the stored result from facts and a decision. */
export function buildEligibility(
  facts: EligibilityFacts,
  decision: Decision,
  opts: { classifier: "rules" | "model"; confirmedSingaporeAuthorization: string; now: string },
): Eligibility {
  return {
    status: decision.status,
    facts,
    reason: decision.reason,
    doubtQuote: decision.status === "CHECK_MANUALLY" ? decision.doubtQuote : null,
    workAuthorizationNote: decision.status === "ELIGIBLE_SINGAPORE" ? singaporeNote(facts, opts.confirmedSingaporeAuthorization) : null,
    timezoneNote: facts.workMode === "remote" ? timezoneNote(facts.timezoneRequirement) : null,
    classifier: opts.classifier,
    version: ELIGIBILITY_VERSION,
    classifiedAt: opts.now,
  };
}

/** Whether a posting may go through CV and cover letter generation. */
export function canGenerate(e: Pick<Eligibility, "status" | "approvedAt"> | null): boolean {
  if (!e) return false;
  return GENERATABLE_STATUSES.includes(e.status) || (e.status === "CHECK_MANUALLY" && Boolean(e.approvedAt));
}
