import { documentText, isLatexCv } from "../../shared/cv";
import type { DocumentKind, SourceKind, Workplace } from "../../shared/types";

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Just now", "3h ago", "Yesterday", "Tuesday", "Sep 2", "Sep 2, 2025". */
export function relativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return formatDate(iso, now);
}

export function formatDate(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function daysUntil(dateStr: string, now = new Date()): number {
  return Math.round((startOfDay(new Date(`${dateStr}T12:00:00`)) - startOfDay(now)) / DAY);
}

export function deadlineLabel(dateStr: string | null | undefined, now = new Date()): string {
  if (!dateStr) return "";
  const days = daysUntil(dateStr, now);
  if (days < 0) return `Closed ${formatDate(dateStr, now)}`;
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  if (days <= 14) return `Closes in ${days} days`;
  return `Closes ${formatDate(dateStr, now)}`;
}

export function isNew(iso: string, now = new Date()): boolean {
  return now.getTime() - new Date(iso).getTime() < DAY;
}

export const WORKPLACE_LABELS: Record<Workplace, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unknown: "",
};

export const SOURCE_LABELS: Record<SourceKind, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  themuse: "The Muse",
  manual: "Added by you",
};

export function scoreTier(score: number | null | undefined): "high" | "mid" | "low" {
  if (score == null) return "low";
  return score >= 75 ? "high" : score >= 50 ? "mid" : "low";
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const KIND_LABELS: Record<DocumentKind, string> = {
  master_cv: "Master CV",
  tailored_cv: "Tailored CV",
  cover_letter: "Cover Letter",
  answers: "Application Answers",
};

/** Plain text of any stored document (LaTeX CV or Markdown), for pasting into application forms. */
export function copyableText(content: string): string {
  return isLatexCv(content) ? documentText(content, { urls: false }) : markdownToPlainText(content);
}

/** Plain text for pasting into application forms. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
