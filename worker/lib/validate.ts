import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

export type AppEnv = { Bindings: Env };

export async function readJson<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Expected a JSON body." });
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".");
    throw new HTTPException(400, { message: issue ? `${field ? `${field}: ` : ""}${issue.message}` : "Invalid request." });
  }
  return result.data;
}

export function idParam(c: Context<AppEnv>, name = "id"): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw new HTTPException(400, { message: "Invalid id." });
  return n;
}

export function notFound(what: string): HTTPException {
  return new HTTPException(404, { message: `${what} not found.` });
}
