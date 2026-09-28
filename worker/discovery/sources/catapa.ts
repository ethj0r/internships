// CATAPA career pages (career.catapa.com/{company}), used by GDP Labs and other Indonesian employers.
// Reads the public JSON the career page itself loads. It isn't a documented API, so it may change without notice.

import { fetchJson } from "../../lib/http";
import type { RawJob, SourceAdapter } from "../types";

const BASE = "https://api-apps.catapa.com/careerpage";
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

interface Named {
  name?: string | null;
}

interface CatapaJob {
  id: string;
  jobTitle?: Named | null;
  titleDescription?: string | null;
  jobStatus?: string;
  jobLink?: string | null;
  createdDate?: number | null;
  location?: (Named & { city?: (Named & { state?: (Named & { country?: Named | null }) | null }) | null }) | null;
  jobDetail?: {
    open?: number | null;
    close?: number | null;
    description?: string | null;
    requirement?: string | null;
    benefit?: string | null;
    employmentType?: Named | null;
    jobFunction?: Named | null;
  } | null;
}

interface CatapaPage {
  content: CatapaJob[];
  last: boolean;
}

function isoDate(ms: number | null | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function toRaw(tenant: string, company: string, j: CatapaJob): RawJob {
  const d = j.jobDetail ?? {};
  const country = j.location?.city?.state?.country?.name ?? "";
  const place = j.location?.name ?? j.location?.city?.name ?? "";
  // titleDescription looks like "[Internship | Quality Assurance | General | Regular | Jakarta]".
  const kind = j.titleDescription?.replace(/^\[/, "").split("|")[0]?.trim() ?? "";
  const url = j.jobLink ? `https://career.catapa.com${j.jobLink}` : `https://career.catapa.com/${encodeURIComponent(tenant)}/job`;
  return {
    externalId: j.id,
    company,
    title: (j.jobTitle?.name ?? kind).trim(),
    location: [place, country].filter(Boolean).join(", "),
    department: d.jobFunction?.name ?? "",
    employmentType: [...new Set([kind, d.employmentType?.name].filter(Boolean))].join(", "),
    url,
    applyUrl: url,
    descriptionHtml: [d.description, d.requirement && `<h3>Requirements</h3>${d.requirement}`, d.benefit && `<h3>Benefits</h3>${d.benefit}`].filter(Boolean).join(""),
    postedAt: isoDate(d.open ?? j.createdDate),
    deadline: isoDate(d.close)?.slice(0, 10) ?? null,
  };
}

export const catapa: SourceAdapter = {
  complete: true,
  async list(source) {
    const jobs: RawJob[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await fetchJson<CatapaPage>(`${BASE}/${encodeURIComponent(source.identifier)}/jobs?page=${page}&size=${PAGE_SIZE}`);
      for (const j of data.content) if (!j.jobStatus || j.jobStatus === "PUBLISHED") jobs.push(toRaw(source.identifier, source.name, j));
      if (data.last || !data.content.length) break;
    }
    return jobs;
  },
  async resolveName(identifier) {
    const page = await fetchJson<{ brandName?: string }>(`${BASE}/${encodeURIComponent(identifier)}/company-career-pages`);
    if (!page.brandName) throw new Error(`No CATAPA career page called “${identifier}”.`);
    return page.brandName;
  },
};
