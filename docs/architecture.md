# Architecture

This document records the planning decisions behind the MVP: stack, architecture, schema,
data sources, automation feasibility, scope, Cloudflare deployment and repository layout.

## 1. Environment and stack

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | Cloudflare Workers | One deployable unit for API, cron and static assets. No servers. |
| API | [Hono](https://hono.dev) + TypeScript | Small, fast router built for Workers. |
| Frontend | React 19 + React Router 7 (SPA), plain CSS design tokens | A productivity app with no SEO needs; custom CSS keeps full control over the Apple-style design. |
| Build | Vite + `@cloudflare/vite-plugin` | Runs the Worker in `workerd` during development; one `vite build` produces both bundles. |
| Database | Cloudflare D1 (SQLite) | Relational data (jobs, applications, documents, audit log) with migrations. |
| AI | Claude (`claude-opus-5`) when `ANTHROPIC_API_KEY` is set, otherwise Workers AI (`llama-3.3-70b-instruct-fp8-fast`) | Works out of the box on Cloudflare; higher quality writing when a Claude key is added. |
| CV file parsing | Workers AI `toMarkdown` | Converts PDF/DOCX uploads without extra services. |
| Validation | zod | Request bodies and model outputs. |
| Tests | Vitest | Parsing, matching and fabrication checks are pure functions. |

## 2. Application architecture

```mermaid
flowchart LR
  subgraph Worker["Cloudflare Worker (single deployment)"]
    direction TB
    API["Hono API /api/*"]
    Cron["scheduled() handler"]
    subgraph Modules
      D["discovery/\nsource adapters, orchestrator, import"]
      M["matching/\nscore, verify"]
      G["documents/ + ai/\nprompts, provider"]
      T["routes/\napplications, documents, profile, sources"]
    end
    API --> T
    T --> D & M & G
    Cron --> D
    Cron --> N["notifications"]
  end
  SPA["React SPA (static assets)"] -->|fetch /api| API
  D -->|public job-board APIs| Ext["Greenhouse, Lever, Ashby, The Muse"]
  G -->|Anthropic API| Claude
  G -->|binding| WAI["Workers AI"]
  Worker -->|binding| DB[("D1")]
```

Module boundaries follow the product workflow:

- **Discovery** (`worker/discovery`): each platform is a `SourceAdapter` with `list()`, optional
  `hydrate()` and `resolveName()`. The orchestrator filters relevant internships, dedupes, scores and stores.
- **Parsing** (`worker/lib/text.ts`): HTML to Markdown, workplace, deadline and duration detection, fingerprints.
- **Matching** (`worker/matching`): deterministic scoring for every job, plus verification of generated text.
- **Document generation** (`worker/documents`, `worker/ai`): fit analysis, tailored CV, cover letter, answers.
- **Application tracking** (`worker/routes/applications.ts`): pipeline state, apply kit, explicit submission confirmation.
- **Audit trail** (`events` table): every discovery, analysis, generated document and status change.

### Matching

Every job gets an explainable 0–100 score without calling a model:

| Component | Weight | Signal |
| --- | --- | --- |
| Skills | 45% | Required-skill coverage (85%) and preferred-skill coverage (15%). Skills come from the profile and the master CV, using a canonical taxonomy (`shared/skills.ts`). Requirements are split into required and preferred using the description's section headings. |
| Role | 20% | Target roles found in the title (full credit) or description (partial). |
| Location | 15% | Remote / hybrid / on-site preference and preferred locations. |
| Eligibility | 20% | Penalties for PhD-only, master's-only, clearance, citizenship, sponsorship (when needed) and graduation-year mismatches. |

Include keywords add up to 8 points; an exclude keyword caps the score at 15.
On demand, **Analyze Fit** asks the model for a written assessment grounded in the CV.

### CV template

Tailored CVs always use the résumé LaTeX template in [`shared/cvTemplate.ts`](../shared/cvTemplate.ts) (preamble and macros such as
`\resumeSubheadingSpaced`, `\resumeProjectHeadingSpaced`, `\resumeItem`). [`shared/cv.ts`](../shared/cv.ts) parses a master `.tex` written
with those macros into a structured document (header, entries, items, skill lines), and renders structured documents back to LaTeX,
HTML (preview and print) and plain text (matching, diffs, checks).

When the master CV is LaTeX, the model only returns *choices*: which entries to include and in what order, reworded bullets, and the order
of existing skills. `applyTailoring()` applies them to the master, so the header, section titles, organizations, roles, dates, locations and
headings are copied verbatim, unknown entries are ignored, skills not in the master are dropped, and bullet counts can't grow. Masters that
aren't LaTeX (PDF, DOCX, Markdown) are rebuilt into the same template structure from their text, with a warning to upload the `.tex`.

### Preventing fabrication

1. Every prompt includes strict grounding rules: only facts from the master CV and profile, no new metrics or technologies, no inflated scope.
2. Structured output schemas force the model to list its changes (tailored CV) or its evidence for each claim (cover letter, answers).
3. `verifyGenerated()` scans each draft for skills and figures that don't appear in the candidate's material and shows them as warnings. It runs again after every edit.
4. Drafts must be approved by the user. The untouched model output is kept in `generated_content` for auditing.

### Duplicates

- The same posting from the same source is unique on `(source_kind, external_id)`.
- The same role on different platforms shares a `fingerprint` (normalized company, title and city). Later copies get `duplicate_of` and are hidden from Discover.
- Applications are unique per job, and tracking a job whose fingerprint is already tracked returns `409`.

### Scheduling

Cron runs hourly. Each run checks the `DISCOVERY_SOURCES_PER_RUN` least-recently-checked sources (round-robin), and fetches at most
`DISCOVERY_MAX_DETAIL_FETCHES` full descriptions (Greenhouse lists omit them). That keeps each invocation well inside Workers'
subrequest and CPU limits. Postings not fetched because of the budget are picked up on the next run. A second daily cron creates deadline reminders.

## 3. Database schema

See [`migrations/0001_init.sql`](../migrations/0001_init.sql).

```mermaid
erDiagram
  profile ||--o{ documents : "grounds"
  sources ||--o{ jobs : "lists"
  jobs ||--o| applications : "tracked as"
  jobs ||--o{ documents : "tailored for"
  jobs ||--o{ notifications : "about"
  jobs ||--o{ jobs : "duplicate_of"
  documents ||--o{ documents : "parent (master CV)"
  applications }o--o| documents : "cv_document_id / cover_letter_id"
  events }o--|| jobs : "entity"
  discovery_runs
```

| Table | Purpose |
| --- | --- |
| `profile` | Single row: contact details, education, skills, target roles, location and keyword preferences. |
| `sources` | Company boards and aggregator categories, with last run status. |
| `jobs` | Normalized postings: description (Markdown), extracted skills, deadline, fingerprint, match score and detail, AI analysis. |
| `applications` | One per tracked job: status, priority, notes, chosen CV and cover letter, checklist, applied date. |
| `documents` | Master CVs (one active), tailored CVs, cover letters, answers. Draft or approved; keeps generated content and warnings. |
| `events` | Append-only audit log. |
| `notifications` | New strong matches, deadline reminders, source failures. Deduplicated by key. |
| `discovery_runs` | History of discovery runs with counts and errors. |

## 4. Data sources

See [data-sources.md](data-sources.md). In short: official public job-board APIs (Greenhouse, Lever, Ashby) for
company career pages, The Muse API for aggregated internships, and user-driven import (URL or pasted details)
for everything else. Sites without a public API that prohibit scraping (LinkedIn, Indeed, Glassdoor, Handshake) are not crawled.

## 5. Automation feasibility

See [automation.md](automation.md). Candidate-side submission APIs don't exist on the major applicant tracking systems:
Greenhouse, Lever and Ashby all require the employer's API key to submit applications. Application forms add CAPTCHAs and
custom questions. The MVP therefore uses a human-in-the-loop **Apply Kit**, and the server refuses to mark an application Applied
without explicit confirmation.

## 6. MVP scope

In scope, end to end:

Discovery → Matching → Job detail → Track → CV tailoring → Review and approve → Apply Kit → Confirm applied → Pipeline and history.

Also included because the flow depends on them: master CV upload (PDF/DOCX/Markdown), profile, cover letters and answers,
sources management, deadline tracking and reminders, in-app notifications, audit log, single-owner authentication.

Deferred: email notifications (Cloudflare Email Service needs a verified domain), multi-user accounts, DOCX export
(print-to-PDF covers the need), browser-extension autofill, semantic search with Vectorize.

## 7. Cloudflare deployment architecture

| Service | Used for | Notes |
| --- | --- | --- |
| Workers | API, SPA assets, scheduled jobs | Static assets are served before the Worker runs; only `/api/*` invokes it. |
| D1 | All application data | Migrations in `migrations/`. |
| Workers AI | CV conversion, default LLM | Always remote, billed per use. |
| Cron Triggers | Hourly discovery, daily reminders | Defined in `wrangler.jsonc`. |
| Rate Limiting binding | Login brute-force protection | 5 attempts per minute per IP. |
| Secrets | `APP_PASSWORD`, `SESSION_SECRET`, `ANTHROPIC_API_KEY` | Set with `wrangler secret put`. |
| Observability | Logs | Structured JSON logs. |

Deliberately not used: **R2** (only text is stored; original CV files aren't retained), **Queues** (round-robin cron keeps
each run within limits without a queue), **KV** (D1 already covers the data, and sessions are stateless signed cookies),
**Durable Objects** (no real-time coordination needed). Each is a clear upgrade path if the workload grows.

Optional hardening: put the app behind **Cloudflare Access** in addition to the password.

## 8. Repository structure

```
.
├── migrations/            D1 schema and seed data
├── shared/                Types, role and skill taxonomies used by Worker and web app
├── worker/
│   ├── index.ts           Hono app, auth middleware, error handling, cron entry
│   ├── ai/                LLM provider (Claude / Workers AI) and prompts
│   ├── discovery/         Source adapters, orchestrator, URL import
│   ├── documents/         Analysis and document generation
│   ├── lib/               Auth, D1 helpers, HTTP, text parsing, validation
│   ├── matching/          Scoring and fabrication checks
│   ├── routes/            API routes by resource
│   └── notifications.ts   Notification helpers and deadline reminders
├── src/                   React app: components, pages, styles, API client
├── public/                Favicon and static headers (CSP)
├── test/                  Vitest unit tests
└── docs/                  This documentation
```
