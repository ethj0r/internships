# Data sources

Discovery uses public endpoints intended for listing a company's open jobs: official APIs where a platform has one, and in one case (CATAPA) the public JSON a career page loads.
Every request identifies itself with a descriptive `User-Agent`, and requests are spread across the hourly runs of a
3-day refresh cycle (see [Refresh schedule](#refresh-schedule)).

## Integrated

| Source | Endpoint | Auth | What it covers |
| --- | --- | --- | --- |
| **Greenhouse Job Board API** | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs` and `/jobs/{id}` | None | Career pages of thousands of companies (Xendit, Appier, Bybit, OKX, Agoda, Stripe…). |
| **Lever Postings API** | `GET https://api.lever.co/v0/postings/{company}?mode=json` | None | Companies hiring on Lever (Animoca Brands, Amber Group, Palantir…). |
| **Ashby Posting API** | `GET https://api.ashbyhq.com/posting-api/job-board/{board}` | None | Companies hiring on Ashby (Coinhako, HoYoverse, Notion…). |
| **SmartRecruiters Posting API** | `GET https://api.smartrecruiters.com/v1/companies/{id}/postings?q=intern` and `/postings/{id}` | None | Grab, Carousell, Canva, Delivery Hero and Indonesian startups (Alodokter, BukuWarung, JULO, Stockbit…). Searching for "intern" returns every internship in one request, even on large boards. |
| **Workable job widget** | `GET https://apply.workable.com/api/v1/widget/accounts/{account}?details=true` | None | Companies hiring on Workable (Mercari, SmartNews). One request returns every job with its description. |
| **CATAPA career pages** | `GET https://api-apps.catapa.com/careerpage/{company}/jobs?page=0&size=50` | None | GDP Labs and other Indonesian employers on career.catapa.com. This is the JSON the public career page loads, not a documented API, so it may change without notice. |
| **The Muse API** | `GET https://www.themuse.com/api/public/jobs?category=…&level=Internship` | None (500 requests/hour unauthenticated) | Internships aggregated across many companies, filtered by category. Mostly US. |
| **Himalayas API** | `GET https://himalayas.app/jobs/api/search?employment_type=Intern&country={country}` | None (rate limited) | Remote internships open to a country, including worldwide roles. Terms require linking back to Himalayas and naming it as the source: jobs link to their Himalayas page and are labeled Himalayas. |
| **Import by URL** | Greenhouse, Lever and Ashby links are resolved through their APIs; other pages are read for `schema.org/JobPosting` JSON-LD | None | Company career sites that publish structured data (most modern ones do, for Google Jobs). |
| **Manual entry** | — | — | Anything else, including LinkedIn, JobStreet, Glints and Kalibrr postings, and big tech career sites (below). |

The default sources (see `migrations/0002_seed_sources.sql`, `0003_asia_search_area.sql` and `0006_more_sources.sql`:
Airwallex, OpenAI, Snowflake, Ninja Van, Nium, Binance, Okta, Twilio, Flip) were each verified to return a live board.
Add more in **Sources**, by board name or by pasting the board URL.

### Eligibility

Every posting is classified before anything else can use it ([`shared/eligibility.ts`](../shared/eligibility.ts)),
for a candidate in Bandung, Indonesia (UTC+7) who can work remotely from Indonesia, on-site in Indonesia, or on-site
or hybrid in Singapore:

| Status | Meaning |
| --- | --- |
| `ELIGIBLE_REMOTE` | Fully remote and open to candidates in Indonesia (worldwide, APAC, Asia, or Indonesia named). A stated time-zone overlap is translated into WIB hours. |
| `ELIGIBLE_INDONESIA` | On-site or hybrid in Indonesia. |
| `ELIGIBLE_SINGAPORE` | On-site or hybrid in Singapore, with a `work_authorization_note`: the likely pass (a Training Employment Pass, applied for by the employer, up to 3 months, per Singapore's Ministry of Manpower), whether the internship fits its limit, and what's unknown (whether they sponsor interns from overseas universities). |
| `CHECK_MANUALLY` | Ambiguous: remote with no country, remote listed in another Asian country, mixed restrictions, or no location. The sentence that caused the doubt is shown. Approve it to tailor documents. |
| `EXCLUDED` | On-site or hybrid elsewhere, remote restricted to countries without Indonesia, citizenship or clearance required, or a Singapore role that says it won't sponsor. The reason is stored and logged. |

How it's decided:

1. **Rules first, for free.** Location, workplace hints and the description are read with fixed patterns (country and
   city lists, "must be located in…", "citizens only", "unable to sponsor", overlap phrases). Equal-opportunity
   boilerplate is ignored. Postings the listing alone excludes (on-site in London, "Remote - US") are stored as
   `EXCLUDED` without fetching their details.
2. **The fast model only when the rules can't settle it**, reading the full description
   ([`worker/prompts/eligibility.md`](../worker/prompts/eligibility.md)). It extracts facts (work mode, locations,
   countries, remote restriction, overlap, authorization, citizenship, sponsorship, duration), each with a quote. Quotes
   that don't appear in the posting are dropped, and a fact without one can't change the outcome.
3. **One pure function decides** (`decide()`), so the same facts always give the same status. Unit-tested in
   [`test/eligibility.test.ts`](../test/eligibility.test.ts).

Only `ELIGIBLE_*` postings, and `CHECK_MANUALLY` postings you approved, can go through role analysis, CV and cover
letter generation; the API refuses the rest with `409`. You can override any status on the job page ("Can You Take
It?" → Change). Changing **Singapore work pass (confirmed only)** on your profile re-checks Singapore postings.

### Priority

The shortlist ([`shared/priority.ts`](../shared/priority.ts)) ranks postings within each status by company tier
([`config/companies.json`](../config/companies.json): 1 big tech, 2 large Southeast Asian tech, 3 remote-first, 4 other),
then season (Summer 2027 first; seasons already over sink to the bottom), then match score. Discover shows it grouped by
status when sorted by Priority (the default).

### Refresh schedule

Sources are refreshed every 3 days ([`worker/discovery/refresh.ts`](../worker/discovery/refresh.ts)). A cron
expression like `0 0 */3 * *` restarts every month (the 31st and the 1st run back to back), so instead the hourly cron
stores when each cycle starts and begins a new one once `REFRESH_INTERVAL_HOURS` (72) have passed. A cycle checks
`DISCOVERY_SOURCES_PER_RUN` sources per hourly run until every enabled source has been checked once, which keeps each
run inside Workers' limits; runs between cycles only finish eligibility checks and return.

Only new or changed postings cost anything: known postings are matched by source and id and compared by a content
hash (Greenhouse, whose listings omit descriptions, by its `updated_at`). A changed posting is re-classified and its
insights go stale. Postings disappear as **closed** when a complete board stops listing them, when an aggregator
(The Muse, Himalayas) hasn't shown them for two cycles, or when their deadline passes.

Each finished cycle writes a summary (new, changed and closed postings, how many landed in each status, and the top new
eligible postings at tier 1–3 companies) to the `refresh_cycles` table, the logs (`refresh.summary`) and the Sources
page. **Refresh Now** starts a cycle immediately.

### Relevance filter

Only postings that look like software internships are stored (`shared/roles.ts`):

- The title (or employment type) must indicate an internship: intern, internship, co-op, working student, placement, apprenticeship, magang, kerja praktik, インターン, 實習.
- The title or department must be technical: software, engineering, data, ML/AI, research, platform, security, QA, mobile, web…
- Titles that are clearly non-software (sales, marketing, mechanical engineering, hardware…) are skipped unless they also say software, developer, ML and similar.

### Normalization

- HTML descriptions become Markdown (`htmlToMarkdown`). Greenhouse's escaped HTML is decoded first.
- Workplace is taken from platform hints (Lever `workplaceType`, Ashby `isRemote`, SmartRecruiters `location.remote`, Workable `telecommuting`) or inferred from location, title and description.
- Deadlines come from JSON-LD `validThrough`, CATAPA's closing date, or phrases like "applications close March 15, 2027". Most postings don't list one, and you can add it yourself.
- Duration hints ("12 weeks", "Summer 2027") are extracted for display.

## Not integrated, and why

| Platform | Reason | Alternative |
| --- | --- | --- |
| LinkedIn | No public jobs API; the User Agreement prohibits scraping and automated access. | Add the posting by hand (paste details). Many LinkedIn postings link to a Greenhouse, Lever or Ashby page, which imports by URL. |
| JobStreet (SEEK) | No public jobs API; the terms prohibit scraping. | Manual entry. |
| Glints | No public jobs API; the terms prohibit automated collection. | Manual entry. |
| Kalibrr | Its search endpoint isn't a public API, and its terms name automated extraction and scraping as misuse. GoTo and Gojek post internships there. | Manual entry. |
| Indeed | Publisher API closed to new partners; ToS prohibits scraping. | Manual entry, or import the company's own posting URL. |
| Glassdoor | No public jobs API; ToS prohibits scraping. | Manual entry. |
| Handshake | Requires a university login; no public API. | Manual entry. |
| Wellfound | No public API. | Manual entry, or add the company's ATS board as a source. |
| Workday career sites | No public API; each tenant differs and uses bot protection (Traveloka's rejects automated requests). | Import by URL (many Workday pages expose JSON-LD), or manual entry. |
| Shopee, Sea, GoTo, Tokopedia, Bukalapak, Blibli, tiket.com | In-house career portals with no public feed. | On the watchlist; manual entry. |
| Google, Amazon, Microsoft, Meta, Apple, TikTok/ByteDance, NVIDIA | In-house career sites. Their terms of use restrict automated collection, and their posting pages render with JavaScript without `JobPosting` data, so import by URL fails (tested with Google and TikTok, September 2026). | The **big tech watchlist** on Discover ([`config/watchlist.json`](../config/watchlist.json)) links each company's Singapore or intern search; paste a posting's details with Add Job. |
| Adzuna, Jooble, USAJobs | Official APIs, but they require registration keys. | Good candidates for new adapters (see below). |

## Adding a source

1. Create `worker/discovery/sources/<name>.ts` implementing `SourceAdapter`:
   - `list(source)`: return `RawJob[]` for the board.
   - `hydrate(source, job)` (optional): fetch the full posting if `list` omits descriptions.
   - `resolveName(identifier)`: validate the board exists and return a display name.
   - `complete`: `true` if `list` returns every open posting, so missing ones can be marked closed.
2. Register it in `worker/discovery/registry.ts`.
3. Add the kind to `SOURCE_KINDS` in `shared/types.ts`, to `SOURCE_LABELS` in `src/lib/format.ts`, to the Sources page form,
   and to the `sources.kind` CHECK constraint in a new migration (SQLite needs a table rebuild to change a CHECK; see `0003_asia_search_area.sql`).
4. If the API needs a key, add it as a secret and document it in the README.
