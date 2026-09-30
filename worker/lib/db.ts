// Row mapping and small D1 helpers. SQL lives next to the feature that uses it.

import type { Eligibility, EligibilityStatus } from "../../shared/eligibility";
import type { Tier } from "../../shared/priority";
import type {
  Application,
  ApplicationStatus,
  AuditEvent,
  Document,
  DocumentKind,
  DocumentMeta,
  DocumentSummary,
  JobDetail,
  JobSkills,
  JobSummary,
  Priority,
  Profile,
  Region,
  RemotePreference,
  SearchScope,
  SourceKind,
  Workplace,
} from "../../shared/types";

export const nowIso = () => new Date().toISOString();

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function eventStmt(
  db: D1Database,
  entityType: AuditEvent["entityType"],
  entityId: number | null,
  action: string,
  detail: Record<string, unknown> = {},
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO events (entity_type, entity_id, action, detail) VALUES (?, ?, ?, ?)")
    .bind(entityType, entityId, action, JSON.stringify(detail));
}

export function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------- Jobs ----------

export interface JobRow {
  id: number;
  company: string;
  title: string;
  location: string;
  workplace: Workplace;
  region: Region;
  source_kind: SourceKind;
  url: string;
  posted_at: string | null;
  deadline: string | null;
  first_seen_at: string;
  match_score: number | null;
  duplicate_of: number | null;
  dismissed_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  eligibility_status: EligibilityStatus;
  eligibility: string | null;
  priority_tier: number;
  season: string | null;
  priority_score: number;
  app_id: number | null;
  app_status: ApplicationStatus | null;
  app_priority: Priority | null;
}

export interface JobDetailRow extends JobRow {
  source_id: number | null;
  external_id: string;
  department: string;
  employment_type: string;
  duration: string;
  apply_url: string;
  description: string;
  skills: string;
  fingerprint: string;
  match_detail: string | null;
  last_seen_at: string;
  source_name: string | null;
}

export const JOB_SUMMARY_SELECT = `j.id, j.company, j.title, j.location, j.workplace, j.region, j.source_kind, j.url, j.posted_at,
  j.deadline, j.first_seen_at, j.match_score, j.duplicate_of, j.dismissed_at, j.closed_at, j.closed_reason,
  j.eligibility_status, j.eligibility, j.priority_tier, j.season, j.priority_score,
  a.id AS app_id, a.status AS app_status, a.priority AS app_priority`;

export const JOB_DETAIL_SELECT = `${JOB_SUMMARY_SELECT}, j.source_id, j.external_id, j.department, j.employment_type,
  j.duration, j.apply_url, j.description, j.skills, j.fingerprint, j.match_detail,
  j.last_seen_at, s.name AS source_name`;

export function toJobSummary(r: JobRow): JobSummary {
  return {
    id: r.id,
    company: r.company,
    title: r.title,
    location: r.location,
    workplace: r.workplace,
    region: r.region,
    sourceKind: r.source_kind,
    url: r.url,
    postedAt: r.posted_at,
    deadline: r.deadline,
    firstSeenAt: r.first_seen_at,
    matchScore: r.match_score,
    duplicateOf: r.duplicate_of,
    dismissedAt: r.dismissed_at,
    closedAt: r.closed_at,
    closedReason: r.closed_reason,
    eligibilityStatus: r.eligibility_status,
    eligibility: parseJson<Eligibility | null>(r.eligibility, null),
    priorityTier: (r.priority_tier || 4) as Tier,
    season: r.season,
    priorityScore: r.priority_score,
    application: r.app_id && r.app_status && r.app_priority ? { id: r.app_id, status: r.app_status, priority: r.app_priority } : null,
  };
}

export function toJobDetail(r: JobDetailRow, duplicates: JobSummary[], documents: DocumentSummary[]): JobDetail {
  return {
    ...toJobSummary(r),
    applyUrl: r.apply_url || r.url,
    department: r.department,
    employmentType: r.employment_type,
    duration: r.duration,
    description: r.description,
    skills: parseJson<JobSkills>(r.skills, { required: [], preferred: [] }),
    matchDetail: parseJson(r.match_detail, null),
    insights: null,
    insightsStale: false,
    sourceName: r.source_name,
    lastSeenAt: r.last_seen_at,
    duplicates,
    documents,
  };
}

export async function getJobDetailRow(db: D1Database, id: number): Promise<JobDetailRow | null> {
  return db
    .prepare(
      `SELECT ${JOB_DETAIL_SELECT} FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       LEFT JOIN sources s ON s.id = j.source_id
       WHERE j.id = ?`,
    )
    .bind(id)
    .first<JobDetailRow>();
}

// ---------- Applications ----------

export interface ApplicationRow extends JobRow {
  app_id: number;
  app_status: ApplicationStatus;
  app_priority: Priority;
  job_id: number;
  notes: string;
  cv_document_id: number | null;
  cover_letter_id: number | null;
  checklist: string;
  applied_at: string | null;
  status_changed_at: string;
  app_created_at: string;
  app_updated_at: string;
}

