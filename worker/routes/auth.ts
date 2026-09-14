import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { authConfigured, clearSessionCookie, createSessionCookie, hasValidSession, passwordMatches } from "../lib/auth";
import { readJson, type AppEnv } from "../lib/validate";

export const auth = new Hono<AppEnv>();

const isHttps = (url: string) => new URL(url).protocol === "https:";

auth.get("/session", async (c) =>
  c.json({ authenticated: await hasValidSession(c.env, c.req.header("cookie") ?? null), configured: authConfigured(c.env) }),
);

auth.post("/login", async (c) => {
  if (!authConfigured(c.env)) {
    throw new HTTPException(503, { message: "Sign-in isn't configured. Set the APP_PASSWORD and SESSION_SECRET secrets." });
  }
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: `login:${ip}` });
  if (!success) throw new HTTPException(429, { message: "Too many attempts. Wait a minute and try again." });

  const { password } = await readJson(c, z.object({ password: z.string().min(1).max(500) }));
  if (!(await passwordMatches(c.env, password))) throw new HTTPException(401, { message: "Incorrect password." });

  c.header("Set-Cookie", await createSessionCookie(c.env, isHttps(c.req.url)));
  return c.json({ authenticated: true });
});

auth.post("/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie(isHttps(c.req.url)));
  return c.json({ authenticated: false });
});
