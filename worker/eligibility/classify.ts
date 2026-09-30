// Classifies postings before any tailoring (shared/eligibility.ts).
//
// Rules run on every posting at ingest, with no model call. Only postings the rules can't settle (remote with no
// country, unknown location, mixed restrictions) go to the fast model, which extracts facts with verbatim quotes.
// Quotes that don't appear in the posting are dropped, and decide() assigns the status from the verified facts.

import { z } from "zod";
import {
  buildEligibility,
  decide,
  quoteAppears,
  ruleFacts,
  type Eligibility,
  type EligibilityFacts,
  type WorkMode,
} from "../../shared/eligibility";
import { companyTier, detectSeason, priorityScore } from "../../shared/priority";
import type { Profile } from "../../shared/types";
import { generateJson } from "../ai/provider";
import { chunk, eventStmt, getProfile, nowIso, parseJson } from "../lib/db";
import { plainText, truncate } from "../lib/text";
import { render } from "../prompts";

export interface PostingForEligibility {
  company: string;
  title: string;
  location: string;
  workplace: WorkMode;
  /** Markdown or plain text; empty when only the listing is known. */
  description: string;
}

export interface RuleResult {
  eligibility: Eligibility;
  /** The rules couldn't settle it and the description is known: ask the fast model. */
  needsModel: boolean;
}

export function classifyByRules(p: PostingForEligibility, profile: Pick<Profile, "sgWorkAuthorization">, now = nowIso()): RuleResult {
  const description = plainText(p.description);
  const facts = ruleFacts({ title: p.title, location: p.location, description, workplace: p.workplace });
  const decision = decide(facts, { hasDescription: Boolean(description.trim()) });
  return {
    eligibility: buildEligibility(facts, decision, { classifier: "rules", confirmedSingaporeAuthorization: profile.sgWorkAuthorization, now }),
    needsModel: decision.needsModel,
  };
}

const EligibilitySchema = z.object({
  work_mode: z.enum(["remote", "hybrid", "onsite", "unknown"]),
  locations: z.array(z.string()),
  countries: z.array(z.string()),
  remote_restriction: z.array(z.string()),
  timezone_requirement: z.string(),
  authorization_requirement: z.string(),
  citizenship_required: z.boolean(),
  sponsorship: z.enum(["offered", "not_offered", "unknown"]),
  duration: z.string(),
  quotes: z.array(z.object({ field: z.string(), text: z.string() })),
  doubt: z.string(),
});

/**
 * Merges model facts into rule facts. A model fact is used only when a verified quote supports it or it restates
 * the location field; otherwise the rule fact stands. The model can't talk a posting into eligibility.
 */
export function mergeModelFacts(rules: EligibilityFacts, m: z.infer<typeof EligibilitySchema>, source: { header: string; text: string }): { facts: EligibilityFacts; doubt: string | null } {
  const all = `${source.header}\n${source.text}`;
  const verified = m.quotes.filter((q) => q.text.trim() && quoteAppears(q.text, all));
  const quoted = (field: string) => verified.some((q) => q.field === field);
  const inHeader = (value: string) => Boolean(value.trim()) && source.header.toLowerCase().includes(value.trim().toLowerCase());
  const supported = (field: string, values: string[]) => quoted(field) || (values.length > 0 && values.every(inHeader));

  const facts: EligibilityFacts = {
    workMode: m.work_mode !== "unknown" && (quoted("work_mode") || rules.workMode === "unknown" || inHeader(m.work_mode)) ? m.work_mode : rules.workMode,
    locations: rules.locations.length ? rules.locations : supported("locations", m.locations) ? m.locations : [],
    countries: [...new Set([...rules.countries, ...(supported("locations", m.locations) || supported("countries", m.countries) ? m.countries : [])])],
    remoteRestriction: supported("remote_restriction", m.remote_restriction) ? m.remote_restriction : rules.remoteRestriction,
    timezoneRequirement: m.timezone_requirement.trim() && quoted("timezone_requirement") ? m.timezone_requirement.trim() : rules.timezoneRequirement,
    authorizationRequirement: m.authorization_requirement.trim() && quoted("authorization_requirement") ? m.authorization_requirement.trim() : rules.authorizationRequirement,
    citizenshipRequired: rules.citizenshipRequired || (m.citizenship_required && (quoted("citizenship_required") || quoted("authorization_requirement"))),
    sponsorship: m.sponsorship !== "unknown" && quoted("sponsorship") ? m.sponsorship : rules.sponsorship,
    duration: m.duration.trim() && quoted("duration") ? m.duration.trim() : rules.duration,
    quotes: [...rules.quotes, ...verified.filter((q) => !rules.quotes.some((r) => r.text === q.text))],
  };
  const doubt = m.doubt.trim() && quoteAppears(m.doubt, all) ? m.doubt.trim() : null;
  return { facts, doubt };
}

export async function classifyWithModel(env: Env, p: PostingForEligibility, profile: Pick<Profile, "sgWorkAuthorization">): Promise<Eligibility> {
  const text = plainText(p.description);
  const rules = ruleFacts({ title: p.title, location: p.location, description: text, workplace: p.workplace });
  const { data } = await generateJson(env, {
    ...render("eligibility", {
      company: p.company,
      title: p.title,
      location: p.location || "(not stated)",
      workplace: p.workplace,
      description: truncate(text, 8_000),
    }),
    schema: EligibilitySchema,
    tier: "fast",
  });
  const { facts, doubt } = mergeModelFacts(rules, data, { header: `${p.title}\n${p.location}`, text });
  const dropped = data.quotes.filter((q) => !facts.quotes.some((f) => f.text === q.text));
  if (dropped.length) console.log(JSON.stringify({ message: "eligibility.quotes_dropped", company: p.company, title: p.title, dropped }));
  const decision = decide(facts, { hasDescription: true });
  const eligibility = buildEligibility(facts, { ...decision, doubtQuote: decision.doubtQuote ?? doubt }, {
    classifier: "model",
    confirmedSingaporeAuthorization: profile.sgWorkAuthorization,
    now: nowIso(),
  });
  return eligibility;
}

