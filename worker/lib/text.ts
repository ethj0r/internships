// Text normalization helpers: HTML → Markdown, fingerprints, deadline / duration / workplace detection.

import type { Workplace } from "../../shared/types";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·",
  copy: "©", reg: "®", trade: "™", eacute: "é", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#")) {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function inlineText(s: string): string {
  return decodeEntities(stripTags(s)).replace(/\s+/g, " ").trim();
}

/** Converts job-board HTML to readable Markdown. Output is plain text plus a small Markdown subset. */
export function htmlToMarkdown(html: string): string {
  let s = html;
  // Greenhouse returns HTML-escaped HTML.
  if (/&lt;\/?[a-z]/i.test(s) && !/<\/?[a-z][^>]*>/i.test(s)) s = decodeEntities(s);

  s = s
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, t: string) => {
      const text = inlineText(t);
      return text ? `\n\n### ${text}\n\n` : "";
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t: string) => `\n- ${inlineText(t)}`)
    .replace(/<\/?(ul|ol)[^>]*>/gi, "\n\n")
    .replace(/<\/?(p|div|section|article|header|footer|table|tbody|tr|blockquote)[^>]*>/gi, "\n\n")
    .replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => {
      const text = inlineText(t);
      return text ? `**${text}**` : "";
    })
    .replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => {
      const text = inlineText(t);
      return text ? `*${text}*` : "";
    })
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, t: string) => {
      const text = inlineText(t);
      return /^https?:\/\//i.test(href) && text ? `[${text}](${href})` : text;
    });

  s = decodeEntities(stripTags(s))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^\*\*([^*\n]{2,80}?):?\*\*:?$/gm, "### $1")
    .replace(/^- \s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Pasted plain text → Markdown paragraphs, keeping list items and headings intact. */
export function plainTextToMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*[•▪●◦][ \t]*/gm, "- ")
    .replace(/([^\n])\n(?!\n|[ \t]*[-*][ \t]|[ \t]*#)/g, "$1\n\n")
    .trim();
}

/** Strips Markdown syntax for keyword scanning. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\((m\/w\/d|f\/m\/d|m\/f\/d|w\/m\/d|all genders)\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeCompany(s: string): string {
  return normalizeKey(s)
    .replace(/\b(inc|llc|ltd|gmbh|corp|corporation|co|technologies|labs|plc)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryCity(location: string): string {
  const first = location.split(/[;|/•]|,| or /i)[0] ?? "";
  return normalizeKey(first.replace(/remote|hybrid/gi, ""));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same role at the same company and city ⇒ same fingerprint, regardless of which platform listed it. */
export function jobFingerprint(company: string, title: string, location: string): Promise<string> {
  return sha256Hex(`${normalizeCompany(company)}|${normalizeKey(title)}|${primaryCity(location)}`);
}

export function detectWorkplace(location: string, title: string, description: string, hint?: string | null): Workplace {
  const h = (hint ?? "").toLowerCase();
  if (/remote/.test(h)) return "remote";
  if (/hybrid/.test(h)) return "hybrid";
  if (/on-?site|in[- ]office/.test(h)) return "onsite";
  const head = `${location} ${title}`;
  if (/hybrid/i.test(head)) return "hybrid";
  if (/remote/i.test(head)) return "remote";
  if (/\b(fully remote|remote[- ]first|100% remote|work from anywhere)\b/i.test(description)) return "remote";
  if (/\bhybrid\b/i.test(description)) return "hybrid";
  return location.trim() ? "onsite" : "unknown";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function isoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

function parseDateNear(fragment: string): string | null {
  let m = fragment.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoDate(+m[1]!, +m[2]!, +m[3]!);
  m = fragment.match(new RegExp(`${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "i"));
  if (m) return isoDate(+m[3]!, MONTHS[m[1]!.slice(0, 3).toLowerCase()]!, +m[2]!);
  m = fragment.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})`, "i"));
  if (m) return isoDate(+m[3]!, MONTHS[m[2]!.slice(0, 3).toLowerCase()]!, +m[1]!);
  m = fragment.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return isoDate(+m[3]!, +m[1]!, +m[2]!);
  return null;
}

/** Finds an explicit application deadline ("Apply by March 15, 2027") in a description. */
export function parseDeadline(text: string, now = new Date()): string | null {
  const cue =
    /(application deadline|deadline to apply|deadline|apply by|applications? (?:close|closes|closing|due|will close|are due)|closing date|submit (?:your )?applications? by|accepting applications (?:until|through))/gi;
  for (const match of text.matchAll(cue)) {
    const fragment = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 48);
    const date = parseDateNear(fragment);
    if (!date) continue;
    const year = +date.slice(0, 4);
    if (year >= now.getUTCFullYear() - 1 && year <= now.getUTCFullYear() + 2) return date;
  }
  return null;
}

/** Extracts "12 weeks" / "Summer 2027" style duration hints. */
export function parseDuration(title: string, text: string): string {
  const parts: string[] = [];
  const span = text.match(/\b(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?[\s-]*(weeks?|months?)\b/i);
  if (span) {
    const lo = +span[1]!;
    const hi = span[2] ? +span[2] : lo;
    const unit = span[3]!.toLowerCase().startsWith("week") ? "weeks" : "months";
    const plausible = unit === "weeks" ? lo >= 4 && hi <= 52 : lo >= 2 && hi <= 12;
    if (plausible) parts.push(span[2] ? `${lo}–${hi} ${unit}` : `${lo} ${unit}`);
  }
  const season = `${title} ${text}`.match(/\b(summer|fall|autumn|winter|spring)\s+(20\d{2})\b/i);
  if (season) parts.push(`${season[1]![0]!.toUpperCase()}${season[1]!.slice(1).toLowerCase()} ${season[2]}`);
  return parts.join(", ");
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n\n[truncated]`;
}
