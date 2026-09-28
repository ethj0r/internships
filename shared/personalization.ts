// Evidence-based personalization, shared by the Worker and the web client.
//
// Tailoring runs on meaning, not keyword overlap: a job is broken into requirements and the competencies
// behind them, each requirement is mapped to evidence from the candidate's knowledge base, and every claim in
// a generated document must trace back to an evidence id. See docs/personalization.md.

export const EVIDENCE_STRENGTHS = ["strong", "relevant", "transferable", "weak", "gap", "unknown"] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

export const STRENGTH_LABELS: Record<EvidenceStrength, string> = {
  strong: "Strong Match",
  relevant: "Relevant Match",
  transferable: "Transferable",
  weak: "Weak Evidence",
  gap: "Gap",
  unknown: "Unknown",
};

export const STRENGTH_HINTS: Record<EvidenceStrength, string> = {
  strong: "Directly demonstrated by your experience",
  relevant: "Demonstrated by closely related experience",
  transferable: "The competency exists, in a different context",
  weak: "Some indication, but not enough proof",
  gap: "No credible evidence",
  unknown: "Not enough information to judge",
};

/** Strengths that need at least one piece of evidence behind them. */
export const EVIDENCED_STRENGTHS: readonly EvidenceStrength[] = ["strong", "relevant", "transferable", "weak"];

