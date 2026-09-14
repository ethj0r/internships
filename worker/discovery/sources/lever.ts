// Lever Postings API (public, no auth): https://github.com/lever/postings-api

import { fetchJson } from "../../lib/http";
import type { RawJob, SourceAdapter } from "../types";

const BASE = "https://api.lever.co/v0/postings";

interface LeverPosting {
  id: string;
  text: string;
  categories?: { location?: string; team?: string; department?: string; commitment?: string };
  description?: string;
  lists?: { text: string; content: string }[];
  additional?: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
}

export function leverToRaw(company: string, p: LeverPosting): RawJob {
  const lists = (p.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join("");
  return {
    externalId: p.id,
    company,
    title: p.text.trim(),
    location: p.categories?.location ?? "",
    workplaceHint: p.workplaceType,
    department: [p.categories?.department, p.categories?.team].filter(Boolean).join(", "),
    employmentType: p.categories?.commitment ?? "",
    url: p.hostedUrl,
    applyUrl: p.applyUrl ?? p.hostedUrl,
    descriptionHtml: `${p.description ?? ""}${lists}${p.additional ?? ""}`,
    postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
  };
}

export function fetchLeverPosting(slug: string, id: string): Promise<LeverPosting> {
  return fetchJson<LeverPosting>(`${BASE}/${encodeURIComponent(slug)}/${encodeURIComponent(id)}?mode=json`);
}

export function titleCaseSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const lever: SourceAdapter = {
  complete: true,
  async list(source) {
    const postings = await fetchJson<LeverPosting[]>(`${BASE}/${encodeURIComponent(source.identifier)}?mode=json`);
    return postings.map((p) => leverToRaw(source.name, p));
  },
  async resolveName(identifier) {
    await fetchJson<LeverPosting[]>(`${BASE}/${encodeURIComponent(identifier)}?mode=json&limit=1`);
    return titleCaseSlug(identifier);
  },
};