export const APPLICATION_SELECT = `${JOB_SUMMARY_SELECT}, a.job_id, a.notes, a.cv_document_id, a.cover_letter_id,
  a.checklist, a.applied_at, a.status_changed_at, a.created_at AS app_created_at, a.updated_at AS app_updated_at`;

export function toApplication(r: ApplicationRow): Application {
  return {
    id: r.app_id,
    jobId: r.job_id,
    status: r.app_status,
    priority: r.app_priority,
    notes: r.notes,
    cvDocumentId: r.cv_document_id,
    coverLetterId: r.cover_letter_id,
    checklist: parseJson<Record<string, boolean>>(r.checklist, {}),
    appliedAt: r.applied_at,
    statusChangedAt: r.status_changed_at,
    createdAt: r.app_created_at,
    updatedAt: r.app_updated_at,
    job: toJobSummary(r),
  };
}

export async function getApplicationRow(db: D1Database, where: "a.id" | "a.job_id", id: number): Promise<ApplicationRow | null> {
  return db
    .prepare(`SELECT ${APPLICATION_SELECT} FROM applications a JOIN jobs j ON j.id = a.job_id WHERE ${where} = ?`)
    .bind(id)
    .first<ApplicationRow>();
}

// ---------- Documents ----------

export interface DocumentRow {
  id: number;
  kind: DocumentKind;
  title: string;
  job_id: number | null;
  parent_id: number | null;
  status: "draft" | "approved";
  is_active: number;
  created_at: string;
  updated_at: string;
  job_company: string | null;
  job_title: string | null;
  content?: string;
  generated_content?: string | null;
  meta?: string;
}

export const DOCUMENT_SUMMARY_SELECT = `d.id, d.kind, d.title, d.job_id, d.parent_id, d.status, d.is_active, d.created_at,
  d.updated_at, j.company AS job_company, j.title AS job_title`;

export function toDocumentSummary(r: DocumentRow): DocumentSummary {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    jobId: r.job_id,
    parentId: r.parent_id,
    status: r.status,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    job: r.job_company && r.job_title ? { company: r.job_company, title: r.job_title } : null,
  };
}

export function toDocument(r: DocumentRow): Document {
  return {
    ...toDocumentSummary(r),
    content: r.content ?? "",
    generatedContent: r.generated_content ?? null,
    meta: parseJson<DocumentMeta>(r.meta, {}),
  };
}

export async function getDocument(db: D1Database, id: number): Promise<Document | null> {
  const row = await db
    .prepare(
      `SELECT ${DOCUMENT_SUMMARY_SELECT}, d.content, d.generated_content, d.meta
       FROM documents d LEFT JOIN jobs j ON j.id = d.job_id WHERE d.id = ?`,
    )
    .bind(id)
    .first<DocumentRow>();
  return row ? toDocument(row) : null;
}

export async function getActiveMasterCv(db: D1Database): Promise<Document | null> {
  const row = await db
    .prepare("SELECT id FROM documents WHERE kind = 'master_cv' ORDER BY is_active DESC, updated_at DESC LIMIT 1")
    .first<{ id: number }>();
  return row ? getDocument(db, row.id) : null;
}

export async function getLatestJobDocument(db: D1Database, jobId: number, kind: DocumentKind): Promise<Document | null> {
  const row = await db
    .prepare("SELECT id FROM documents WHERE job_id = ? AND kind = ? ORDER BY status = 'approved' DESC, updated_at DESC LIMIT 1")
    .bind(jobId, kind)
    .first<{ id: number }>();
  return row ? getDocument(db, row.id) : null;
}

// ---------- Profile ----------

interface ProfileRow {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  links: string;
  headline: string;
  education: string;
  graduation_date: string | null;
  skills: string;
  target_roles: string;
  preferred_locations: string;
  remote_preference: RemotePreference;
  search_scope: SearchScope;
  work_authorization: string;
  sg_work_authorization: string;
  keywords_include: string;
  keywords_exclude: string;
  notify_min_score: number;
  updated_at: string;
}

export async function getProfile(db: D1Database): Promise<Profile> {
  const r = await db.prepare("SELECT * FROM profile WHERE id = 1").first<ProfileRow>();
  if (!r) throw new Error("Profile row is missing. Run the database migrations.");
  return {
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    location: r.location,
    links: parseJson(r.links, []),
    headline: r.headline,
    education: r.education,
    graduationDate: r.graduation_date,
    skills: parseJson(r.skills, []),
    targetRoles: parseJson(r.target_roles, []),
    preferredLocations: parseJson(r.preferred_locations, []),
    remotePreference: r.remote_preference,
    searchScope: r.search_scope ?? "indonesia_remote",
    workAuthorization: r.work_authorization,
    sgWorkAuthorization: r.sg_work_authorization ?? "",
    keywordsInclude: parseJson(r.keywords_include, []),
    keywordsExclude: parseJson(r.keywords_exclude, []),
    notifyMinScore: r.notify_min_score,
    updatedAt: r.updated_at,
  };
}
