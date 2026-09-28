# API

All endpoints are under `/api`, return JSON, and (except `/api/health` and `/api/auth/*`) require a session cookie.
Mutating requests must also send `X-Requested-With: fetch`. Errors have the shape `{ "error": "Human-readable message" }`.

Types referenced below are defined in [`shared/types.ts`](../shared/types.ts).

## Auth

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/auth/session` | | `{ authenticated, configured }` |
| POST | `/auth/login` | `{ password }` | Sets `session` cookie. `401` wrong password, `429` too many attempts, `503` not configured. |
| POST | `/auth/logout` | | Clears the cookie. |

## Jobs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/jobs` | Query: `view` (`inbox` default, `all`, `tracked`, `dismissed`), `q`, `workplace`, `region` (`indonesia`, `asia`), `minScore`, `source`, `sort` (`score`, `newest`, `deadline`), `hasDeadline=1`, `limit` (≤200), `offset`. Returns `{ jobs: JobSummary[], total }`. |
| GET | `/jobs/:id` | `JobDetail`, including duplicates and related documents. |
| PATCH | `/jobs/:id` | `{ deadline?: "YYYY-MM-DD" \| null, dismissed?: boolean }` |
| GET | `/jobs/:id/events` | Audit events for the job, its application and documents. |
| POST | `/jobs/:id/insights` | Rebuilds the job's insights (requirements, evidence map, strategy, cited company research). Returns `JobInsights`. `GET /jobs/:id` includes `insights` and `insightsStale`. |
| POST | `/jobs/import` | `{ url }` or `{ manual: { company, title, location?, url?, description?, deadline? } }`. Returns `{ id, created, duplicateOf }`. `422` if the page can't be read. |
| POST | `/jobs/rescore` | Recomputes all match scores. |

## Applications

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/applications` | Optional `status`. Returns `Application[]`. |
| POST | `/applications` | `{ jobId, status?: "interested" \| "preparing" \| "ready", priority? }`. Idempotent per job. `409` if the same role is tracked from another listing. |
| PATCH | `/applications/:id` | `{ status?, confirmSubmitted?, priority?, notes?, cvDocumentId?, coverLetterId?, appliedAt?, checklist? }`. Moving to `applied` requires `confirmSubmitted: true`. |
| DELETE | `/applications/:id` | Stops tracking (logged on the job). |
| GET | `/applications/:id/kit` | `ApplyKit`: job, chosen/latest documents, checklist steps. |

## Documents

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/documents` | Optional `kind`, `jobId`. Summaries only. |
| GET | `/documents/:id` | Full `Document`; `meta.parentContent` holds the master CV for diffs. |
| POST | `/documents/master` | `multipart/form-data` with `file` (PDF, DOCX, ODT, HTML, Markdown, TXT; ≤5 MB), or JSON `{ content, title? }`. Becomes the active master CV. |
| POST | `/documents/tailor` | `{ jobId }` → tailored CV draft. Builds the job's insights first if needed. `meta` has `bulletChanges` (before/after with requirements and evidence), `omitted`, `strategy`, `requirements`, `matches`, `evidence`, `changes` and `review`. |
| POST | `/documents/cover-letter` | `{ jobId, angle?: string }` → cover letter draft. `angle` is what draws the candidate to the company, in their words. `meta` has `plan`, `grounding`, `companyFacts` and `review`. |
| POST | `/documents/answers` | `{ jobId, questions?: string[] }` → answers draft. |
| POST | `/documents/:id/review` | Runs the quality review on a tailored CV or cover letter's current content. Returns the `Document` with `meta.review`. |
| PATCH | `/documents/:id` | `{ title?, content?, status?: "draft" \| "approved", isActive?: true }`. Content edits re-run fabrication checks and mark the review stale. Approving a tailored CV links it to the application and moves Preparing → Ready. |

## Knowledge base

Types in [`shared/personalization.ts`](../shared/personalization.ts).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/knowledge` | `KnowledgeBase`: master CV entries with their evidence, and all notes. |
| POST | `/knowledge/notes` | `{ entryKey: string \| null, kind, title, body, links: {label, url}[] }`. `entryKey` attaches the note to a CV entry. |
| PATCH | `/knowledge/notes/:id` | Any of the fields above. |
| DELETE | `/knowledge/notes/:id` | |
| DELETE | `/documents/:id` | |

## Profile

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/profile` | `Profile` |
| PUT | `/profile` | Full profile. Skills are canonicalized. Triggers a background rescore. |

## Sources and discovery

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sources` | With open job counts and last run status. |
| POST | `/sources` | `{ kind, identifier }`. The identifier may be a board URL. The board is validated before saving. |
| PATCH | `/sources/:id` | `{ enabled?, name? }` |
| DELETE | `/sources/:id` | Jobs are kept. |
| POST | `/sources/:id/run` | Checks one source now. Returns `DiscoveryRun`. |
| POST | `/discovery/run` | Runs the next batch of sources now. |
| GET | `/discovery/runs` | Last 20 runs. |

## Activity

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/overview` | Counts by stage, new this week, unread notifications, upcoming deadlines, setup state, AI provider. |
| GET | `/notifications` | Latest 60. |
| POST | `/notifications/read` | `{ ids?: number[] }`. All when omitted. |
| GET | `/events` | Query: `entityType`, `before` (id cursor), `limit` (≤200). |
| GET | `/health` | Unauthenticated liveness check. |
