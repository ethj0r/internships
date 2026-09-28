import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AiError } from "./ai/provider";
import { runDiscovery } from "./discovery/run";
import { hasValidSession } from "./lib/auth";
import type { AppEnv } from "./lib/validate";
import { runDeadlineReminders } from "./notifications";
import { activity } from "./routes/activity";
import { applications } from "./routes/applications";
import { auth } from "./routes/auth";
import { documents } from "./routes/documents";
import { jobs } from "./routes/jobs";
import { knowledge } from "./routes/knowledge";
import { profile } from "./routes/profile";
import { discovery, sources } from "./routes/sources";

const DEADLINE_CRON = "0 7 * * *";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);

// Everything below requires a session. Mutations also require a custom header,
// which cross-site forms can't send (defense in depth on top of SameSite=Strict).
app.use("*", async (c, next) => {
  if (!(await hasValidSession(c.env, c.req.header("cookie") ?? null))) {
    throw new HTTPException(401, { message: "Sign in to continue." });
  }
  if (c.req.method !== "GET" && c.req.header("x-requested-with") !== "fetch") {
    throw new HTTPException(403, { message: "Request blocked." });
  }
  await next();
});

app.route("/jobs", jobs);
app.route("/applications", applications);
app.route("/documents", documents);
app.route("/profile", profile);
app.route("/knowledge", knowledge);
app.route("/sources", sources);
app.route("/discovery", discovery);
app.route("/", activity);

app.notFound((c) => c.json({ error: "Not found." }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  if (err instanceof AiError) return c.json({ error: err.message }, err.status);
  console.error(JSON.stringify({ message: "api.unhandled", method: c.req.method, path: c.req.path, error: err instanceof Error ? (err.stack ?? err.message) : String(err) }));
  return c.json({ error: "Something went wrong. Try again." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env) {
    if (controller.cron === DEADLINE_CRON) await runDeadlineReminders(env);
    else await runDiscovery(env, { trigger: "cron" });
  },
} satisfies ExportedHandler<Env>;
