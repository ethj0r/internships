// Deterministic, explainable match scoring. Runs for every discovered job, so it must stay cheap.
// The optional AI fit analysis (ai/analyze) adds narrative on top of this, on demand.

import { detectRoles, ROLE_LABELS } from "../../shared/roles";
import { extractSkills, skillSet } from "../../shared/skills";
import type { JobSkills, MatchResult, Profile, Workplace } from "../../shared/types";
import { normalizeKey } from "../lib/text";

export const MATCH_VERSION = 1;

export interface MatchContext {
  profile: Profile;
  skills: Set<string>;
}

export function buildMatchContext(profile: Profile, masterCv: string | null): MatchContext {
  return { profile, skills: skillSet([...profile.skills, ...(masterCv ? extractSkills(masterCv) : [])]) };
}

const PREFERRED_HEADING = /prefer|nice[- ]to[- ]have|bonus|\bplus\b|desir|ideal|stand out|great if|extra credit/i;
const REQUIRED_HEADING = /require|qualif|must|minimum|basic|what you('ll)? (need|bring)|who you are|about you|you have|you are|looking for|skills|experience/i;

/** Splits the skills a description mentions into required vs preferred using its section headings. */
export function extractJobSkills(description: string): JobSkills {
  const required = new Set<string>();
  const preferred = new Set<string>();
  const other = new Set<string>();
  let section: "required" | "preferred" | "other" = "other";
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const target = section === "required" ? required : section === "preferred" ? preferred : other;
    for (const s of extractSkills(buffer.join("\n"))) target.add(s);
    buffer = [];
  };

  for (const line of description.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1] ?? (line.length < 80 && /:\s*$/.test(line) ? line : null);
    if (heading) {
      flush();
      section = PREFERRED_HEADING.test(heading) ? "preferred" : REQUIRED_HEADING.test(heading) ? "required" : "other";
      continue;
    }
    if (/^\s*-\s/.test(line) && PREFERRED_HEADING.test(line.slice(0, 48))) {
      for (const s of extractSkills(line)) preferred.add(s);
      continue;
    }
    buffer.push(line);
  }
  flush();

  // Without a recognizable requirements section, everything mentioned counts as required.
  const req = required.size ? [...required] : [...other].filter((s) => !preferred.has(s));
  const pref = [...new Set([...preferred, ...(required.size ? other : [])])].filter((s) => !req.includes(s));
  return { required: req, preferred: pref };
}

export interface MatchInput {
  title: string;
  description: string; // plain text
  location: string;
  workplace: Workplace;
  skills: JobSkills;
}

interface Signals {
  score: number;
  highlights: string[];
  concerns: string[];
}

function locationFit(job: MatchInput, profile: Profile): Signals {
  const locations = profile.preferredLocations.map(normalizeKey).filter(Boolean);
  const jobLocation = normalizeKey(job.location);
  const hit = profile.preferredLocations.find((l) => normalizeKey(l) && jobLocation.includes(normalizeKey(l)));
  const pref = profile.remotePreference;

  if (job.workplace === "remote") {
    return pref === "onsite" ? { score: 0.6, highlights: [], concerns: ["Remote role; you prefer on-site"] } : { score: 1, highlights: ["Remote"], concerns: [] };
  }
  if (hit) return { score: 1, highlights: [`Located in ${hit}`], concerns: [] };
  if (pref === "remote") return { score: 0.25, highlights: [], concerns: [`${job.workplace === "hybrid" ? "Hybrid" : "On-site"} role; you prefer remote`] };
  if (!locations.length) return { score: 0.7, highlights: [], concerns: [] };
  return { score: 0.3, highlights: [], concerns: [job.location ? `${job.location} isn't one of your preferred locations` : "Location not listed"] };
}

