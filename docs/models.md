# Models

All generation runs on open-weight models by default, and you pick the model per document: the job page's
**Application Materials** section has a **Model** menu (remembered in your browser) that applies to role analysis, the
CV, the cover letter and answers. The menu is [`config/models.json`](../config/models.json); the default is the
`AI_MODEL` var in `wrangler.jsonc`. Options whose API key isn't set are hidden.

| Option | Where | Measured (2026-09-28) | Use it when |
| --- | --- | --- | --- |
| **gpt-oss-120b** (default) | Workers AI | 7–30 s per step, about 3 minutes for a CV and cover letter | Everyday use. Free, but the Workers AI allowance (10,000 neurons a day, reset 07:00 WIB) covers roughly 1–3 jobs a day. |
| **GLM-5.3-Flash** | NVIDIA free API (`LLM_API_KEY`) | 1–5 minutes per step on the free queue, sometimes a 504 | The letter matters most and you can wait. No daily cap. |
| **GLM-5.3** | NVIDIA free API (`LLM_API_KEY`) | No response within 4 minutes in testing | Only to retry later; falls back to gpt-oss-120b. |
| **Claude Opus 5** | Anthropic (`ANTHROPIC_API_KEY`, paid) | not tested | Paid; the only option with cited company research. |

Each step asks for a tier: **strong** (role analysis, evidence judge, CV plan, letter plan/write/critique/revise,
review) or **fast** (claim verification, eligibility extraction). An option's `strong` and `fast` models run first;
a null `fast` uses Workers AI's `WORKERS_AI_FAST_MODEL` (Qwen3-30B, 1–2 s). Every option falls back to Workers AI
(`WORKERS_AI_STRONG_MODEL` / `WORKERS_AI_FAST_MODEL`) when its API fails or times out. Embeddings always use
`EMBEDDING_MODEL` (bge-m3) on Workers AI. Background eligibility checks use the `AI_MODEL` default.

Every reply is validated against a zod schema. Because open models don't all enforce JSON schemas, the schema is also
in the prompt, reasoning blocks and code fences are stripped, and an invalid reply gets one repair attempt before the
next route is tried. Transient Workers AI errors (1031, 3040) are retried with backoff, and a call that doesn't answer
within 5 minutes (Workers AI) or 8 minutes (other APIs) fails over instead of hanging. gpt-oss runs with
`reasoning_effort: "low"` on Workers AI: at the default "medium", the CV plan ran past 5 minutes.

Each Workers AI call logs its neuron cost (`ai.neurons`), so you can see what a job costs against the free allowance.

### What testing on 2026-09-28 changed

The plan was GLM-5.3 for writing. On NVIDIA's free tier it didn't return a single token within 4 minutes, streaming or
not, and neither did Kimi K3, DeepSeek V4.1 Flash or Gemma 4 31B; Kimi K2.6 wasn't available to the account.
GLM-5.3-Flash answered, in 60–100 s per call, with good prose. Even Flash was too slow for everyday use (a
full CV and letter would take 20+ minutes), and Groq's free tier caps at 8,000 tokens a minute, below the size of a
single step here. So the default is gpt-oss-120b on Workers AI, and the NVIDIA models are opt-in from the menu.

## Why these models (September 2026)

Chosen from a web search of current open-weight rankings, filtered by what can actually run for free from a
Cloudflare Worker:

- **GLM-5.3** (Z.ai) was the strongest open-weight model overall and for writing in the September 2026 roundups, and
  the GLM line has the best open creative-writing record (GLM-5.2 topped EQ-Bench Creative Writing v3 among open
  weights). The writing steps matter most here. NVIDIA's API serves it free (40 requests/minute, phone verification,
  no card), which fits a personal pipeline. Licence: a custom GLM-5.3 licence, free to use and modify for anyone
  except model-hosting companies over US$10B in revenue. **GLM-5.3-Flash** is plain MIT.
- **Kimi K3** and **DeepSeek V4.1 Flash** are also on NVIDIA's free list and are the next picks: add
  an option to `config/models.json` with `moonshotai/kimi-k3` or `deepseek-ai/deepseek-v4.1-flash` as `strong`.
- **gpt-oss-120b** (Apache 2.0) is the fallback: already available through the Worker's AI binding with no extra
  account, at roughly 600 neurons for a large call. The free 10,000 neurons a day cover about one full CV + cover
  letter. It's noticeably slower (1–2 minutes per large call in testing) and a weaker writer.
- **GLM-5.3 on Workers AI** was considered and rejected as the default: about 2,700 neurons per large call, so the
  free allowance runs out after three or four calls.
- **Ollama** doesn't fit the deployed app (a Worker can't reach your laptop), and a 16 GB M4 tops out around
  gpt-oss-20b. For local experiments add an `openai` option with `baseUrl` `http://localhost:11434/v1`
  (any non-empty key); `npm run dev` can then use it.
- **bge-m3** (MIT) for embeddings: multilingual, so Bahasa Indonesia postings match English CV evidence, and nearly
  free (about 1,000 neurons per million tokens).

Sources: [Thunder Compute: best open-source LLMs (Sept 2026)](https://www.thundercompute.com/blog/best-open-source-llms),
[BenchLM: best LLMs for writing](https://benchlm.ai/best/writing),
[The New Stack on the GLM-5.3 licence](https://thenewstack.io/zai-glm-weights-license/),
[Kimi K3 licence](https://huggingface.co/moonshotai/Kimi-K3/blob/main/LICENSE),
[free LLM API tiers compared](https://continuumcode.ai/guides/free-llm-api/),
[NVIDIA NIM free API](https://build.nvidia.com/models),
[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
The live NVIDIA model list is at `https://integrate.api.nvidia.com/v1/models`; free-tier terms change often, so check
it when something stops working.

## Adding or changing a model

Add an entry to [`config/models.json`](../config/models.json):

```json
{
  "id": "groq-gpt-oss",
  "label": "gpt-oss-120b",
  "host": "Groq",
  "note": "What to expect, shown under the menu.",
  "provider": "openai",
  "baseUrl": "https://api.groq.com/openai/v1",
  "keyEnv": "GROQ_API_KEY",
  "strong": "openai/gpt-oss-120b",
  "fast": null
}
```

`provider` is `workers-ai`, `openai` (any OpenAI-compatible API: NVIDIA, OpenRouter, Groq, a local Ollama at
`http://localhost:11434/v1`) or `claude`. Put the key in `.dev.vars` (and `wrangler secret put` in production) under the
name in `keyEnv`. Change the default with `AI_MODEL`. Compare outputs with the evaluation set
(`node scripts/eval.mjs <label> --docs`).
