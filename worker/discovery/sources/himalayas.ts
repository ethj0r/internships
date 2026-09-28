// Himalayas remote jobs API (public, no key): https://himalayas.app/api
// Queried for internships open to one country, which includes worldwide roles. Every job is remote.
// Terms: link back to the Himalayas URL and name Himalayas as the source (jobs link to Himalayas; the source is labeled).

import { fetchJson } from "../../lib/http";
import type { RawJob, SourceAdapter } from "../types";

const MAX_PAGES = 5;

interface HimalayasJob {
  title: string;
  companyName: string;
  employmentType?: string;
  description?: string;
  pubDate?: number;
  applicationLink: string;
  guid: string;
  locationRestrictions?: string[];
  parentCategories?: string[];
}

interface HimalayasPage {
  totalCount: number;
  limit?: number;
  jobs: HimalayasJob[];
}

function searchUrl(country: string, page: number): string {
  const params = new URLSearchParams({ employment_type: "Intern", country, sort: "recent", page: String(page) });
  return `https://himalayas.app/jobs/api/search?${params}`;
}

/** "Remote, Worldwide", "Remote, Indonesia", "Remote, 53 countries including Indonesia". */
export function himalayasLocation(restrictions: string[] | undefined, country: string): string {
  if (!restrictions?.length) return "Remote, Worldwide";
  if (restrictions.length <= 3) return `Remote, ${restrictions.join(", ")}`;
  const named = restrictions.find((r) => r.toLowerCase() === country.toLowerCase()) ?? restrictions[0];
  return `Remote, ${restrictions.length} countries including ${named}`;
}

export const himalayas: SourceAdapter = {
  // Only the newest pages are fetched, so absence doesn't mean a posting closed.
  complete: false,
  async list(source) {
    const jobs: RawJob[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await fetchJson<HimalayasPage>(searchUrl(source.identifier, page));
      for (const j of data.jobs) {
        jobs.push({
          externalId: j.guid,
          company: j.companyName.trim(),
          title: j.title.trim(),
          location: himalayasLocation(j.locationRestrictions, source.identifier),
          workplaceHint: "remote",
          // Only the broad parent categories ("Developer", "Data Science"). The fine-grained ones are keyword lists
          // like "AI Strategy Intern" or "Market Research" that would let marketing and sales roles through the tech filter.
          department: (j.parentCategories ?? []).join(", "),
          employmentType: j.employmentType ?? "",
          url: j.applicationLink,
          applyUrl: j.applicationLink,
          descriptionHtml: j.description ?? "",
          postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
        });
      }
      if (!data.jobs.length || page * (data.limit ?? data.jobs.length) >= data.totalCount) break;
    }
    return jobs;
  },
  async resolveName(identifier) {
    const data = await fetchJson<HimalayasPage>(searchUrl(identifier, 1));
    if (typeof data.totalCount !== "number") throw new Error(`Himalayas didn't recognize “${identifier}”.`);
    return `Himalayas: remote, open to ${identifier}`;
  },
};
