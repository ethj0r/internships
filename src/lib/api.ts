import type { JobInsights, KnowledgeBase, KnowledgeNote } from "../../shared/personalization";
import type {
  Application,
  ApplicationStatus,
  ApplyKit,
  AuditEvent,
  DiscoveryRun,
  Document,
  DocumentSummary,
  JobDetail,
  JobSummary,
  Notification,
  Overview,
  Priority,
  Profile,
  Source,
  SourceKind,
} from "../../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "fetch" };
  const init: RequestInit = { method, headers, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth")) window.dispatchEvent(new Event("auth:required"));
    throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status}).`, res.status);
  }
  return data as T;
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : "";
}

export interface JobQuery {
  view?: "inbox" | "tracked" | "dismissed" | "all";
  q?: string;
  workplace?: string;
  region?: "indonesia" | "asia";
  minScore?: number;
  source?: string;
  sort?: "score" | "newest" | "deadline";
  hasDeadline?: "1";
  limit?: number;
}

export type ProfileInput = Omit<Profile, "updatedAt">;
export type NoteInput = Pick<KnowledgeNote, "entryKey" | "kind" | "title" | "body" | "links">;

export const api = {
  session: () => request<{ authenticated: boolean; configured: boolean }>("GET", "/auth/session"),
  login: (password: string) => request<{ authenticated: boolean }>("POST", "/auth/login", { password }),
  logout: () => request<{ authenticated: boolean }>("POST", "/auth/logout", {}),

  overview: () => request<Overview>("GET", "/overview"),

  jobs: (params: JobQuery) => request<{ jobs: JobSummary[]; total: number }>("GET", `/jobs${query({ ...params })}`),
  job: (id: number) => request<JobDetail>("GET", `/jobs/${id}`),
  jobEvents: (id: number) => request<AuditEvent[]>("GET", `/jobs/${id}/events`),
  updateJob: (id: number, patch: { deadline?: string | null; dismissed?: boolean }) => request<JobDetail>("PATCH", `/jobs/${id}`, patch),
  analyzeRole: (id: number) => request<JobInsights>("POST", `/jobs/${id}/insights`, {}),
  importJobUrl: (url: string) => request<{ id: number; created: boolean; duplicateOf: number | null }>("POST", "/jobs/import", { url }),
  importJobManual: (manual: { company: string; title: string; location?: string; url?: string; description?: string; deadline?: string | null }) =>
    request<{ id: number; created: boolean; duplicateOf: number | null }>("POST", "/jobs/import", { manual }),

  applications: (status?: ApplicationStatus) => request<Application[]>("GET", `/applications${query({ status })}`),
  track: (jobId: number, status: "interested" | "preparing" | "ready" = "interested", priority: Priority = "medium") =>
    request<Application>("POST", "/applications", { jobId, status, priority }),
  updateApplication: (
    id: number,
    patch: {
      status?: ApplicationStatus;
      confirmSubmitted?: boolean;
      priority?: Priority;
      notes?: string;
      cvDocumentId?: number | null;
      coverLetterId?: number | null;
      appliedAt?: string | null;
      checklist?: Record<string, boolean>;
    },
  ) => request<Application>("PATCH", `/applications/${id}`, patch),
  untrack: (id: number) => request<void>("DELETE", `/applications/${id}`),
  applyKit: (id: number) => request<ApplyKit>("GET", `/applications/${id}/kit`),

  documents: (params: { kind?: string; jobId?: number } = {}) => request<DocumentSummary[]>("GET", `/documents${query(params)}`),
  document: (id: number) => request<Document>("GET", `/documents/${id}`),
  uploadMasterCv: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request<Document>("POST", "/documents/master", form);
  },
  createMasterCv: (content: string, title?: string) => request<Document>("POST", "/documents/master", { content, title }),
  updateDocument: (id: number, patch: { title?: string; content?: string; status?: "draft" | "approved"; isActive?: true }) =>
    request<Document>("PATCH", `/documents/${id}`, patch),
  deleteDocument: (id: number) => request<void>("DELETE", `/documents/${id}`),
  tailorCv: (jobId: number) => request<Document>("POST", "/documents/tailor", { jobId }),
  coverLetter: (jobId: number, angle?: string) => request<Document>("POST", "/documents/cover-letter", { jobId, angle }),
  answers: (jobId: number, questions?: string[]) => request<Document>("POST", "/documents/answers", { jobId, questions }),
  reviewDocument: (id: number) => request<Document>("POST", `/documents/${id}/review`, {}),

  knowledge: () => request<KnowledgeBase>("GET", "/knowledge"),
  createNote: (note: NoteInput) => request<KnowledgeNote>("POST", "/knowledge/notes", note),
  updateNote: (id: number, note: Partial<NoteInput>) => request<KnowledgeNote>("PATCH", `/knowledge/notes/${id}`, note),
  deleteNote: (id: number) => request<void>("DELETE", `/knowledge/notes/${id}`),

  profile: () => request<Profile>("GET", "/profile"),
  saveProfile: (profile: ProfileInput) => request<Profile>("PUT", "/profile", profile),

  sources: () => request<Source[]>("GET", "/sources"),
  addSource: (kind: Exclude<SourceKind, "manual">, identifier: string) => request<Source>("POST", "/sources", { kind, identifier }),
  updateSource: (id: number, patch: { enabled?: boolean; name?: string }) => request<Source>("PATCH", `/sources/${id}`, patch),
  deleteSource: (id: number) => request<void>("DELETE", `/sources/${id}`),
  runSource: (id: number) => request<DiscoveryRun>("POST", `/sources/${id}/run`, {}),
  runDiscovery: () => request<DiscoveryRun>("POST", "/discovery/run", {}),
  discoveryRuns: () => request<DiscoveryRun[]>("GET", "/discovery/runs"),

  notifications: () => request<Notification[]>("GET", "/notifications"),
  markNotificationsRead: (ids?: number[]) => request<{ ok: true }>("POST", "/notifications/read", { ids }),
  events: (params: { entityType?: string; before?: number; limit?: number } = {}) => request<AuditEvent[]>("GET", `/events${query(params)}`),
};
