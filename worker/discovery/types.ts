import type { SourceKind } from "../../shared/types";

/** A posting as returned by a source, before normalization. */
export interface RawJob {
  externalId: string;
  company: string;
  title: string;
  location: string;
  workplaceHint?: string | null;
  department?: string;
  employmentType?: string;
  url: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionText?: string;
  postedAt?: string | null;
  /** The platform's last-updated timestamp, when listings include one. */
  updatedAt?: string | null;
  deadline?: string | null;
}

export interface SourceRef {
  id: number;
  kind: SourceKind;
  identifier: string;
  name: string;
}

export interface SourceAdapter {
  /** Lists current postings. May omit descriptions (see hydrate). */
  list(source: SourceRef): Promise<RawJob[]>;
  /** Fetches the full posting when list() returns summaries only. */
  hydrate?(source: SourceRef, job: RawJob): Promise<RawJob>;
  /** Resolves a display name for a new source, validating that it exists. */
  resolveName(identifier: string): Promise<string>;
  /** True when list() returns every open posting, so unseen ones can be marked closed. */
  complete: boolean;
}
