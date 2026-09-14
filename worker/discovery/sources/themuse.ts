// The Muse public jobs API (no key required at low volume): https://www.themuse.com/developers/api/v2
// Queried by category with level=Internship, newest first.

import { fetchJson } from "../../lib/http";
import type { RawJob, SourceAdapter } from "../types";

const PAGES_PER_RUN = 3;

interface MuseJob {
  id: number;
  name: string;
  contents: string;
  publication_date: string;
  locations: { name: string }[];
  refs: { landing_page: string };
  company: { name: string };
}

function url(category: string, page: number): string {
  const params = new URLSearchParams({ category, level: "Internship", page: String(page), descending: "true" });
  return `https://www.themuse.com/api/public/jobs?${params}`;
}

export const themuse: SourceAdapter = {
  // Only the newest pages are fetched, so absence doesn't mean a posting closed.
  complete: false,
  async list(source) {
    const jobs: RawJob[] = [];
    for (let page = 0; page < PAGES_PER_RUN; page++) {
      const data = await fetchJson<{ results: MuseJob[]; page_count: number }>(url(source.identifier, page));
      for (const j of data.results) {
        jobs.push({
          externalId: String(j.id),
          company: j.company.name,
          title: j.name.trim(),
          location: j.locations.map((l) => l.name).join("; "),
          department: source.identifier,
          employmentType: "Internship",
          url: j.refs.landing_page,
          applyUrl: j.refs.landing_page,
          descriptionHtml: j.contents,
          postedAt: j.publication_date,
        });
      }
      if (page + 1 >= data.page_count) break;
    }
    return jobs;
  },
  async resolveName(identifier) {
    const data = await fetchJson<{ total: number }>(url(identifier, 0));
    if (!data.total) throw new Error(`The Muse has no internships in “${identifier}”.`);
    return `The Muse: ${identifier}`;
  },
};
