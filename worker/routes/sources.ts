import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Source, SourceKind } from "../../shared/types";
import { adapterFor } from "../discovery/registry";
import watchlist from "../../config/watchlist.json";
import { listCycles, runScheduledRefresh } from "../discovery/refresh";
import { intVar, runDiscovery } from "../discovery/run";
import { classifyPending } from "../eligibility/classify";
import { eventStmt, parseJson } from "../lib/db";
import { visibleFilter } from "../lib/scope";
import { idParam, notFound, readJson, type AppEnv } from "../lib/validate";

export const sources = new Hono<AppEnv>();
export const discovery = new Hono<AppEnv>();

interface SourceRow {
  id: number;
  kind: SourceKind;
  identifier: string;
  name: string;
  enabled: number;
  last_run_at: string | null;
  last_status: "ok" | "error" | null;
  last_error: string | null;
  last_found: number;
  job_count: number;
}

/** Sources with their open, in-search-area job counts. `tail` is appended after FROM (WHERE / ORDER BY). */
async function querySources(db: D1Database, tail: string, ...binds: (string | number)[]): Promise<SourceRow[]> {
  const scope = visibleFilter();
  const { results } = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM jobs j WHERE j.source_id = s.id AND j.closed_at IS NULL AND j.duplicate_of IS NULL${scope ? ` AND ${scope.sql}` : ""}) AS job_count
       FROM sources s ${tail}`,
    )
    .bind(...(scope?.params ?? []), ...binds)
    .all<SourceRow>();
  return results;
}

function toSource(r: SourceRow): Source {
  return {
    id: r.id,
    kind: r.kind,
    identifier: r.identifier,
    name: r.name,
    enabled: r.enabled === 1,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastError: r.last_error,
    lastFound: r.last_found,
    jobCount: r.job_count,
  };
}

type AddableKind = Exclude<SourceKind, "manual">;

const ADDABLE_KINDS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "catapa", "themuse", "himalayas"] as const satisfies readonly AddableKind[];

const DESCRIPTIONS: Record<AddableKind, string> = {
  greenhouse: "Greenhouse board",
  lever: "Lever board",
  ashby: "Ashby board",
  smartrecruiters: "SmartRecruiters company",
  workable: "Workable account",
  catapa: "CATAPA career page",
  themuse: "The Muse category",
  himalayas: "Himalayas country",
};

/** Accepts a board token or a pasted board URL, e.g. https://boards.greenhouse.io/stripe. */
function parseIdentifier(kind: SourceKind, input: string): string {
  const value = input.trim();
  const patterns: Partial<Record<SourceKind, RegExp>> = {
    greenhouse: /greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i,
    lever: /lever\.co\/([\w.-]+)/i,
    ashby: /ashbyhq\.com\/([^/?#]+)/i,
    smartrecruiters: /(?:jobs|careers)\.smartrecruiters\.com\/([\w.-]+)/i,
    workable: /apply\.workable\.com\/([\w-]+)|([\w-]+)\.workable\.com/i,
    catapa: /career\.catapa\.com\/([\w-]+)/i,
  };
  const match = patterns[kind]?.exec(value);
  const captured = match?.slice(1).find(Boolean);
  return captured ? decodeURIComponent(captured) : value;
}

sources.get("/", async (c) => {
  const results = await querySources(c.env.DB, "ORDER BY s.kind = 'manual', s.name COLLATE NOCASE");
  return c.json(results.map(toSource));
});

const CreateBody = z.object({
  kind: z.enum(ADDABLE_KINDS),
  identifier: z.string().trim().min(1).max(200),
});

sources.post("/", async (c) => {
  const body = await readJson(c, CreateBody);
  const identifier = parseIdentifier(body.kind, body.identifier);
  const adapter = adapterFor(body.kind)!;
  let name: string;
  try {
    name = await adapter.resolveName(identifier);
  } catch {
    throw new HTTPException(422, { message: `Couldn't find a ${DESCRIPTIONS[body.kind]} called “${identifier}”.` });
  }
  const db = c.env.DB;
  const row = await db
    .prepare("INSERT INTO sources (kind, identifier, name) VALUES (?, ?, ?) ON CONFLICT (kind, identifier) DO NOTHING RETURNING id")
    .bind(body.kind, identifier, name)
    .first<{ id: number }>();
  if (!row) throw new HTTPException(409, { message: `${name} is already a source.` });
  await eventStmt(db, "source", row.id, "created", { kind: body.kind, identifier }).run();
  const [created] = await querySources(db, "WHERE s.id = ?", row.id);
  return c.json(toSource(created!), 201);
});

