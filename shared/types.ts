// Types shared by the Worker API and the web client.

import type {
  BulletChange,
  CompanyFact,
  EvidenceItem,
  JobInsights,
  JobRequirement,
  LetterPlan,
  OmittedEntry,
  QualityReview,
  RequirementMatch,
  TailoringStrategy,
} from "./personalization";

export const APPLICATION_STATUSES = [
  "discovered",
  "interested",
  "preparing",
  "ready",
  "applied",
  "interview",
  "offer",
  "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  discovered: "Discovered",
  interested: "Interested",
  preparing: "Preparing",
  ready: "Ready to Apply",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Workplace = "remote" | "hybrid" | "onsite" | "unknown";
export const SOURCE_KINDS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "catapa", "themuse", "himalayas", "manual"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Where a job can be worked from, for a candidate in Indonesia (shared/regions.ts). */
export const REGIONS = ["indonesia", "remote_open", "remote_asia", "remote_unknown", "asia", "other", "unknown"] as const;
export type Region = (typeof REGIONS)[number];
/** Which regions discovery keeps and lists: Indonesia and remote roles, also on-site in Asia, or anywhere. */
export const SEARCH_SCOPES = ["indonesia_remote", "asia", "anywhere"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];
export type DocumentKind = "master_cv" | "tailored_cv" | "cover_letter" | "answers";
export type RemotePreference = "any" | "remote" | "hybrid" | "onsite";

export interface JobSkills {
  required: string[];
  preferred: string[];
}

export interface MatchResult {
  version: number;
  score: number;
  matchedSkills: string[];
  missingRequired: string[];
  missingPreferred: string[];
  roles: string[];
  highlights: string[];
  concerns: string[];
  breakdown: { skills: number; role: number; location: number; eligibility: number };
}

export interface Profile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  links: { label: string; url: string }[];
  headline: string;
  education: string;
  graduationDate: string | null;
  skills: string[];
  targetRoles: string[];
  preferredLocations: string[];
  remotePreference: RemotePreference;
  searchScope: SearchScope;
  workAuthorization: string;
  keywordsInclude: string[];
  keywordsExclude: string[];
  notifyMinScore: number;
  updatedAt: string;
}

export interface ApplicationRef {
  id: number;
  status: ApplicationStatus;
  priority: Priority;
}

export interface JobSummary {
  id: number;
  company: string;
  title: string;
  location: string;
  workplace: Workplace;
  region: Region;
  sourceKind: SourceKind;
  url: string;
  postedAt: string | null;
  deadline: string | null;
  firstSeenAt: string;
  matchScore: number | null;
  duplicateOf: number | null;
  dismissedAt: string | null;
  closedAt: string | null;
  application: ApplicationRef | null;
}

export interface JobDetail extends JobSummary {
  applyUrl: string;
  department: string;
  employmentType: string;
  duration: string;
  description: string;
  skills: JobSkills;
  matchDetail: MatchResult | null;
  /** Requirement → evidence analysis and tailoring strategy (shared/personalization.ts). */
  insights: JobInsights | null;
  /** The posting, master CV, knowledge notes or profile changed since the insights were built. */
  insightsStale: boolean;
  sourceName: string | null;
  lastSeenAt: string;
  duplicates: JobSummary[];
  documents: DocumentSummary[];
}

export interface Application {
  id: number;
  jobId: number;
  status: ApplicationStatus;
  priority: Priority;
  notes: string;
  cvDocumentId: number | null;
  coverLetterId: number | null;
  checklist: Record<string, boolean>;
  appliedAt: string | null;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
  job: JobSummary;
}

export interface DocumentChange {
  section: string;
  change: string;
  reason: string;
}

export interface Grounding {
  claim: string;
  source: string;
}

export interface DocumentMeta {
  /** "latex" for documents in the résumé template (shared/cvTemplate.ts). */
  format?: "latex" | "markdown";
  generator?: string;
  filename?: string;
  changes?: DocumentChange[];
  warnings?: string[];
  grounding?: Grounding[];
  questions?: string[];
  parentContent?: string;
  // Personalization (tailored CVs and cover letters)
  strategy?: TailoringStrategy;
  requirements?: JobRequirement[];
  matches?: RequirementMatch[];
  /** Evidence the document and its requirement map cite. */
  evidence?: EvidenceItem[];
  bulletChanges?: BulletChange[];
  omitted?: OmittedEntry[];
  plan?: LetterPlan;
  companyFacts?: CompanyFact[];
  /** What the candidate asked a cover letter to reflect. */
  angle?: string;
  review?: QualityReview;
}

export interface DocumentSummary {
  id: number;
  kind: DocumentKind;
  title: string;
  jobId: number | null;
  parentId: number | null;
  status: "draft" | "approved";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  job?: { company: string; title: string } | null;
}

export interface Document extends DocumentSummary {
  content: string;
  generatedContent: string | null;
  meta: DocumentMeta;
}

export interface Source {
  id: number;
  kind: SourceKind;
  identifier: string;
  name: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastFound: number;
  jobCount: number;
}

export interface Notification {
  id: number;
  kind: "new_match" | "deadline" | "source_error";
  title: string;
  body: string;
  jobId: number | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: number;
  entityType: "job" | "application" | "document" | "source" | "profile";
  entityId: number | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
  label?: string | null;
}

export interface DiscoveryRun {
  id: number;
  trigger: "cron" | "manual";
  startedAt: string;
  finishedAt: string | null;
  sourcesChecked: number;
  jobsSeen: number;
  jobsNew: number;
  errors: { source: string; message: string }[];
}

export interface Overview {
  counts: Record<ApplicationStatus, number>;
  newThisWeek: number;
  unreadNotifications: number;
  upcomingDeadlines: JobSummary[];
  hasMasterCv: boolean;
  profileComplete: boolean;
  aiProvider: string;
}

export interface ApplyKit {
  application: Application;
  job: JobDetail;
  cv: Document | null;
  coverLetter: Document | null;
  answers: Document | null;
  steps: { key: string; label: string; detail: string; done: boolean; optional?: boolean }[];
}
