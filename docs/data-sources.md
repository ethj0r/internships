# Data sources

Discovery only uses official, documented, public endpoints that are intended for listing a company's open jobs.
Every request identifies itself with a descriptive `User-Agent`, and requests are spread across hourly runs.

## Integrated

| Source | Endpoint | Auth | What it covers |
| --- | --- | --- | --- |
| **Greenhouse Job Board API** | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs` and `/jobs/{id}` | None | Career pages of thousands of companies (Stripe, Databricks, Coinbase, Anthropic…). |
| **Lever Postings API** | `GET https://api.lever.co/v0/postings/{company}?mode=json` | None | Companies hiring on Lever (Palantir, Spotify…). |
| **Ashby Posting API** | `GET https://api.ashbyhq.com/posting-api/job-board/{board}` | None | Companies hiring on Ashby (Notion, Ramp, Perplexity…). |
| **The Muse API** | `GET https://www.themuse.com/api/public/jobs?category=…&level=Internship` | None (500 requests/hour unauthenticated) | Internships aggregated across many companies, filtered by category. |
| **Import by URL** | Greenhouse, Lever and Ashby links are resolved through their APIs; other pages are read for `schema.org/JobPosting` JSON-LD | None | Company career sites that publish structured data (most modern ones do, for Google Jobs). |
| **Manual entry** | — | — | Anything else, including LinkedIn, Indeed and Handshake postings. |

The default sources (see `migrations/0002_seed_sources.sql`) were each verified to return a live board.
Add more in **Sources**, by board name or by pasting the board URL.

### Relevance filter

Only postings that look like software internships are stored (`shared/roles.ts`):

- The title (or employment type) must indicate an internship: intern, internship, co-op, working student, placement, apprenticeship.
- The title or department must be technical: software, engineering, data, ML/AI, research, platform, security, mobile, web…
- Titles that are clearly non-software (sales, marketing, mechanical engineering, hardware…) are skipped unless they also say software, developer, ML and similar.

### Normalization

- HTML descriptions become Markdown (`htmlToMarkdown`). Greenhouse's escaped HTML is decoded first.
- Workplace is taken from platform hints (Lever `workplaceType`, Ashby `isRemote`) or inferred from location, title and description.
- Deadlines come from JSON-LD `validThrough` or phrases like "applications close March 15, 2027". Most postings don't list one, and you can add it yourself.
- Duration hints ("12 weeks", "Summer 2027") are extracted for display.

## Not integrated, and why

| Platform | Reason | Alternative |
| --- | --- | --- |
| LinkedIn | No public jobs API; the User Agreement prohibits scraping and automated access. | Add the posting by hand (paste details). Many LinkedIn postings link to a Greenhouse, Lever or Ashby page, which imports by URL. |
| Indeed | Publisher API closed to new partners; ToS prohibits scraping. | Manual entry, or import the company's own posting URL. |
| Glassdoor | No public jobs API; ToS prohibits scraping. | Manual entry. |
| Handshake | Requires a university login; no public API. | Manual entry. |
| Wellfound | No public API. | Manual entry, or add the company's ATS board as a source. |
| Workday career sites | No public API; each tenant differs and uses bot protection. | Import by URL (many Workday pages expose JSON-LD), or manual entry. |
| Adzuna, Jooble, USAJobs | Official APIs, but they require registration keys. | Good candidates for new adapters (see below). |

## Adding a source

1. Create `worker/discovery/sources/<name>.ts` implementing `SourceAdapter`:
   - `list(source)`: return `RawJob[]` for the board.
   - `hydrate(source, job)` (optional): fetch the full posting if `list` omits descriptions.
   - `resolveName(identifier)`: validate the board exists and return a display name.
   - `complete`: `true` if `list` returns every open posting, so missing ones can be marked closed.
2. Register it in `worker/discovery/registry.ts`.
3. Add the kind to `SOURCE_KINDS` in `shared/types.ts`, to `SOURCE_LABELS` in `src/lib/format.ts`,
   and to the `sources.kind` CHECK constraint in a new migration (SQLite needs a table rebuild to change a CHECK).
4. If the API needs a key, add it as a secret and document it in the README.
