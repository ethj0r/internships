#!/usr/bin/env node
// Runs the evaluation set (eval/postings.json) against a running dev server and saves every output for review.
//
//   npm run dev                      # in another terminal (local D1, remote Workers AI / NIM)
//   node scripts/eval.mjs <label> [--docs] [--only 2,45] [--model workers-gpt-oss]
//
// Without --docs it only records eligibility and priority (no writing-model calls). Outputs go to eval/runs/<label>/,
// which is git-ignored because it contains your CV.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "undici";

// A full CV plus letter can take many minutes on slower free models; Node's fetch would give up after 5.
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.EVAL_BASE_URL ?? "http://localhost:5173/api";
const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const withDocs = args.includes("--docs");
const onlyArg = args[args.indexOf("--only") + 1];
const only = args.includes("--only") && onlyArg ? new Set(onlyArg.split(",").map(Number)) : null;
// A model option id from config/models.json (GET /api/models); the server default when omitted.
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;

async function password() {
  if (process.env.APP_PASSWORD) return process.env.APP_PASSWORD;
  const vars = await readFile(join(root, ".dev.vars"), "utf8");
  return vars.match(/^APP_PASSWORD=(.*)$/m)?.[1]?.trim() ?? "";
}

let cookie = "";
async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-requested-with": "fetch", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    dispatcher,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error ?? JSON.stringify(data)}`);
  return data;
}

async function timed(fn) {
  const start = Date.now();
  const value = await fn();
  return { value, seconds: Math.round((Date.now() - start) / 1000) };
}

const set = JSON.parse(await readFile(join(root, "eval/postings.json"), "utf8"));
const out = join(root, "eval/runs", label);
await mkdir(out, { recursive: true });
await api("POST", "/auth/login", { password: await password() });

const summary = [];
for (const posting of set.postings) {
  if (only && !only.has(posting.jobId)) continue;
  const job = await api("GET", `/jobs/${posting.jobId}`);
  const row = {
    jobId: posting.jobId,
    company: job.company,
    title: job.title,
    location: job.location,
    expected: posting.expectedStatus,
    eligibility: job.eligibility?.status ?? null,
    reason: job.eligibility?.reason ?? null,
    tier: job.priorityTier ?? null,
    season: job.season ?? null,
    timezoneNote: job.eligibility?.timezoneNote ?? null,
    workAuthorizationNote: job.eligibility?.workAuthorizationNote ?? null,
  };
  if (withDocs && posting.generate) {
    try {
      const cv = await timed(() => api("POST", "/documents/tailor", { jobId: posting.jobId, model }));
      const cvDoc = await api("GET", `/documents/${cv.value.id}`);
      await writeFile(join(out, `${posting.jobId}-cv.tex`), cvDoc.content);
      await writeFile(join(out, `${posting.jobId}-cv.meta.json`), JSON.stringify(cvDoc.meta, null, 2));
      const letter = await timed(() => api("POST", "/documents/cover-letter", { jobId: posting.jobId, model }));
      const letterDoc = await api("GET", `/documents/${letter.value.id}`);
      await writeFile(join(out, `${posting.jobId}-letter.md`), letterDoc.content);
      await writeFile(join(out, `${posting.jobId}-letter.meta.json`), JSON.stringify(letterDoc.meta, null, 2));
      Object.assign(row, {
        cvSeconds: cv.seconds,
        cvVerdict: cvDoc.meta.review?.verdict ?? null,
        cvGenerator: cvDoc.meta.generator,
        letterSeconds: letter.seconds,
        letterVerdict: letterDoc.meta.review?.verdict ?? null,
        letterWords: letterDoc.content.split(/\s+/).filter(Boolean).length,
        letterGenerator: letterDoc.meta.generator,
      });
    } catch (err) {
      row.error = String(err.message ?? err);
    }
  }
  summary.push(row);
  console.log(JSON.stringify(row));
}
await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nSaved to eval/runs/${label}/`);