export const REQUIREMENT_KINDS = ["required", "preferred", "responsibility", "context"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const REQUIREMENT_KIND_LABELS: Record<RequirementKind, string> = {
  required: "Required",
  preferred: "Preferred",
  responsibility: "Responsibility",
  context: "Context",
};

export const NOTE_KINDS = ["context", "achievement", "project", "open_source", "hackathon", "coursework", "motivation", "other"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  context: "Details",
  achievement: "Achievement",
  project: "Project",
  open_source: "Open Source",
  hackathon: "Hackathon or Competition",
  coursework: "Coursework",
  motivation: "Interests and Motivation",
  other: "Other",
};

/** One citable fact about the candidate. Ids are stable for a given master CV and knowledge base. */
export interface EvidenceItem {
  /** "exp1.b2" (bullet), "exp1.h" (heading), "skills.2" (skill line), "note12" (knowledge note). */
  id: string;
  /** Evidence sharing a group describes the same CV entry. */
  group: string;
  /** Stable key of the CV entry ("experiences/concorde-systems"), used to attach knowledge notes. */
  entryKey: string | null;
  kind: "heading" | "bullet" | "skills" | "note";
  section: string;
  label: string;
  text: string;
  technologies: string[];
}

export interface KnowledgeNote {
  id: number;
  entryKey: string | null;
  kind: NoteKind;
  title: string;
  body: string;
  links: { label: string; url: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEntry {
  entryKey: string;
  group: string;
  section: string;
  label: string;
  date: string;
  evidence: EvidenceItem[];
}

export interface KnowledgeBase {
  masterCvId: number | null;
  entries: KnowledgeEntry[];
  notes: KnowledgeNote[];
}

/** A fact about the company from public sources, kept only when a source is cited. */
export interface CompanyFact {
  id: string;
  text: string;
  sources: { url: string; title: string }[];
}

export interface JobRequirement {
  id: string;
  text: string;
  kind: RequirementKind;
  /** 1 (minor) to 5 (central to the role). */
  importance: number;
  competencies: string[];
  whyItMatters: string;
  convincingEvidence: string;
  /** Employer terminology worth reusing where it accurately describes the candidate's work. */
  employerTerms: string[];
}

export interface RequirementMatch {
  requirementId: string;
  strength: EvidenceStrength;
  evidenceIds: string[];
  rationale: string;
  cvAction: string;
  /** Set when validation changed the model's classification, with the reason. */
  correction?: string;
}

export interface TailoringStrategy {
  targetRole: string;
  topHiringSignals: string[];
  strongestEvidence: string[];
  secondaryEvidence: string[];
  importantGaps: string[];
  deemphasize: string[];
  cvStrategy: string;
  coverLetterAngle: string;
}

export interface JobInsights {
  version: number;
  roleSummary: string;
  companyContext: string;
  requirements: JobRequirement[];
  matches: RequirementMatch[];
  strategy: TailoringStrategy;
  companyFacts: CompanyFact[];
  /** "web" when public sources were searched; "posting" when only the job posting was available. */
  research: "web" | "posting";
  concerns: string[];
  /** Snapshot of the evidence the analysis could cite. */
  evidence: EvidenceItem[];
  generator: string;
  createdAt: string;
  inputsHash: string;
}

export interface BulletChange {
  section: string;
  entryLabel: string;
  original: string[];
  tailored: string;
  /** The rejected rewrite, when status is "reverted". */
  proposed?: string;
  /** kept: unchanged; rewritten: reworded from its evidence; reverted: rewrite rejected, original kept; removed: left out. */
  status: "rewritten" | "kept" | "reverted" | "removed";
  reason: string;
  requirementIds: string[];
  evidenceIds: string[];
  /** Why a rewrite was rejected, and anything worth a second look. */
  issues: string[];
}

export interface OmittedEntry {
  section: string;
  label: string;
  reason: string;
}

export interface NarrativeStep {
  need: string;
  experience: string;
  whyItMatters: string;
  requirementIds: string[];
  evidenceIds: string[];
}

export interface LetterPlan {
  companyNeed: string;
  whyRole: string;
  whyCompany: string;
  companyFactIds: string[];
  narrative: NarrativeStep[];
  contribution: string;
  motivation: string;
}

export const CV_CRITERIA = ["relevance", "evidence", "credibility", "clarity", "impact", "ats", "keywords", "consistency", "truthfulness"] as const;
export const COVER_LETTER_CRITERIA = [
  "company_specificity",
  "role_specificity",
  "narrative",
  "evidence",
  "authenticity",
  "conciseness",
  "natural_language",
  "cv_consistency",
  "reason_for_applying",
] as const;
export type QualityCriterion = (typeof CV_CRITERIA)[number] | (typeof COVER_LETTER_CRITERIA)[number];

export const CRITERION_LABELS: Record<QualityCriterion, string> = {
  relevance: "Relevance",
  evidence: "Evidence Strength",
  credibility: "Technical Credibility",
  clarity: "Clarity",
  impact: "Impact",
  ats: "ATS Readability",
  keywords: "Keyword Accuracy",
  consistency: "Consistency",
  truthfulness: "No Fabricated Claims",
  company_specificity: "Company Specificity",
  role_specificity: "Role Specificity",
  narrative: "Narrative",
  authenticity: "Authenticity",
  conciseness: "Conciseness",
  natural_language: "Avoids Generic AI Language",
  cv_consistency: "Consistent with CV",
  reason_for_applying: "Clear Reason for Applying",
};

export interface QualityScore {
  criterion: QualityCriterion;
  /** 1 (poor) to 5 (excellent). */
  score: number;
  note: string;
}

export interface QualityIssue {
  severity: "blocking" | "warning";
  message: string;
  quote: string;
  /** "check" for deterministic checks, "review" for the model's review. */
  source: "check" | "review";
}

export interface QualityReview {
  verdict: "ready" | "needs_work";
  summary: string;
  scores: QualityScore[];
  issues: QualityIssue[];
  /** Generation attempts before this review (a draft that fails review is regenerated once). */
  attempts: number;
  generator: string;
  reviewedAt: string;
  /** The document was edited after this review. */
  stale: boolean;
}

/** Phrases hiring managers single out as filler in AI-written applications. Lowercase. */
export const GENERIC_PHRASES = [
  "passionate about",
  "i am passionate",
  "thrilled to",
  "excited to apply",
  "i am excited to",
  "i am writing to express",
  "i am writing to apply",
  "fast-paced",
  "leverage",
  "leveraging",
  "synergy",
  "proven track record",
  "results-driven",
  "team player",
  "self-starter",
  "detail-oriented",
  "hit the ground running",
  "cutting-edge",
  "innovative company",
  "dynamic environment",
  "unique opportunity",
  "perfect fit",
  "ideal candidate",
  "wealth of experience",
  "testament to",
  "delve",
  "tapestry",
  "think outside the box",
  "make a meaningful impact",
  "keen interest",
  "i believe i would be",
] as const;

export function findGenericPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return GENERIC_PHRASES.filter((p) => new RegExp(`(?<![a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`).test(lower));
}
