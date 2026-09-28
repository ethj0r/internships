// LLM access behind a few functions. Claude is used when ANTHROPIC_API_KEY is configured;
// otherwise Workers AI (no extra credentials needed on Cloudflare).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const CLAUDE_MODEL = "claude-opus-5";
export const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 500 | 502 = 502,
  ) {
    super(message);
  }
}

export function usesClaude(env: Env): boolean {
  if (env.AI_PROVIDER === "workers-ai") return false;
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function aiProviderName(env: Env): string {
  return usesClaude(env) ? `Claude (${CLAUDE_MODEL})` : `Workers AI (${WORKERS_AI_MODEL.split("/").pop()})`;
}

/** Workers AI models have a much smaller context window, so prompts are compacted for them. */
export function compactPrompts(env: Env): boolean {
  return !usesClaude(env);
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

export async function generateJson<S extends z.ZodType>(
  env: Env,
  request: { system: string; prompt: string; schema: S },
): Promise<{ data: z.infer<S>; generator: string }> {
  const jsonSchema = toStrictJsonSchema(request.schema);
  const raw = usesClaude(env)
    ? await callClaude(env, request.system, request.prompt, jsonSchema)
    : await callWorkersAi(env, request.system, request.prompt, jsonSchema);
  const parsed = request.schema.safeParse(raw);
  if (!parsed.success) {
    console.error(JSON.stringify({ message: "ai.schema_mismatch", issues: parsed.error.issues.slice(0, 5) }));
    throw new AiError("The model returned an unexpected format. Try again.");
  }
  return { data: parsed.data, generator: aiProviderName(env) };
}

function toAiError(err: unknown): unknown {
  if (err instanceof AiError) return err;
  if (err instanceof SyntaxError) return new AiError("The model returned invalid JSON. Try again.");
  if (err instanceof Anthropic.AuthenticationError) return new AiError("ANTHROPIC_API_KEY was rejected. Update the secret.", 500);
  if (err instanceof Anthropic.RateLimitError) return new AiError("Claude's rate limit was reached. Try again in a minute.", 429);
  if (err instanceof Anthropic.APIError) return new AiError(`Claude API error (${err.status ?? "network"}). Try again.`);
  return err;
}

async function callClaude(env: Env, system: string, prompt: string, schema: Record<string, unknown>): Promise<unknown> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const stream = client.beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema } },
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new AiError("Claude declined this request. Edit the document manually or try again.");
    }
    if (message.stop_reason === "max_tokens") throw new AiError("The response was cut off before it finished. Try again.");
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
          model: CLAUDE_MODEL,
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
    throw toAiError(err);
  }
}

async function callWorkersAi(env: Env, system: string, prompt: string, schema: Record<string, unknown>): Promise<unknown> {
  let result: unknown;
  try {
    result = await env.AI.run(WORKERS_AI_MODEL, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_schema", json_schema: schema },
      max_tokens: 4096,
      temperature: 0.3,
    });
  } catch (err) {
    console.error(JSON.stringify({ message: "ai.workers_ai_failed", error: String(err) }));
    throw new AiError("Workers AI couldn't complete the request. Try again.");
  }
  const response = (result as { response?: unknown } | null)?.response;
  if (response && typeof response === "object") return response;
  if (typeof response === "string" && response.trim()) {
    try {
      return JSON.parse(response);
    } catch {
      throw new AiError("The model returned invalid JSON. Try again.");
    }
  }
  throw new AiError("Workers AI returned an empty response. Try again.");
}
