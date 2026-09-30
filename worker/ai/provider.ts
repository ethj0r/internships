// LLM access behind a few functions, on open-weight models by default.
//
// Which model runs is a choice from config/models.json: the default is the AI_MODEL var, and each generation request
// can pick another (withModel). Every step asks for a tier: "strong" (role analysis, matching, writing, critique) or
// "fast" (claim checks, eligibility). A tier resolves to an ordered list of routes: the chosen option's model, then
// Workers AI (WORKERS_AI_STRONG_MODEL / WORKERS_AI_FAST_MODEL) as a fallback.
//
// Open models don't all enforce JSON schemas, so the schema is also given in the prompt, the reply is parsed
// leniently (reasoning blocks and code fences removed), validated with zod, and repaired once before failing over.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import modelConfig from "../../config/models.json";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type ModelTier = "strong" | "fast";
type ProviderKind = "openai" | "workers-ai" | "claude";

export interface ModelOption {
  id: string;
  label: string;
  host: string;
  note: string;
  provider: ProviderKind;
  baseUrl?: string;
  /** Name of the secret holding the API key. Options without their key are unavailable. */
  keyEnv?: string;
  strong: string;
  fast: string | null;
}

const OPTIONS = modelConfig.options as ModelOption[];

interface Route {
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  key?: string;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 429 | 500 | 502 = 502,
  ) {
    super(message);
  }
}

/** A failure the next route may not have: network errors, rate limits, server errors, unreadable output. */
class RouteError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

function secret(env: Env, name: string | undefined): string {
  return name ? String((env as unknown as Record<string, unknown>)[name] ?? "").trim() : "";
}

function available(env: Env, o: ModelOption): boolean {
  return !o.keyEnv || Boolean(secret(env, o.keyEnv));
}

/** Options the user can pick right now (their API key is set), default first. */
export function modelOptions(env: Env): (ModelOption & { isDefault: boolean })[] {
  const current = activeModel(env).id;
  return OPTIONS.filter((o) => available(env, o)).map((o) => ({ ...o, isDefault: o.id === current }));
}

/** The option in effect: the request's choice (withModel) or the AI_MODEL default, else the first available one. */
export function activeModel(env: Env): ModelOption {
  const wanted = OPTIONS.find((o) => o.id === env.AI_MODEL && available(env, o));
  return wanted ?? OPTIONS.find((o) => available(env, o)) ?? OPTIONS[0]!;
}

/** An env whose model is the given option, for one request. Unknown or unavailable ids are rejected. */
export function withModel(env: Env, id: string | undefined): Env {
  if (!id) return env;
  const option = OPTIONS.find((o) => o.id === id);
  if (!option) throw new AiError(`Unknown model "${id}".`, 400);
  if (!available(env, option)) throw new AiError(`${option.label} needs the ${option.keyEnv} secret, which isn't set.`, 400);
  return { ...env, AI_MODEL: id };
}

export function usesClaude(env: Env): boolean {
  return activeModel(env).provider === "claude";
}

function routes(env: Env, tier: ModelTier): Route[] {
  const o = activeModel(env);
  const workersAi: Route = { provider: "workers-ai", model: tier === "strong" ? env.WORKERS_AI_STRONG_MODEL : env.WORKERS_AI_FAST_MODEL };
  const model = tier === "strong" ? o.strong : o.fast;
  if (!model) return [workersAi];
  const primary: Route = { provider: o.provider, model, baseUrl: o.baseUrl, key: secret(env, o.keyEnv) };
  return primary.provider === "workers-ai" && primary.model === workersAi.model ? [primary] : [primary, workersAi];
}

function routeName(r: Route): string {
  const model = r.model.split("/").pop();
  return r.provider === "claude" ? `Claude (${model})` : r.provider === "workers-ai" ? `Workers AI (${model})` : `${model}`;
}

/** The writing model, for display. */
export function aiProviderName(env: Env): string {
  const o = activeModel(env);
  return `${o.label} (${o.host})`;
}

/** Prompts are compacted on Workers AI, to stay inside the daily free allowance. */
export function compactPrompts(env: Env): boolean {
  return routes(env, "strong")[0]!.provider === "workers-ai";
}

