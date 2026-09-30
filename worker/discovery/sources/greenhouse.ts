// Greenhouse Job Board API (public, no auth): https://developers.greenhouse.io/job-board.html

import { fetchJson } from "../../lib/http";
import type { RawJob, SourceAdapter } from "../types";

const BASE = "https://boards-api.greenhouse.io/v1/boards";

interface GreenhouseJob {
  id: number;
  title: string;
  updated_at?: string;
  first_published?: string | null;
  location?: { name?: string } | null;
  absolute_url: string;
  content?: string;
  departments?: { name: string }[];
}

function toRaw(company: string, j: GreenhouseJob): RawJob {
  return {
    externalId: String(j.id),
    company,
    title: j.title.trim(),
    location: j.location?.name?.trim() ?? "",
    department: j.departments?.map((d) => d.name).join(", ") ?? "",
    url: j.absolute_url,
    applyUrl: j.absolute_url,
    descriptionHtml: j.content,
    postedAt: j.first_published ?? j.updated_at ?? null,
    updatedAt: j.updated_at ?? null,
  };
}

export function fetchGreenhouseJob(token: string, id: string, company: string): Promise<RawJob> {
  return fetchJson<GreenhouseJob>(`${BASE}/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}`).then((j) => toRaw(company, j));
}

export const greenhouse: SourceAdapter = {
  complete: true,
  async list(source) {
    const data = await fetchJson<{ jobs: GreenhouseJob[] }>(`${BASE}/${encodeURIComponent(source.identifier)}/jobs`);
    return data.jobs.map((j) => toRaw(source.name, j));
  },
  hydrate(source, job) {
    return fetchGreenhouseJob(source.identifier, job.externalId, source.name);
  },
  async resolveName(identifier) {
    const board = await fetchJson<{ name: string }>(`${BASE}/${encodeURIComponent(identifier)}`);
    return board.name;
  },
};
