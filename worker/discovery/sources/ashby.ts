// Ashby public job posting API (no auth): https://developers.ashbyhq.com/docs/public-job-posting-api

import { fetchJson } from "../../lib/http";
import type { RawJob, SourceAdapter } from "../types";
import { titleCaseSlug } from "./lever";

interface AshbyJob {
  id?: string;
  title: string;
  location?: string;
  department?: string;
  team?: string;
  isRemote?: boolean;
  workplaceType?: string;
  employmentType?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl: string;
  applyUrl?: string;
  isListed?: boolean;
}

export async function listAshbyJobs(boardName: string, company: string): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardName)}`);
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      externalId: j.id ?? j.jobUrl,
      company,
      title: j.title.trim(),
      location: j.location ?? "",
      workplaceHint: j.isRemote ? "remote" : j.workplaceType,
      department: [j.department, j.team].filter(Boolean).join(", "),
      employmentType: j.employmentType ?? "",
      url: j.jobUrl,
      applyUrl: j.applyUrl ?? j.jobUrl,
      descriptionHtml: j.descriptionHtml,
      postedAt: j.publishedAt ?? null,
    }));
}

export const ashby: SourceAdapter = {
  complete: true,
  list: (source) => listAshbyJobs(source.identifier, source.name),
  async resolveName(identifier) {
    await listAshbyJobs(identifier, identifier);
    return titleCaseSlug(identifier);
  },
};