/** zod → JSON Schema with `additionalProperties: false` and every property required (structured-output rules). */
function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.type === "object" && o.properties && typeof o.properties === "object") {
      o.additionalProperties = false;
      o.required = Object.keys(o.properties);
    }
    Object.values(o).forEach(visit);
  };
  visit(json);
  return json;
}

function jsonInstructions(schema: Record<string, unknown>): string {
  return `\n\nOutput format: reply with one JSON object and nothing else (no prose, no code fences). It must match this JSON Schema exactly, with every property present:\n${JSON.stringify(schema)}`;
}

/** Pulls the JSON object out of a model reply: drops reasoning blocks and code fences, then parses the outermost object. */
export function parseModelJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new RouteError("The model didn't return JSON.");
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new RouteError("The model returned invalid JSON.");
    }
  }
}

interface CallOptions {
  tier: ModelTier;
  temperature?: number;
}

export async function generateJson<S extends z.ZodType>(
  env: Env,
  request: { system: string; prompt: string; schema: S; tier?: ModelTier; temperature?: number },
): Promise<{ data: z.infer<S>; generator: string }> {
  const tier = request.tier ?? "strong";
  const jsonSchema = toStrictJsonSchema(request.schema);
  const failures: string[] = [];
  for (const route of routes(env, tier)) {
    const started = Date.now();
    try {
      const opts = { tier, temperature: request.temperature };
      let raw = await callRoute(env, route, request.system, request.prompt, jsonSchema, opts);
      let parsed = request.schema.safeParse(raw);
      if (!parsed.success) {
        // One repair attempt on the same model, with the validation errors.
        const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
        const repairPrompt = `${request.prompt}\n\n<previous_reply>\n${JSON.stringify(raw).slice(0, 12_000)}\n</previous_reply>\n\nYour previous reply didn't match the required JSON Schema:\n${issues.map((i) => `- ${i}`).join("\n")}\nReturn the corrected JSON object only.`;
        raw = await callRoute(env, route, request.system, repairPrompt, jsonSchema, opts);
        parsed = request.schema.safeParse(raw);
      }
      if (!parsed.success) throw new RouteError("The model's reply didn't match the expected format.");
      console.log(JSON.stringify({ message: "ai.call", tier, route: routeName(route), ms: Date.now() - started, ok: true }));
      return { data: parsed.data, generator: routeName(route) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(JSON.stringify({ message: "ai.call", tier, route: routeName(route), ms: Date.now() - started, ok: false, error: message }));
      failures.push(`${routeName(route)}: ${message}`);
      if (err instanceof RouteError && !err.retryable) break;
      if (err instanceof AiError && err.status === 500) throw err;
    }
  }
  const rateLimited = failures.some((f) => /429|rate limit/i.test(f));
  throw new AiError(`No model could complete this step. ${failures.join(" · ")}`, rateLimited ? 429 : 502);
}

async function callRoute(env: Env, route: Route, system: string, prompt: string, schema: Record<string, unknown>, opts: CallOptions): Promise<unknown> {
  if (route.provider === "claude") return callClaude(route, system, prompt, schema);
  if (route.provider === "openai") return callOpenAiCompatible(route, system, prompt, schema, opts);
  return callWorkersAi(env, route.model, system, prompt, schema, opts);
}

// ---------- OpenAI-compatible APIs (NVIDIA, Ollama, OpenRouter, Groq…) ----------

type ResponseFormatMode = "json_schema" | "json_object" | "none";
/** What each model accepted last time, so a model without schema support isn't retried every call. */
const formatSupport = new Map<string, ResponseFormatMode>();

async function callOpenAiCompatible(route: Route, system: string, prompt: string, schema: Record<string, unknown>, opts: CallOptions): Promise<unknown> {
  const model = route.model;
  const url = `${(route.baseUrl ?? "").replace(/\/+$/, "")}/chat/completions`;
  const modes: ResponseFormatMode[] = formatSupport.has(model) ? [formatSupport.get(model)!] : ["json_schema", "json_object", "none"];
  for (const mode of modes) {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: system + jsonInstructions(schema) },
        { role: "user", content: prompt },
      ],
      temperature: opts.temperature ?? (opts.tier === "fast" ? 0.1 : 0.4),
      max_tokens: opts.tier === "fast" ? 4096 : 16384,
      stream: false,
    };
    if (mode === "json_schema") body.response_format = { type: "json_schema", json_schema: { name: "output", schema, strict: true } };
    if (mode === "json_object") body.response_format = { type: "json_object" };
    // GLM and gpt-oss style reasoning control; other models ignore it.
    if (/glm|gpt-oss/i.test(model)) body.reasoning_effort = opts.tier === "fast" ? "low" : "high";

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${route.key}`, accept: "application/json" },
        body: JSON.stringify(body),
        // Free tiers queue requests; a strong step can wait minutes before the first token.
        signal: AbortSignal.timeout(opts.tier === "fast" ? 120_000 : 480_000),
      });
    } catch (err) {
      throw new RouteError(`network error (${err instanceof Error ? err.name : "unknown"})`);
    }
    if (res.status === 401 || res.status === 403) throw new AiError("The model API rejected its API key. Update the secret.", 500);
    const text = await res.text();
    if (res.status === 400 || res.status === 422) {
      // Most often an unsupported response_format or parameter: try the next, looser mode.
      if (mode !== "none" && /response_format|json_schema|guided|schema|format|reasoning/i.test(text)) continue;
      throw new RouteError(`${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok) throw new RouteError(`${res.status}: ${text.slice(0, 200)}`);
    formatSupport.set(model, mode);
    let payload: { choices?: { message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string }[] };
    try {
      payload = JSON.parse(text);
    } catch {
      throw new RouteError("unreadable response");
    }
    const choice = payload.choices?.[0];
    const content = choice?.message?.content ?? "";
    if (!content.trim()) throw new RouteError(choice?.finish_reason === "length" ? "ran out of output tokens" : "empty response");
    return parseModelJson(content);
  }
  throw new RouteError("the API rejected every response format");
}