function eligibility(text: string, profile: Profile): Signals {
  const concerns: string[] = [];
  const highlights: string[] = [];
  let penalty = 0;
  const education = profile.education.toLowerCase();

  if (/(pursuing|enrolled in|candidates? for) (a )?ph\.?d|ph\.?d\.? (students?|candidates?)|doctoral (students?|candidates?)/i.test(text) && !/ph\.?d|doctor/.test(education)) {
    concerns.push("Aimed at PhD students");
    penalty += 0.5;
  }
  const masters = text.match(/[^.\n]*(pursuing|enrolled in|currently in)[^.\n]*(master'?s|m\.s\.|\bms\b|graduate degree)[^.\n]*/i);
  if (masters && !/bachelor|undergrad|b\.s\.|\bbs\b/i.test(masters[0]) && !/master|m\.s\.|msc|graduate/.test(education)) {
    concerns.push("Asks for a master's program");
    penalty += 0.25;
  }
  if (/security clearance|clearance (is )?required|ts\/sci/i.test(text)) {
    concerns.push("Requires a security clearance");
    penalty += 0.3;
  }
  if (/u\.?s\.? citizen(ship)?( is)? required|must be a u\.?s\.? citizen|\bus persons?\b/i.test(text) && !/citizen/i.test(profile.workAuthorization)) {
    concerns.push("Requires U.S. citizenship");
    penalty += 0.3;
  }
  if (/(not|unable to|cannot|won't|will not|does not) (be able to )?(provide |offer )?(visa )?sponsor/i.test(text)) {
    const needsSponsorship = /sponsor|visa|require/i.test(profile.workAuthorization) && !/no sponsorship needed|do not require|don't require/i.test(profile.workAuthorization);
    concerns.push("No visa sponsorship");
    if (needsSponsorship) penalty += 0.4;
  }

  const gradYear = profile.graduationDate?.slice(0, 4);
  if (gradYear) {
    const years = new Set<string>();
    for (const m of text.matchAll(/graduat\w*[^.\n]{0,60}?\b(20\d{2})\b/gi)) years.add(m[1]!);
    for (const m of text.matchAll(/\bclass of (20\d{2})\b/gi)) years.add(m[1]!);
    if (years.size) {
      if (years.has(gradYear)) highlights.push("Graduation timing fits");
      else {
        concerns.push(`Looks for graduation in ${[...years].sort().join(" or ")} (yours: ${gradYear})`);
        penalty += 0.35;
      }
    }
  }
  return { score: Math.max(0, 1 - penalty), highlights, concerns };
}

export function scoreJob(job: MatchInput, ctx: MatchContext): MatchResult {
  const { profile, skills } = ctx;
  const highlights: string[] = [];
  const concerns: string[] = [];

  // Skills
  const matchedRequired = job.skills.required.filter((s) => skills.has(s));
  const matchedPreferred = job.skills.preferred.filter((s) => skills.has(s));
  const missingRequired = job.skills.required.filter((s) => !skills.has(s));
  const missingPreferred = job.skills.preferred.filter((s) => !skills.has(s));
  let skillScore: number;
  if (skills.size === 0) {
    skillScore = 0.4;
    concerns.push("Add skills or upload a master CV for accurate matching");
  } else {
    const req = job.skills.required.length ? matchedRequired.length / job.skills.required.length : 0.6;
    const pref = job.skills.preferred.length ? matchedPreferred.length / job.skills.preferred.length : 0.5;
    skillScore = 0.85 * req + 0.15 * pref;
    if (job.skills.required.length) highlights.push(`Matches ${matchedRequired.length} of ${job.skills.required.length} required skills`);
  }

  // Role
  const detected = detectRoles(job.title, job.description);
  // Title roles describe the job; description matches are only a fallback (descriptions mention many areas).
  const roles = detected.title.length ? detected.title : detected.description.slice(0, 2);
  let roleScore: number;
  if (!profile.targetRoles.length) roleScore = detected.title.length ? 0.75 : 0.6;
  else {
    const inTitle = profile.targetRoles.filter((r) => detected.title.includes(r));
    const inBody = profile.targetRoles.filter((r) => detected.description.includes(r));
    roleScore = inTitle.length ? 1 : inBody.length ? 0.7 : detected.title.includes("software") ? 0.5 : 0.25;
    const aligned = inTitle.length ? inTitle : inBody;
    if (aligned.length) highlights.push(`Aligns with ${aligned.map((r) => ROLE_LABELS[r] ?? r).join(", ")}`);
    else concerns.push("Outside your target roles");
  }

  const location = locationFit(job, profile);
  const elig = eligibility(job.description, profile);
  highlights.push(...location.highlights, ...elig.highlights);
  concerns.push(...location.concerns, ...elig.concerns);

  let score = Math.round(100 * (0.45 * skillScore + 0.2 * roleScore + 0.15 * location.score + 0.2 * elig.score));

  const haystack = `${job.title}\n${job.description}`.toLowerCase();
  const included = profile.keywordsInclude.filter((k) => k.trim() && haystack.includes(k.trim().toLowerCase()));
  if (included.length) {
    score += Math.min(8, included.length * 4);
    highlights.push(`Mentions ${included.map((k) => `“${k}”`).join(", ")}`);
  }
  const excluded = profile.keywordsExclude.find((k) => k.trim() && haystack.includes(k.trim().toLowerCase()));
  if (excluded) {
    score = Math.min(score, 15);
    concerns.unshift(`Mentions “${excluded}”, which you excluded`);
  }

  return {
    version: MATCH_VERSION,
    score: Math.max(0, Math.min(100, score)),
    matchedSkills: [...new Set([...matchedRequired, ...matchedPreferred])],
    missingRequired,
    missingPreferred,
    roles,
    highlights,
    concerns,
    breakdown: {
      skills: Math.round(skillScore * 100),
      role: Math.round(roleScore * 100),
      location: Math.round(location.score * 100),
      eligibility: Math.round(elig.score * 100),
    },
  };
}
