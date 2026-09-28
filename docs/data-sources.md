# Data sources

Discovery uses public endpoints intended for listing a company's open jobs: official APIs where a platform has one, and in one case (CATAPA) the public JSON a career page loads.
Every request identifies itself with a descriptive `User-Agent`, and requests are spread across hourly runs.

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
| **Manual entry** | — | — | Anything else, including LinkedIn, JobStreet, Glints and Kalibrr postings. |

The default sources (see `migrations/0002_seed_sources.sql` and `0003_asia_search_area.sql`) were each verified to return a live board.
Add more in **Sources**, by board name or by pasting the board URL.

### Search area

The profile's **Search area** decides which postings are kept and listed (`shared/regions.ts`):

| Search area | Keeps |
| --- | --- |
| **Indonesia & Remote** (default) | Any internship located in Indonesia, on-site, hybrid or remote, plus remote internships open to Indonesia: worldwide, APAC or Asia, remote roles listed for another Asian country, and remote roles that don't say where they hire. |
| **Asia** | The above, plus on-site and hybrid internships elsewhere in East and Southeast Asia (Singapore, Malaysia, Thailand, Vietnam, the Philippines, Taiwan, Japan, Korea, Hong Kong, China). |
| **Anywhere** | Every location. |

Each job stores a `region` (`indonesia`, `remote_open`, `remote_asia`, `remote_unknown`, `asia`, `other`, `unknown`), classified from its location, workplace and description.

- New postings outside the search area aren't stored. Postings already stored keep being tracked, so changing the search area only changes what's listed.
- Tracked and hidden jobs are always listed, whatever their region.
- The region also sets the location part of the match score: Indonesia and open remote roles score highest; remote roles tied to another country, or with unstated eligibility, get a concern to check.

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
| Shopee, Sea, GoTo, Tokopedia, Bukalapak, Blibli, tiket.com | In-house career portals with no public feed. | Import by URL or manual entry. |
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