// ---------- Workers AI ----------

/** Text from any Workers AI response shape: { response }, OpenAI-style choices, or Responses-style output items. */
function workersAiText(result: unknown): unknown {
  const r = result as {
    response?: unknown;
    choices?: { message?: { content?: string } }[];
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  } | null;
  if (!r) return "";
  if (r.response !== undefined && r.response !== null) return r.response;
  if (r.choices?.[0]?.message?.content) return r.choices[0].message.content;
  if (Array.isArray(r.output)) {
    return r.output
      .filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? "")
      .join("");
  }
  return "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Upstream hiccups (1031) and busy capacity (3040) usually clear within seconds. */
const TRANSIENT = /1031|3040|capacity|upstream|timed? ?out|503|502/i;

async function callWorkersAi(env: Env, model: string, system: string, prompt: string, schema: Record<string, unknown>, opts: CallOptions): Promise<unknown> {
  // Qwen3 reasons at length by default, which can use up the output budget before any JSON; "/no_think" turns it off.
  const userContent = /qwen3/i.test(model) ? `${prompt}\n\n/no_think` : prompt;
  const messages = [
    { role: "system", content: system + jsonInstructions(schema) },
    { role: "user", content: userContent },
  ];
  const base: Record<string, unknown> = { messages, max_tokens: opts.tier === "fast" ? 4096 : 12000, temperature: opts.temperature ?? (opts.tier === "fast" ? 0.1 : 0.4) };
  // gpt-oss reasons at "medium" by default, which made large steps (the CV plan) run past 5 minutes on Workers AI.
  if (/gpt-oss/i.test(model)) base.reasoning_effort = "low";
  // A Workers AI call can hang without ever returning; give up so the step fails over instead of blocking forever.
  const limitMs = opts.tier === "fast" ? 90_000 : 300_000;
  const run = (input: Record<string, unknown>) =>
    Promise.race([
      (env.AI.run as unknown as (m: string, i: unknown) => Promise<unknown>)(model, input),
      sleep(limitMs).then(() => {
        throw new RouteError(`no response within ${limitMs / 1000}s`, true);
      }),
    ]);
  const runWithRetry = async (input: Record<string, unknown>) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run(input);
      } catch (err) {
        if (attempt >= 2 || err instanceof RouteError || !TRANSIENT.test(String(err))) throw err;
        await sleep(1500 * (attempt + 1));
      }
    }
  };
  let result: unknown;
  try {
    result = await runWithRetry({ ...base, response_format: { type: "json_schema", json_schema: schema } });
  } catch (err) {
    if (err instanceof RouteError) throw err;
    try {
      // Models without JSON mode reject response_format; the schema is in the prompt anyway.
      result = await runWithRetry(base);
    } catch (err) {
      const message = String(err);
      throw new RouteError(/3036|4006|neuron|daily/i.test(message) ? "Workers AI daily allowance used up (429)" : `Workers AI error: ${message.slice(0, 160)}`);
    }
  }
  // Neurons count against the free 10,000 a day; logged so the cost of a job can be measured.
  const neurons = (result as { usage?: { neurons?: number } } | null)?.usage?.neurons;
  if (neurons !== undefined) console.log(JSON.stringify({ message: "ai.neurons", model, neurons: Math.round(neurons) }));
  const choice = (result as { choices?: { finish_reason?: string; message?: { content?: string | null } }[] } | null)?.choices?.[0];
  if (choice && !choice.message?.content && choice.finish_reason === "length") throw new RouteError("ran out of output tokens");
  const response = workersAiText(result);
  if (response && typeof response === "object") return response;
  if (typeof response === "string" && response.trim()) return parseModelJson(response);
  throw new RouteError("empty response");
}

