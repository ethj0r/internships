import { Hono } from "hono";
import { z } from "zod";
import { ROLES } from "../../shared/roles";
import { canonicalizeSkill } from "../../shared/skills";
import { rescoreAll } from "../discovery/run";
import { eventStmt, getProfile, nowIso } from "../lib/db";
import { readJson, type AppEnv } from "../lib/validate";

export const profile = new Hono<AppEnv>();

const shortList = (max: number) => z.array(z.string().trim().min(1).max(100)).max(max);

const ProfileBody = z.object({
  fullName: z.string().trim().max(200),
  email: z.string().trim().max(200),
  phone: z.string().trim().max(50),
  location: z.string().trim().max(200),
  links: z.array(z.object({ label: z.string().trim().max(50), url: z.string().trim().max(500) })).max(10),
  headline: z.string().trim().max(300),
  education: z.string().trim().max(2000),
  graduationDate: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM").nullable(),
  skills: shortList(150),
  targetRoles: z.array(z.enum(ROLES.map((r) => r.key) as [string, ...string[]])).max(ROLES.length),
  preferredLocations: shortList(30),
  remotePreference: z.enum(["any", "remote", "hybrid", "onsite"]),
  workAuthorization: z.string().trim().max(300),
  keywordsInclude: shortList(30),
  keywordsExclude: shortList(30),
  notifyMinScore: z.number().int().min(0).max(100),
});

function dedupe(values: string[], normalize: (s: string) => string = (s) => s): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const n = normalize(v);
    if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  }
  return [...seen.values()];
}

profile.get("/", async (c) => c.json(await getProfile(c.env.DB)));

profile.put("/", async (c) => {
  const p = await readJson(c, ProfileBody);
  const db = c.env.DB;
  await db.batch([
    db
      .prepare(
        `UPDATE profile SET full_name = ?, email = ?, phone = ?, location = ?, links = ?, headline = ?, education = ?,
           graduation_date = ?, skills = ?, target_roles = ?, preferred_locations = ?, remote_preference = ?,
           work_authorization = ?, keywords_include = ?, keywords_exclude = ?, notify_min_score = ?, updated_at = ?
         WHERE id = 1`,
      )
      .bind(
        p.fullName,
        p.email,
        p.phone,
        p.location,
        JSON.stringify(p.links.filter((l) => l.url)),
        p.headline,
        p.education,
        p.graduationDate,
        JSON.stringify(dedupe(p.skills, canonicalizeSkill)),
        JSON.stringify(dedupe(p.targetRoles)),
        JSON.stringify(dedupe(p.preferredLocations)),
        p.remotePreference,
        p.workAuthorization,
        JSON.stringify(dedupe(p.keywordsInclude)),
        JSON.stringify(dedupe(p.keywordsExclude)),
        p.notifyMinScore,
        nowIso(),
      ),
    eventStmt(db, "profile", 1, "updated"),
  ]);
  c.executionCtx.waitUntil(rescoreAll(c.env).catch((err) => console.error(JSON.stringify({ message: "rescore.failed", error: String(err) }))));
  return c.json(await getProfile(db));
});
