// Priority for the shortlist: company tier (config/companies.json), internship season, eligibility and fit.
// Summer 2027 internships at big tech lead; the match score orders postings within the same tier and season.

import companies from "../config/companies.json";
import type { EligibilityStatus } from "./eligibility";

export type Tier = 1 | 2 | 3 | 4;

export interface CompanyProfile {
  name: string;
  aliases: string[];
  tier: Tier;
  signals: string[];
}

export const TIER_LABELS: Record<Tier, string> = { 1: "Big tech", 2: "Southeast Asian tech", 3: "Remote-first", 4: "Other" };

const COMPANIES = companies.companies as CompanyProfile[];

const LEGAL_SUFFIX = /\b(inc|llc|ltd|limited|pte|plc|corp|corporation|co|gmbh|tbk|pt|group|holdings|technologies|technology|labs?)\b\.?/g;

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 .&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Aliases that are ordinary words match only the whole name ("Remote", not "Remote Sensing Co").
const GENERIC_ALIASES = new Set(["remote", "sea", "visa", "grab", "meta", "apple", "deel", "uber", "slack"]);

/** The configured company for a posting's company name: exact alias, or a distinctive alias followed by more words ("Shopee Singapore"). */
export function findCompany(name: string): CompanyProfile | null {
  const n = normalizeCompany(name);
  const bare = n.replace(LEGAL_SUFFIX, "").replace(/\s+/g, " ").trim();
  for (const c of COMPANIES) {
    for (const alias of c.aliases) {
      const a = alias.toLowerCase();
      if (n === a || bare === a) return c;
      if (!GENERIC_ALIASES.has(a) && a.length >= 5 && (n.startsWith(`${a} `) || bare.startsWith(`${a} `))) return c;
    }
  }
  return null;
}

export function companyTier(name: string): Tier {
  return findCompany(name)?.tier ?? 4;
}

/** "summer_2027", "winter_2027", "fall_2026", "2027", or null. From the title first, then the description. */
export function detectSeason(title: string, description = ""): string | null {
  const read = (text: string): string | null => {
    const m =
      text.match(/\b(summer|winter|spring|fall|autumn)\s*(?:of\s*)?['’]?(20\d{2}|\d{2})\b/i) ??
      text.match(/\b(20\d{2})\s*(summer|winter|spring|fall|autumn)\b/i);
    if (m) {
      const [season, year] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
      const y = year.length === 2 ? `20${year}` : year;
      return `${season.toLowerCase().replace("autumn", "fall")}_${y}`;
    }
    // "May – August 2027", "June to September 2027"
    const months = text.match(/\b(may|june|jun|july|jul)\b[^.\n]{0,40}\b(august|aug|september|sep)\b[^.\n]{0,10}\b(20\d{2})\b/i);
    if (months) return `summer_${months[3]}`;
    const year = text.match(/\b(20(?:2[6-9]))\s*(?:start|intern)/i) ?? text.match(/\bclass of (20\d{2})\b/i);
    return year ? year[1] : null;
  };
  return read(title) ?? read(description.slice(0, 4000));
}

export const SEASON_LABEL = (season: string | null): string => {
  if (!season) return "";
  const [s, y] = season.split("_");
  return y ? `${s[0].toUpperCase()}${s.slice(1)} ${y}` : season;
};

/** The season the candidate targets first. */
export const TARGET_SEASON = "summer_2027";

const STATUS_BONUS: Partial<Record<EligibilityStatus, number>> = {
  ELIGIBLE_REMOTE: 12,
  ELIGIBLE_INDONESIA: 10,
  ELIGIBLE_SINGAPORE: 10,
  CHECK_MANUALLY: 4,
};

/**
 * A 0–200 ranking score. Tier dominates (big tech first), then the Summer 2027 season, then eligibility and the
 * match score. Not shown as a percentage: it only orders the shortlist.
 */
export function priorityScore(input: { tier: Tier; season: string | null; status: EligibilityStatus; matchScore: number | null; currentYear?: number }): number {
  const tier = { 1: 80, 2: 55, 3: 45, 4: 20 }[input.tier];
  const year = Number(input.season?.match(/20\d{2}/)?.[0] ?? 0);
  const currentYear = input.currentYear ?? new Date().getUTCFullYear();
  // A season that's already over means a stale posting that was never taken down.
  const season =
    year && year < currentYear ? -60 : input.season === TARGET_SEASON ? 30 : input.season?.endsWith("2027") ? 15 : year > currentYear ? 8 : 0;
  const status = STATUS_BONUS[input.status] ?? 0;
  const match = Math.round((input.matchScore ?? 50) * 0.6);
  return tier + season + status + match;
}