// ---------- Stored jobs ----------

interface EligibilityRow {
  id: number;
  company: string;
  title: string;
  location: string;
  workplace: WorkMode;
  description: string;
  match_score: number | null;
  eligibility: string | null;
}

/** Tier, season and priority for a job, given its eligibility. */
export function priorityFields(job: { company: string; title: string; description: string; matchScore: number | null }, status: Eligibility["status"]) {
  const tier = companyTier(job.company);
  const season = detectSeason(job.title, plainText(job.description));
  return { tier, season, score: priorityScore({ tier, season, status, matchScore: job.matchScore }) };
}

export function eligibilityUpdateStmt(db: D1Database, id: number, e: Eligibility, job: { company: string; title: string; description: string; matchScore: number | null }): D1PreparedStatement {
  const p = priorityFields(job, e.status);
  return db
    .prepare("UPDATE jobs SET eligibility = ?, eligibility_status = ?, priority_tier = ?, season = ?, priority_score = ? WHERE id = ?")
    .bind(JSON.stringify(e), e.status, p.tier, p.season, p.score, id);
}

/**
 * Classifies UNCLASSIFIED jobs: rules first for all of them, then the fast model for up to `modelBudget` that the
 * rules can't settle. When the model fails, the rules' decision is kept so nothing stays unclassified for long.
 */
export async function classifyPending(env: Env, opts: { modelBudget: number; limit?: number }): Promise<{ classified: number; modelCalls: number; byStatus: Record<string, number> }> {
  const db = env.DB;
  const profile = await getProfile(db);
  const { results } = await db
    .prepare(
      `SELECT id, company, title, location, workplace, description, match_score, eligibility FROM jobs
       WHERE eligibility_status = 'UNCLASSIFIED' AND duplicate_of IS NULL
       ORDER BY first_seen_at DESC LIMIT ?`,
    )
    .bind(opts.limit ?? 400)
    .all<EligibilityRow>();

  let modelCalls = 0;
  const byStatus: Record<string, number> = {};
  const updates: D1PreparedStatement[] = [];
  for (const row of results) {
    const posting = { company: row.company, title: row.title, location: row.location, workplace: row.workplace, description: row.description };
    let { eligibility, needsModel } = classifyByRules(posting, profile);
    if (needsModel && modelCalls < opts.modelBudget) {
      modelCalls++;
      try {
        eligibility = await classifyWithModel(env, posting, profile);
      } catch (err) {
        console.warn(JSON.stringify({ message: "eligibility.model_failed", job: row.id, error: String(err) }));
        eligibility = { ...eligibility, reason: `${eligibility.reason} (Rules only: the model was unavailable.)` };
      }
    } else if (needsModel) {
      continue; // Out of model budget: leave it for the next run rather than settle for the rules' guess.
    }
    const previous = parseJson<Eligibility | null>(row.eligibility, null);
    if (previous?.approvedAt && eligibility.status === "CHECK_MANUALLY") eligibility.approvedAt = previous.approvedAt;
    byStatus[eligibility.status] = (byStatus[eligibility.status] ?? 0) + 1;
    updates.push(eligibilityUpdateStmt(db, row.id, eligibility, { company: row.company, title: row.title, description: row.description, matchScore: row.match_score }));
    updates.push(eventStmt(db, "job", row.id, "eligibility_classified", { status: eligibility.status, reason: eligibility.reason, classifier: eligibility.classifier }));
  }
  for (const group of chunk(updates, 50)) await db.batch(group);
  return { classified: updates.length / 2, modelCalls, byStatus };
}

/** Classifies one job now (rules, then the fast model when needed). Used for imports and "Reclassify". */
export async function reclassifyJob(env: Env, id: number): Promise<Eligibility> {
  const db = env.DB;
  const row = await db
    .prepare("SELECT id, company, title, location, workplace, description, match_score, eligibility FROM jobs WHERE id = ?")
    .bind(id)
    .first<EligibilityRow>();
  if (!row) throw new Error(`Job ${id} not found.`);
  const profile = await getProfile(db);
  const posting = { company: row.company, title: row.title, location: row.location, workplace: row.workplace, description: row.description };
  let { eligibility, needsModel } = classifyByRules(posting, profile);
  if (needsModel) {
    try {
      eligibility = await classifyWithModel(env, posting, profile);
    } catch (err) {
      eligibility = { ...eligibility, reason: `${eligibility.reason} (Rules only: the model was unavailable.)` };
      console.warn(JSON.stringify({ message: "eligibility.model_failed", job: id, error: String(err) }));
    }
  }
  const previous = parseJson<Eligibility | null>(row.eligibility, null);
  if (previous?.approvedAt && eligibility.status === "CHECK_MANUALLY") eligibility.approvedAt = previous.approvedAt;
  await db.batch([
    eligibilityUpdateStmt(db, id, eligibility, { company: row.company, title: row.title, description: row.description, matchScore: row.match_score }),
    eventStmt(db, "job", id, "eligibility_classified", { status: eligibility.status, reason: eligibility.reason, classifier: eligibility.classifier }),
  ]);
  return eligibility;
}