sources.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await readJson(c, z.object({ enabled: z.boolean().optional(), name: z.string().trim().min(1).max(200).optional() }));
  const db = c.env.DB;
  const current = await db.prepare("SELECT kind, enabled, name FROM sources WHERE id = ?").bind(id).first<{ kind: SourceKind; enabled: number; name: string }>();
  if (!current) throw notFound("Source");
  if (current.kind === "manual") throw new HTTPException(400, { message: "The manual source can't be changed." });
  const stmts: D1PreparedStatement[] = [];
  if (body.enabled !== undefined && body.enabled !== (current.enabled === 1)) {
    stmts.push(db.prepare("UPDATE sources SET enabled = ? WHERE id = ?").bind(body.enabled ? 1 : 0, id));
    stmts.push(eventStmt(db, "source", id, body.enabled ? "enabled" : "disabled"));
  }
  if (body.name && body.name !== current.name) stmts.push(db.prepare("UPDATE sources SET name = ? WHERE id = ?").bind(body.name, id));
  if (stmts.length) await db.batch(stmts);
  const [updated] = await querySources(db, "WHERE s.id = ?", id);
  return c.json(toSource(updated!));
});

sources.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = c.env.DB;
  const current = await db.prepare("SELECT kind, name FROM sources WHERE id = ?").bind(id).first<{ kind: SourceKind; name: string }>();
  if (!current) throw notFound("Source");
  if (current.kind === "manual") throw new HTTPException(400, { message: "The manual source can't be removed." });
  // Jobs stay (source_id becomes NULL) so tracked applications and history are preserved.
  await db.batch([db.prepare("DELETE FROM sources WHERE id = ?").bind(id), eventStmt(db, "source", id, "deleted", { name: current.name })]);
  return c.body(null, 204);
});

/** A manual check also classifies what it found, so the results are ready to review. */
async function checkNow(env: Env, sourceIds?: number[]) {
  const run = await runDiscovery(env, { trigger: "manual", sourceIds });
  const eligibility = await classifyPending(env, { modelBudget: intVar(env.ELIGIBILITY_MODEL_CALLS_PER_RUN, 20, 0, 200) });
  return { ...run, classified: eligibility.classified };
}

sources.post("/:id/run", async (c) => c.json(await checkNow(c.env, [idParam(c)])));

discovery.post("/run", async (c) => c.json(await checkNow(c.env)));

/** Starts a refresh cycle now instead of waiting for the next one to be due. */
discovery.post("/refresh", async (c) => c.json(await runScheduledRefresh(c.env, { trigger: "manual", force: true })));

discovery.get("/cycles", async (c) => c.json(await listCycles(c.env.DB)));

/** Big tech career pages that aren't crawled (config/watchlist.json): checked by hand, postings imported by URL or pasted. */
discovery.get("/watchlist", (c) => c.json(watchlist.sites));

discovery.get("/runs", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM discovery_runs ORDER BY id DESC LIMIT 20").all<{
    id: number;
    trigger: "cron" | "manual";
    started_at: string;
    finished_at: string | null;
    sources_checked: number;
    jobs_seen: number;
    jobs_new: number;
    errors: string;
  }>();
  return c.json(
    results.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      sourcesChecked: r.sources_checked,
      jobsSeen: r.jobs_seen,
      jobsNew: r.jobs_new,
      errors: parseJson(r.errors, []),
    })),
  );
});
