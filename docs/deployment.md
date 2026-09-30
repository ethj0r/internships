# Deployment

The whole app deploys as one Cloudflare Worker with static assets, a D1 database, Workers AI and two cron triggers.

## Prerequisites

- A Cloudflare account (the Workers Free plan works for personal use; see limits below)
- Node.js 22+
- `npx wrangler login`

## First deployment

```bash
npm install

# 1. Create the database and copy the printed database_id into wrangler.jsonc
npx wrangler d1 create internships

# 2. Apply the schema and default sources
npm run db:migrate:remote

# 3. Set secrets (you'll be prompted for each value)
npx wrangler secret put APP_PASSWORD
npx wrangler secret put SESSION_SECRET      # 32+ random characters
npx wrangler secret put LLM_API_KEY         # optional, adds the NVIDIA models to the model menu
npx wrangler secret put ANTHROPIC_API_KEY   # optional, paid, adds Claude

# 4. Build and deploy
npm run deploy
```

Wrangler prints the URL, for example `https://internships.<your-subdomain>.workers.dev`.
Sign in with `APP_PASSWORD`, add your master CV under **Documents**, fill in **Profile**, then open **Sources** and choose **Check Now**.

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Updating

```bash
npm run db:migrate:remote   # only when migrations/ changed
npm run deploy
```

Roll back with `npx wrangler rollback`. View logs with `npx wrangler tail`.

## Scheduled jobs

Defined in `wrangler.jsonc`:

| Cron | Job |
| --- | --- |
| `0 * * * *` | Refresh cycles: starts a cycle every `REFRESH_INTERVAL_HOURS`, checks the next `DISCOVERY_SOURCES_PER_RUN` sources of the running cycle, classifies eligibility; idle otherwise |
| `0 7 * * *` | Deadline reminders |

Test locally with `npx wrangler dev --test-scheduled` and `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"`.

## Configuration

| Variable | Kind | Default | Purpose |
| --- | --- | --- | --- |
| `APP_PASSWORD` | Secret | — | Owner password. Required. |
| `SESSION_SECRET` | Secret | — | HMAC key for session cookies, 16+ characters (32+ recommended). Changing it signs everyone out. |
| `LLM_API_KEY` | Secret | — | Optional. NVIDIA free API key; adds GLM-5.3-Flash and GLM-5.3 to the model menu. |
| `ANTHROPIC_API_KEY` | Secret | — | Optional, paid. Adds Claude to the model menu. |
| `AI_MODEL` | Var | `workers-gpt-oss` | Default model option from `config/models.json`; each document can pick another in the app. See [models.md](models.md). |
| `REFRESH_INTERVAL_HOURS` | Var | `72` | Hours between refresh cycles. |
| `ELIGIBILITY_MODEL_CALLS_PER_RUN` | Var | `20` | Fast-model eligibility checks per cron run. |
| `DISCOVERY_SOURCES_PER_RUN` | Var | `8` | Sources checked per hourly run during a refresh cycle. |
| `DISCOVERY_MAX_DETAIL_FETCHES` | Var | `25` | Full-description fetches per run (Greenhouse). |

## Limits and plans

- **Free plan**: 50 subrequests and 10 ms CPU per invocation. Discovery waits on network I/O (which doesn't count toward CPU), but parsing very large boards can exceed 10 ms. If runs fail with CPU errors, lower `DISCOVERY_SOURCES_PER_RUN` to 2–3 or use the Paid plan.
- **Paid plan** ($5/month): 1,000 subrequests and up to 5 minutes CPU. Recommended if you add many sources.
- **Workers AI**: 10,000 neurons/day free, then usage-based. Claude usage is billed by Anthropic.
- **D1**: free tier is far beyond what a personal tracker uses.

## Custom domain and extra protection

- Add a custom domain under the Worker's **Settings → Domains & Routes**.
- For defense in depth, protect the hostname with **Cloudflare Access** (Zero Trust → Access → Applications) so only your identity can reach the login page. Exclude nothing: cron triggers don't go through HTTP.

## CI

`.github/workflows/ci.yml` typechecks, tests and builds on every push. To deploy from CI, add a
`CLOUDFLARE_API_TOKEN` secret (Workers Scripts:Edit, D1:Edit) and run `npm run deploy` in a job on `main`.
