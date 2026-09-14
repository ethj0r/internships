// Adds a single posting the user found elsewhere: by URL (ATS APIs or schema.org JobPosting markup)
// or by pasting the details. Sites that block automated access (LinkedIn, Indeed) use the manual path.

import type { SourceKind } from "../../shared/types";
import { fetchHtml, HttpError } from "../lib/http";
import { sha256Hex } from "../lib/text";
import { listAshbyJobs } from "./sources/ashby";
import { fetchGreenhouseJob, greenhouse } from "./sources/greenhouse";
import { fetchLeverPosting, leverToRaw, titleCaseSlug } from "./sources/lever";
import type { RawJob } from "./types";

export class ImportError extends Error {}

export interface ImportedJob {
  kind: SourceKind;
  identifier: string | null;
  raw: RawJob;
}

const BLOCKED_MESSAGE =
  "Couldn't read job details from this page. Some sites, like LinkedIn and Indeed, block automated access. Paste the details instead.";

export async function importFromUrl(input: string): Promise<ImportedJob> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ImportError("Enter a full URL, starting with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ImportError("Enter a web URL.");

  const gh = url.href.match(/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([\w-]+)\/jobs\/(\d+)/);
  if (gh) {
    const [, token, id] = gh as unknown as [string, string, string];
    const company = await greenhouse.resolveName(token).catch(() => titleCaseSlug(token));
    return { kind: "greenhouse", identifier: token, raw: await fetchGreenhouseJob(token, id, company) };
  }

  const lv = url.href.match(/jobs(?:\.eu)?\.lever\.co\/([\w.-]+)\/([0-9a-f-]{36})/i);
  if (lv) {
    const [, slug, id] = lv as unknown as [string, string, string];
    return { kind: "lever", identifier: slug, raw: leverToRaw(titleCaseSlug(slug), await fetchLeverPosting(slug, id)) };
  }

  const ab = url.href.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (ab) {
    const [, board, id] = ab as unknown as [string, string, string];
    const jobs = await listAshbyJobs(decodeURIComponent(board), titleCaseSlug(decodeURIComponent(board)));
    const job = jobs.find((j) => j.externalId === id || j.url.includes(id));
    if (!job) throw new ImportError("That Ashby posting is no longer listed.");
    return { kind: "ashby", identifier: decodeURIComponent(board), raw: job };
  }

  let html: string;
  try {
    html = await fetchHtml(url.href);
  } catch (err) {
    if (err instanceof HttpError || err instanceof Error) throw new ImportError(BLOCKED_MESSAGE);
    throw err;
  }
  const posting = findJobPosting(html);
  if (!posting) throw new ImportError(BLOCKED_MESSAGE);

  const title = str(posting.title);
  const company = str((posting.hiringOrganization as Record<string, unknown> | undefined)?.name);
  if (!title || !company) throw new ImportError(BLOCKED_MESSAGE);
  const canonical = str(posting.url) || url.href;
  return {
    kind: "manual",
    identifier: null,
    raw: {
      externalId: `url:${(await sha256Hex(canonical)).slice(0, 32)}`,
      company,
      title,
      location: ldLocation(posting.jobLocation),
      workplaceHint: /telecommute/i.test(String(posting.jobLocationType ?? "")) ? "remote" : null,
      employmentType: [posting.employmentType].flat().map(str).join(", "),
      url: canonical,
      applyUrl: url.href,
      descriptionHtml: str(posting.description),
      postedAt: str(posting.datePosted) || null,
      deadline: /^\d{4}-\d{2}-\d{2}/.test(str(posting.validThrough)) ? str(posting.validThrough).slice(0, 10) : null,
    },
  };
}

export async function manualJob(input: {
  company: string;
  title: string;
  location?: string;
  url?: string;
  description?: string;
  deadline?: string | null;
}): Promise<ImportedJob> {
  const url = input.url?.trim() ?? "";
  return {
    kind: "manual",
    identifier: null,
    raw: {
      externalId: `manual:${(await sha256Hex(`${input.company}|${input.title}|${url}`.toLowerCase())).slice(0, 32)}`,
      company: input.company.trim(),
      title: input.title.trim(),
      location: input.location?.trim() ?? "",
      url,
      applyUrl: url,
      descriptionText: input.description?.trim() ?? "",
      deadline: input.deadline ?? null,
      postedAt: null,
    },
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function findJobPosting(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === "object") {
        const o = node as Record<string, unknown>;
        const type = o["@type"];
        if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return o;
        if (o["@graph"]) stack.push(o["@graph"]);
      }
    }
  }
  return null;
}

function ldLocation(value: unknown): string {
  return [value]
    .flat()
    .map((loc) => {
      const address = (loc as { address?: unknown } | null)?.address;
      if (typeof address === "string") return address;
      const a = (address ?? {}) as Record<string, unknown>;
      const country = typeof a.addressCountry === "object" ? str((a.addressCountry as Record<string, unknown>)?.name) : str(a.addressCountry);
      return [str(a.addressLocality), str(a.addressRegion), country].filter(Boolean).join(", ");
    })
    .filter(Boolean)
    .join("; ");
}