// ---------- Embeddings ----------

/** Embeds texts with the configured open embedding model (bge-m3 by default, multilingual). */
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50).map((t) => t.slice(0, 2000));
    let result: { data?: number[][]; response?: number[][] };
    try {
      result = (await (env.AI.run as unknown as (m: string, i: unknown) => Promise<unknown>)(env.EMBEDDING_MODEL, { text: batch })) as typeof result;
    } catch (err) {
      throw new AiError(`Embedding failed: ${String(err).slice(0, 160)}`);
    }
    const vectors = result.data ?? result.response;
    if (!Array.isArray(vectors) || vectors.length !== batch.length) throw new AiError("The embedding model returned an unexpected response.");
    out.push(...vectors);
  }
  return out;
}

// ---------- Claude (optional) ----------

function toAiError(err: unknown): unknown {
  if (err instanceof AiError || err instanceof RouteError) return err;
  if (err instanceof SyntaxError) return new RouteError("The model returned invalid JSON.");
  if (err instanceof Anthropic.AuthenticationError) return new AiError("ANTHROPIC_API_KEY was rejected. Update the secret.", 500);
  if (err instanceof Anthropic.RateLimitError) return new RouteError("Claude's rate limit was reached (429).");
  if (err instanceof Anthropic.APIError) return new RouteError(`Claude API error (${err.status ?? "network"}).`);
  return err;
}

async function callClaude(route: Route, system: string, prompt: string, schema: Record<string, unknown>): Promise<unknown> {
  const client = new Anthropic({ apiKey: route.key });
  try {
    const stream = client.beta.messages.stream({
      model: route.model,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema } },
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new AiError("Claude declined this request. Edit the document manually or try again.");
    if (message.stop_reason === "max_tokens") throw new RouteError("The response was cut off before it finished.");
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return JSON.parse(text);
  } catch (err) {
    throw toAiError(err);
  }
}

/**
 * Claude with server-side web search and fetch, for research that must cite public sources. Returns every
 * content block so callers can keep only cited statements. Requires Claude; callers check usesClaude() first.
 */
export async function researchWeb(env: Env, request: { system: string; prompt: string }): Promise<Anthropic.Beta.BetaContentBlock[]> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: request.prompt }];
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  try {
    // Long server-tool turns stop with "pause_turn"; sending the paused turn back resumes it.
    for (let turn = 0; turn < 4; turn++) {
      const message = await client.beta.messages
        .stream({
          model: activeModel(env).strong,
          max_tokens: 16000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          system: request.system,
          messages,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: 6 },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
          ],
        })
        .finalMessage();
      if (message.stop_reason === "refusal") throw new AiError("Claude declined the company research.");
      content.push(...message.content);
      if (message.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: message.content });
    }
    return content;
  } catch (err) {
    const e = toAiError(err);
    throw e instanceof RouteError ? new AiError(e.message) : e;
  }
}
