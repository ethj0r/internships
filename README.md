# Sietch

A personal internship search and application tracker. It finds new software internships across company career
boards, ranks them against your skills and CV, tailors your CV and cover letter for the ones you choose, and keeps
your whole pipeline, from first look to offer, in one place. You stay in control of every application.

Named after the sietch in *Dune*, the hidden Fremen stronghold where everything needed for the long journey is kept in one place.

Built on Cloudflare Workers and D1 with open-weight models (gpt-oss-120b on Workers AI by default, GLM-5.3-Flash on NVIDIA's free API from a per-document model menu), with a React interface that follows Apple's Human Interface Guidelines.

## What it does

- **Discover.** Checks company boards on Greenhouse, Lever, Ashby, SmartRecruiters, Workable and CATAPA, plus The Muse and Himalayas, every 3 days for software, backend, frontend, full-stack, AI/ML and data internships. Only new or changed postings are processed, duplicates are merged, and closed or expired ones are marked. Big tech career sites that can't be crawled are on a watchlist for manual import.
- **Check eligibility first.** Every posting is classified before any model writes about it: remote and open to Indonesia, on-site in Indonesia, on-site or hybrid in Singapore (with a note on the likely work pass and what to verify), check manually (with the sentence that caused the doubt), or excluded (with the reason). Only eligible or approved postings can be tailored. The shortlist ranks big tech and Summer 2027 first. See [docs/data-sources.md](docs/data-sources.md#eligibility).
- **Match.** Scores every posting 0–100 on skills, role, location and eligibility, and explains why: matching skills, missing requirements, concerns such as graduation year, sponsorship or PhD-only roles.
- **Track.** A pipeline from Interested to Preparing, Ready to Apply, Applied, Interview, and Offer or Rejected, with priority, notes, deadlines, reminders and a full history.
- **Tailor.** Analyzes the role before looking at your CV (core problems, intern scope, unwritten signals), matches requirements to your real experience by meaning (open embeddings plus a judge), and tailors your CV in your LaTeX résumé template by selecting and reordering, never inventing: every rewritten bullet is checked claim by claim against your master CV. Cover letters are written in your voice, rejected and rewritten until they pass mechanical rules (no dashes, semicolons, banned phrases, 200–280 words, a concrete detail per paragraph), then revised once after a skeptical-recruiter critique. See [docs/personalization.md](docs/personalization.md).
- **Apply.** An Apply Kit with your approved CV (save as PDF), cover letter, copy-ready answers, the application link and a checklist. You submit on the company's site, then confirm. Nothing is ever submitted for you.

## Tech stack

| Layer | Technology |
| --- | --- |
| Hosting, API, cron | Cloudflare Workers, Hono, Cron Triggers |
| Database | Cloudflare D1 (SQLite) |
| AI | gpt-oss-120b and Qwen3 on Workers AI (default), GLM-5.3-Flash on NVIDIA's free API, Claude optional, picked per document; bge-m3 embeddings ([docs/models.md](docs/models.md)) |
| Web app | React 19, React Router 7, Vite, hand-written CSS design system |
| Tooling | TypeScript, zod, Vitest, Wrangler |

See [docs/architecture.md](docs/architecture.md) for the design decisions, schema and module boundaries.

## Getting started

Requirements: Node.js 22+, a Cloudflare account (for Workers AI during development; everything else runs locally).

```bash
git clone https://github.com/ethj0r/sietch.git
cd sietch
npm install

cp .dev.vars.example .dev.vars    # then set APP_PASSWORD, SESSION_SECRET and, optionally, LLM_API_KEY
npx wrangler login                # Workers AI runs remotely, even in development
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173 and sign in with your `APP_PASSWORD`. Then:

1. **Documents** → add your master CV (PDF, DOCX, Markdown, or paste text).
2. **Profile** → skills, target roles, locations, graduation date.
3. **Profile** → **Singapore work pass (confirmed only)**: leave empty until a pass is approved.
4. **Sources** → **Refresh Now** to run a refresh cycle immediately.
5. Optional: paste a few things you've written into `voice_samples/` so cover letters sound like you.

To trigger the scheduled handler locally, run `npx wrangler dev --test-scheduled` after `npm run build` and open
`http://localhost:8787/__scheduled?cron=0+*+*+*+*`.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Web app and Worker with hot reload (local D1) |
| `npm test` | Unit tests |
| `node scripts/eval.mjs <label> [--docs] [--only 2,45]` | Run the evaluation set (`eval/postings.json`) against a running dev server; outputs in `eval/runs/<label>/` (git-ignored) |
| `npm run typecheck` | TypeScript across web app, Worker and config |
| `npm run build` | Typecheck and production build |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply D1 migrations |
| `npm run cf-typegen` | Regenerate binding types after changing `wrangler.jsonc` |

## Environment variables

Secrets go in `.dev.vars` locally and `wrangler secret put` in production. Never commit them.

| Name | Kind | Required | Description |
| --- | --- | --- | --- |
| `APP_PASSWORD` | Secret | Yes | Password for the owner account. |
| `SESSION_SECRET` | Secret | Yes | Random string (32+ characters) that signs session cookies. |
| `AI_MODEL` | Var | No | Default model option from `config/models.json`. Default `workers-gpt-oss`. You can pick another per document in the app. |
| `LLM_API_KEY` | Secret | No | NVIDIA free API key (build.nvidia.com). Adds GLM-5.3-Flash and GLM-5.3 to the model menu. |
| `ANTHROPIC_API_KEY` | Secret | No | Adds Claude (paid) to the model menu. |
| `WORKERS_AI_STRONG_MODEL`, `WORKERS_AI_FAST_MODEL`, `EMBEDDING_MODEL` | Var | No | Workers AI models: the default option, the fallback for every option, and embeddings. See [docs/models.md](docs/models.md). |
| `REFRESH_INTERVAL_HOURS` | Var | No | Hours between refresh cycles. Default `72`. |
| `DISCOVERY_SOURCES_PER_RUN` | Var | No | Sources checked per hourly run during a cycle. Default `8`. |
| `ELIGIBILITY_MODEL_CALLS_PER_RUN` | Var | No | Fast-model eligibility checks per run. Default `20`. |
| `DISCOVERY_MAX_DETAIL_FETCHES` | Var | No | Full-description fetches per run. Default `25`. |

## Deployment

```bash
npx wrangler d1 create internships        # put the database_id in wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put APP_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put LLM_API_KEY        # optional: NVIDIA models in the model menu
npm run deploy
```

Details, limits and hardening (custom domain, Cloudflare Access): [docs/deployment.md](docs/deployment.md).

## Project structure

```
migrations/   D1 schema and default sources
config/       Editable settings: model menu, banned phrases, letter rules, company tiers and signals, big tech watchlist
shared/       Types, eligibility rules, priority, skill/role taxonomies shared by Worker and web app
worker/       API (Hono), discovery and refresh cycles, eligibility, matching, AI and document generation, cron
worker/prompts/  Every prompt, as an editable Markdown file
voice_samples/   Your own writing, for the cover letter voice (git-ignored)
eval/, scripts/  Evaluation set and runner
src/          React app: pages, components, design tokens
test/         Unit tests
docs/         Architecture, data sources, automation, API, deployment, design system
```

## Documentation

- [Architecture](docs/architecture.md): stack, modules, schema, matching, Cloudflare services
- [Models](docs/models.md): which open models run each step, why, and how to swap them
- [Personalization](docs/personalization.md): role analysis, semantic matching, CV verification, cover letter lint and critique
- [Data sources](docs/data-sources.md): integrated platforms, excluded platforms and why, adding a source
- [Application automation](docs/automation.md): what can and can't be automated, and the human-in-the-loop flow
- [API](docs/api.md): endpoints
- [Deployment](docs/deployment.md): setup, configuration, limits
- [Design system](docs/design-system.md): typography, color, components, interaction patterns

## Privacy and security

- Single owner. Password login with an HMAC-signed, HttpOnly, SameSite=Strict cookie, rate-limited attempts, and a custom header required on mutations.
- Your CV and profile live in your own D1 database. They're sent to the AI provider only when you analyze a job or generate a document.
- Strict Content Security Policy and security headers on the web app. External links open with `noopener`.
- No personal data, secrets or credentials are committed. `.dev.vars`, local databases and builds are git-ignored.
