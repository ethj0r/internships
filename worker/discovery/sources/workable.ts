// Workable's public job widget endpoint (no auth), the feed behind embeddable Workable job lists.
// One request returns every open job with its description.

import { fetchJson } from "../../lib/http";
import type { RawJob, SourceAdapter } from "../types";

interface WorkableLocation {
  country?: string;
  city?: string;
  region?: string;
  hidden?: boolean;
}

interface WorkableJob {
  title: string;
  shortcode: string;
  employment_type?: string;
  telecommuting?: boolean;
  department?: string;
  function?: string;
  url: string;
  application_url?: string;
  published_on?: string;
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
  locations?: WorkableLocation[];
  description?: string;
}

interface WorkableAccount {
  name: string;
  jobs: WorkableJob[];
}

function fetchAccount(account: string): Promise<WorkableAccount> {
  return fetchJson<WorkableAccount>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`);
}

export function workableLocation(j: WorkableJob): string {
  const places = (j.locations ?? []).filter((l) => !l.hidden).map((l) => [l.city, l.country].filter(Boolean).join(", "));
  const location = [...new Set(places.length ? places : [[j.city, j.state, j.country].filter(Boolean).join(", ")])].filter(Boolean).join("; ");
  return j.telecommuting ? (location ? `Remote, ${location}` : "Remote") : location;
}

export const workable: SourceAdapter = {
  complete: true,
  async list(source) {
    const data = await fetchAccount(source.identifier);
    return data.jobs.map<RawJob>((j) => ({
      externalId: j.shortcode,
      company: source.name,
      title: j.title.trim(),
      location: workableLocation(j),
      workplaceHint: j.telecommuting ? "remote" : null,
      department: [j.department, j.function].filter(Boolean).join(", "),
      employmentType: j.employment_type ?? "",
      url: j.url,
      applyUrl: j.application_url ?? j.url,
      descriptionHtml: j.description ?? "",
      postedAt: j.published_on || j.created_at || null,
    }));
  },
  async resolveName(identifier) {
    return (await fetchAccount(identifier)).name;
  },
};
