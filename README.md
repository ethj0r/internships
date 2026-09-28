# Internships

A personal internship search and application tracker. It finds new software internships across company career
boards, ranks them against your skills and CV, tailors your CV and cover letter for the ones you choose, and keeps
your whole pipeline, from first look to offer, in one place. You stay in control of every application.

Built on Cloudflare Workers, D1 and Workers AI (optionally Claude), with a React interface that follows Apple's Human Interface Guidelines.

## What it does

- **Discover.** Checks company boards on Greenhouse, Lever, Ashby, SmartRecruiters, Workable and CATAPA, plus The Muse and Himalayas, every hour for software, backend, frontend, full-stack, AI/ML and data internships. Defaults to Asia: anything in Indonesia, plus remote roles open to Indonesia (GDP Labs, Grab, Xendit, Mercari, Carousell…). Skips duplicates, including the same role listed on two platforms.
- **Match.** Scores every posting 0–100 on skills, role, location and eligibility, and explains why: matching skills, missing requirements, concerns such as graduation year, sponsorship or PhD-only roles.
- **Track.** A pipeline from Interested to Preparing, Ready to Apply, Applied, Interview, and Offer or Rejected, with priority, notes, deadlines, reminders and a full history.
- **Tailor.** Analyzes what each role really evaluates, maps your evidence to every requirement (strong, relevant, transferable, weak, gap), and tailors your CV in your LaTeX résumé template with a before/after for every bullet (download the `.tex`, open it in Overleaf, or print a matching PDF). Cover letters build a narrative from the team's need to your experience, using only cited company facts. Every claim traces to your CV or career knowledge base, and each draft passes a quality review before you see it. See [docs/personalization.md](docs/personalization.md).
- **Apply.** An Apply Kit with your approved CV (save as PDF), cover letter, copy-ready answers, the application link and a checklist. You submit on the company's site, then confirm. Nothing is ever submitted for you.

## Tech stack

| Layer | Technology |
| --- | --- |
| Hosting, API, cron | Cloudflare Workers, Hono, Cron Triggers |
| Database | Cloudflare D1 (SQLite) |
| AI | Claude `claude-opus-5` if `ANTHROPIC_API_KEY` is set, otherwise Workers AI; Workers AI for PDF/DOCX conversion |
| Web app | React 19, React Router 7, Vite, hand-written CSS design system |
| Tooling | TypeScript, zod, Vitest, Wrangler |

See [docs/architecture.md](docs/architecture.md) for the design decisions, schema and module boundaries.

## Getting started

Requirements: Node.js 22+, a Cloudflare account (for Workers AI during development; everything else runs locally).

```bash
git clone https://github.com/ethj0r/internships.git
cd internships
npm install

cp .dev.vars.example .dev.vars    # then set APP_PASSWORD and SESSION_SECRET
npx wrangler login                # Workers AI runs remotely, even in development
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173 and sign in with your `APP_PASSWORD`. Then:

1. **Documents** → add your master CV (PDF, DOCX, Markdown, or paste text).
2. **Profile** → skills, target roles, locations, graduation date.
3. **Sources** → **Check Now** to run discovery immediately.

To trigger the scheduled handler locally, run `npx wrangler dev --test-scheduled` after `npm run build` and open
`http://localhost:8787/__scheduled?cron=0+*+*+*+*`.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Web app and Worker with hot reload (local D1) |
| `npm test` | Unit tests |
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
| `ANTHROPIC_API_KEY` | Secret | No | Enables Claude for analysis and writing. Without it, Workers AI is used. |
| `AI_PROVIDER` | Var | No | `auto` (default) or `workers-ai`. |
| `DISCOVERY_SOURCES_PER_RUN` | Var | No | Sources checked per hourly run. Default `6`. |
| `DISCOVERY_MAX_DETAIL_FETCHES` | Var | No | Full-description fetches per run. Default `25`. |

## Deployment

```bash
npx wrangler d1 create internships        # put the database_id in wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put APP_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ANTHROPIC_API_KEY  # optional
npm run deploy
```

Details, limits and hardening (custom domain, Cloudflare Access): [docs/deployment.md](docs/deployment.md).

## Project structure

```
migrations/   D1 schema and default sources
shared/       Types and skill/role taxonomies shared by Worker and web app
worker/       API (Hono), discovery adapters, matching, AI and document generation, cron
src/          React app: pages, components, design tokens
test/         Unit tests
docs/         Architecture, data sources, automation, API, deployment, design system
```

## Documentation

- [Architecture](docs/architecture.md): stack, modules, schema, matching, Cloudflare services
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
