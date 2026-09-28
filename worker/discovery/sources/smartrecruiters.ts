// SmartRecruiters Posting API (public, no auth): https://developers.smartrecruiters.com/docs/posting-api
// Searched for "intern", which returns every internship posting in one request even for large boards (Grab, Delivery Hero).
// Only those results are ever stored, so absence from the search means a stored posting closed.

import { fetchJson } from "../../lib/http";
import type { RawJob, SourceAdapter } from "../types";

const BASE = "https://api.smartrecruiters.com/v1/companies";
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

interface SrLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
}

interface SrPosting {
  id: string;
  name: string;
  company?: { name?: string; identifier?: string };
  releasedDate?: string;
  location?: SrLocation;
  department?: { label?: string } | null;
  function?: { label?: string } | null;
  typeOfEmployment?: { label?: string } | null;
  experienceLevel?: { label?: string } | null;
}

interface SrPostingDetail extends SrPosting {
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string | undefined): string {
  if (!code) return "";
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "Singapore", "Jakarta, Indonesia", "Remote, Philippines". */
export function srLocation(l: SrLocation | undefined): string {
  if (!l) return "";
  const place = [...new Set([l.city, l.region, countryName(l.country)].map((p) => p?.trim()).filter(Boolean))].join(", ");
  return l.remote ? (place ? `Remote, ${place}` : "Remote") : place;
}

function toRaw(identifier: string, company: string, p: SrPosting): RawJob {
  return {
    externalId: p.id,
    company,
    title: p.name.trim(),
    location: srLocation(p.location),
    workplaceHint: p.location?.remote ? "remote" : p.location?.hybrid ? "hybrid" : null,
    department: [p.department?.label, p.function?.label].filter(Boolean).join(", "),
    employmentType: [p.typeOfEmployment?.label, p.experienceLevel?.label].filter(Boolean).join(", "),
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${p.id}`,
    postedAt: p.releasedDate ?? null,
  };
}

const SECTIONS = ["jobDescription", "qualifications", "additionalInformation"];

export const smartrecruiters: SourceAdapter = {
  complete: true,
  async list(source) {
    const jobs: RawJob[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ q: "intern", limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      const data = await fetchJson<{ totalFound: number; content: SrPosting[] }>(`${BASE}/${encodeURIComponent(source.identifier)}/postings?${params}`);
      jobs.push(...data.content.map((p) => toRaw(source.identifier, source.name, p)));
      if ((page + 1) * PAGE_SIZE >= data.totalFound) break;
    }
    return jobs;
  },
  async hydrate(source, job) {
    const p = await fetchJson<SrPostingDetail>(`${BASE}/${encodeURIComponent(source.identifier)}/postings/${encodeURIComponent(job.externalId)}`);
    const sections = p.jobAd?.sections ?? {};
    const descriptionHtml = SECTIONS.map((key) => sections[key])
      .filter((s) => s?.text?.trim())
      .map((s) => `${s!.title ? `<h3>${s!.title}</h3>` : ""}${s!.text}`)
      .join("");
    return { ...toRaw(source.identifier, source.name, p), url: p.postingUrl ?? job.url, applyUrl: p.applyUrl ?? p.postingUrl ?? job.url, descriptionHtml };
  },
  async resolveName(identifier) {
    const data = await fetchJson<{ totalFound: number; content: SrPosting[] }>(`${BASE}/${encodeURIComponent(identifier)}/postings?limit=1`);
    const name = data.content[0]?.company?.name;
    if (!data.totalFound || !name) throw new Error(`SmartRecruiters has no open postings for “${identifier}”.`);
    return name;
  },
};
