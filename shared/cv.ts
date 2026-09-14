// Structured CV model for the LaTeX résumé template (shared/cvTemplate.ts).
//
// LaTeX source ⇄ CvDoc ⇄ rich text. Text fields use a small markup so the same content can be
// rendered to LaTeX, HTML and plain text: **bold**, *italic*, [text](url), ^{sup}, _{sub}, and
// "\n" for a line break. A literal asterisk is written as \*.

import { TEMPLATE_PREAMBLE } from "./cvTemplate";
import { extractSkills } from "./skills";

export interface CvContact {
  text: string;
  url: string | null;
}

export interface CvHeader {
  name: string;
  contacts: CvContact[];
}

/** \resumeSubheading{title}{titleRight}{subtitle}{subtitleRight} with bullets. */
export interface CvEntry {
  id: string;
  title: string;
  titleRight: string;
  subtitle: string;
  subtitleRight: string;
  bullets: string[];
}

/** \resumeProjectHeading{heading}{date} with bullets. */
export interface CvItem {
  id: string;
  heading: string;
  date: string;
  bullets: string[];
}

export interface CvSkillLine {
  label: string;
  items: string[];
}

interface SectionBase {
  key: string;
  title: string;
  /** Rich text shown at the right of the section title (\hfill …). */
  note: string;
}

export type CvSection =
  | (SectionBase & { type: "entries"; spaced: boolean; entries: CvEntry[] })
  | (SectionBase & { type: "items"; variant: "plain" | "spaced" | "wrap"; items: CvItem[] })
  | (SectionBase & { type: "skills"; lines: CvSkillLine[] })
  | (SectionBase & { type: "raw"; latex: string });

export interface CvDoc {
  header: CvHeader;
  sections: CvSection[];
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

export type RichNode =
  | { t: "text"; v: string }
  | { t: "b" | "i"; c: RichNode[] }
  | { t: "a"; href: string; c: RichNode[] }
  | { t: "sup" | "sub"; v: string }
  | { t: "br" };

export function parseRich(input: string): RichNode[] {
  const s = input;
  let i = 0;

  const hasClosingStar = (from: number): boolean => {
    for (let j = from; j < s.length; j++) {
      if (s[j] === "\\") {
        j++;
        continue;
      }
      if (s[j] === "*") {
        if (s[j + 1] === "*") {
          j++;
          continue;
        }
        return true;
      }
    }
    return false;
  };

  const parse = (until: "**" | "*" | null): RichNode[] => {
    const out: RichNode[] = [];
    let buf = "";
    const flush = () => {
      if (buf) out.push({ t: "text", v: buf });
      buf = "";
    };
    while (i < s.length) {
      const ch = s[i]!;
      if (until === "**" && s.startsWith("**", i)) {
        i += 2;
        flush();
        return out;
      }
      if (until === "*" && ch === "*" && s[i + 1] !== "*") {
        i += 1;
        flush();
        return out;
      }
      if (ch === "\\" && i + 1 < s.length && "*[]\\".includes(s[i + 1]!)) {
        buf += s[i + 1];
        i += 2;
        continue;
      }
      if (ch === "\n") {
        flush();
        out.push({ t: "br" });
        i++;
        continue;
      }
      if (until !== "**" && s.startsWith("**", i) && s.indexOf("**", i + 2) > -1) {
        flush();
        i += 2;
        out.push({ t: "b", c: parse("**") });
        continue;
      }
      if (until !== "*" && ch === "*" && s[i + 1] !== "*" && hasClosingStar(i + 1)) {
        flush();
        i += 1;
        out.push({ t: "i", c: parse("*") });
        continue;
      }
      if (ch === "[" || ch === "^" || ch === "_") {
        const rest = s.slice(i);
        const link = /^\[((?:\\.|[^\]\\])*)\]\(([^()\s]*)\)/.exec(rest);
        if (link) {
          flush();
          out.push({ t: "a", href: link[2]!, c: parseRich(link[1]!) });
          i += link[0].length;
          continue;
        }
        const script = /^([\^_])\{([^{}]*)\}/.exec(rest);
        if (script) {
          flush();
          out.push({ t: script[1] === "^" ? "sup" : "sub", v: script[2]! });
          i += script[0].length;
          continue;
        }
      }
      buf += ch;
      i++;
    }
    flush();
    return out;
  };

  return parse(null);
}

export function richToPlain(nodes: RichNode[], opts: { urls?: boolean } = {}): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
          return n.v;
        case "b":
        case "i":
          return richToPlain(n.c, opts);
        case "a": {
          const text = richToPlain(n.c, opts);
          const url = n.href.replace(/^mailto:/, "");
          return opts.urls && url !== text ? `${text} (${url})` : text;
        }
        case "sup":
        case "sub":
          return n.v;
        case "br":
          return "\n";
      }
    })
    .join("");
}

export function plain(rich: string, opts: { urls?: boolean } = {}): string {
  return richToPlain(parseRich(rich), opts);
}

const LATEX_SPECIALS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "|": "$|$",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
};

const UNICODE_TO_LATEX: Record<string, string> = {
  "–": "--",
  "—": "---",
  "‘": "`",
  "’": "'",
  "“": "``",
  "”": "''",
  "…": "\\ldots{}",
  "•": "$\\bullet$",
  "→": "$\\rightarrow$",
  "←": "$\\leftarrow$",
  "≥": "$\\geq$",
  "≤": "$\\leq$",
  "×": "$\\times$",
  "±": "$\\pm$",
  "≈": "$\\approx$",
  " ": "~",
  "²": "\\textsuperscript{2}",
  "³": "\\textsuperscript{3}",
  "₂": "\\textsubscript{2}",
  "°": "\\textdegree{}",
};

/** Escapes plain text for pdfLaTeX with T1 fonts. Characters the fonts can't show are dropped. */
export function escapeLatex(text: string): string {
  let out = "";
  for (const ch of text) {
    const special = LATEX_SPECIALS[ch] ?? UNICODE_TO_LATEX[ch];
    if (special !== undefined) out += special;
    else if (ch.codePointAt(0)! <= 0x17f) out += ch;
  }
  return out;
}

function escapeUrl(url: string): string {
  return url.replace(/[{}\\]/g, "").replace(/\s/g, "%20").replace(/[%#]/g, (m) => `\\${m}`);
}

/** URLs taken from LaTeX, made safe for the [text](url) markup (no spaces or parentheses). */
function cleanUrl(raw: string): string {
  return raw
    .replace(/\\([%#&_~])/g, "$1")
    .trim()
    .replace(/\s/g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

export function richToLatex(nodes: RichNode[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
          return escapeLatex(n.v);
        case "b":
          return `\\textbf{${richToLatex(n.c)}}`;
        case "i":
          return `\\textit{${richToLatex(n.c)}}`;
        case "a":
          return `\\href{${escapeUrl(n.href)}}{${richToLatex(n.c)}}`;
        case "sup":
          return `\\textsuperscript{${escapeLatex(n.v)}}`;
        case "sub":
          return `\\textsubscript{${escapeLatex(n.v)}}`;
        case "br":
          return " \\newline ";
      }
    })
    .join("");
}

const latex = (rich: string) => richToLatex(parseRich(rich));

// ---------------------------------------------------------------------------
// LaTeX → CvDoc
// ---------------------------------------------------------------------------

export function isLatexCv(content: string): boolean {
  return /\\begin\s*\{document\}/.test(content);
}

function readGroup(src: string, from: number): { content: string; end: number } | null {
  let j = from;
  while (j < src.length && /\s/.test(src[j]!)) j++;
  if (src[j] !== "{") return null;
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    const ch = src[k];
    if (ch === "\\") {
      k++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { content: src.slice(j + 1, k), end: k + 1 };
    }
  }
  return null;
}

const NEWLINE_MARK = "";
const ARGLESS_SKIP_SPACE = /^[a-zA-Z]+$/;

/** Converts inline LaTeX (as used in the template) to rich text. */
export function latexToRich(src: string): string {
  let out = "";
  let i = 0;
  const group = () => {
    const g = readGroup(src, i);
    if (!g) return "";
    i = g.end;
    return g.content;
  };
  const skipSpaces = () => {
    while (src[i] === " " || src[i] === "\t") i++;
  };
  const wrap = (marker: string, inner: string) => (inner.trim() ? `${marker}${inner}${marker}` : inner);

  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+\*?|.)/.exec(src.slice(i, i + 40));
      if (!m) {
        i++;
        continue;
      }
      const name = m[1]!;
      i += m[0].length;
      switch (name) {
        case "textbf":
          out += wrap("**", latexToRich(group()));
          break;
        case "textit":
        case "emph":
        case "textsl":
          out += wrap("*", latexToRich(group()));
          break;
        case "href": {
          const url = cleanUrl(group());
          out += `[${latexToRich(group())}](${url})`;
          break;
        }
        case "url": {
          const url = cleanUrl(group());
          out += `[${url}](${url})`;
          break;
        }
        case "textsuperscript":
          out += `^{${plain(latexToRich(group()))}}`;
          break;
        case "textsubscript":
          out += `_{${plain(latexToRich(group()))}}`;
          break;
        case "newline":
        case "\\":
          out += NEWLINE_MARK;
          skipSpaces();
          break;
        case "textsc":
        case "text":
        case "mbox":
        case "underline":
        case "textnormal":
          out += latexToRich(group());
          break;
        case "vspace":
        case "hspace":
        case "vspace*":
        case "hspace*":
          group();
          break;
        case "ldots":
        case "dots":
          out += "…";
          break;
        case "textbar":
          out += "|";
          break;
        case "textasciitilde":
          out += "~";
          break;
        case "textbackslash":
          out += "\\\\";
          break;
        case "&":
        case "%":
        case "$":
        case "#":
        case "_":
        case "{":
        case "}":
          out += name;
          break;
        case " ":
          out += " ";
          break;
        default:
          // Font switches (\small, \scshape, \hfill …) and unknown commands: drop the command itself.
          if (ARGLESS_SKIP_SPACE.test(name)) skipSpaces();
      }
      continue;
    }
    if (ch === "{") {
      out += latexToRich(group());
      continue;
    }
    if (ch === "}") {
      i++;
      continue;
    }
    if (ch === "$") {
      const end = src.indexOf("$", i + 1);
      const math = end > -1 ? src.slice(i + 1, end) : "";
      i = end > -1 ? end + 1 : src.length;
      if (math.trim() === "|") out += "|";
      else if (/\\bullet/.test(math)) out += "•";
      else out += math.replace(/\\[a-zA-Z]+/g, "").replace(/[{}]/g, "").trim();
      continue;
    }
    if (ch === "~") {
      out += " ";
      i++;
      continue;
    }
    if (src.startsWith("---", i)) {
      out += "—";
      i += 3;
      continue;
    }
    if (src.startsWith("--", i)) {
      out += "–";
      i += 2;
      continue;
    }
    if (src.startsWith("``", i)) {
      out += "“";
      i += 2;
      continue;
    }
    if (src.startsWith("''", i)) {
      out += "”";
      i += 2;
      continue;
    }
    if (ch === "*") {
      out += "\\*";
      i++;
      continue;
    }
    out += /\s/.test(ch) ? " " : ch;
    i++;
  }

  return out
    .replace(/ {2,}/g, " ")
    .replace(new RegExp(` ?${NEWLINE_MARK} ?`, "g"), "\n")
    .trim();
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

function stripComments(tex: string): string {
  return tex
    .split("\n")
    .map((line) => line.replace(/(?<!\\)%.*$/, ""))
    .join("\n");
}

function findMacros(src: string, pattern: RegExp): { name: string; index: number; end: number }[] {
  const re = new RegExp(pattern.source, "g");
  const found: { name: string; index: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) found.push({ name: m[0], index: m.index, end: m.index + m[0].length });
  return found;
}

function readArgs(src: string, from: number, count: number): { args: string[]; end: number } {
  const args: string[] = [];
  let end = from;
  for (let n = 0; n < count; n++) {
    const g = readGroup(src, end);
    if (!g) break;
    args.push(g.content);
    end = g.end;
  }
  return { args, end };
}

function extractBullets(region: string): string[] {
  const bullets: string[] = [];
  for (const macro of findMacros(region, /\\resumeItem(?![a-zA-Z])/)) {
    const g = readGroup(region, macro.end);
    if (g) bullets.push(latexToRich(g.content));
  }
  return bullets;
}

function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseHeader(body: string): CvHeader {
  const center = /\\begin\s*\{center\}([\s\S]*?)\\end\s*\{center\}/.exec(body)?.[1] ?? body.split(/\\section/)[0] ?? "";
  const bold = /\\textbf\s*\{/.exec(center);
  let name = "";
  let rest = center;
  if (bold) {
    const g = readGroup(center, bold.index + bold[0].length - 1);
    if (g) {
      name = plain(latexToRich(g.content));
      rest = center.slice(g.end);
      const lineBreak = rest.indexOf("\\\\");
      if (lineBreak > -1 && lineBreak < 40) rest = rest.slice(lineBreak + 2);
    }
  }
  const contacts = latexToRich(rest)
    .split(/\s*\|\s*|\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): CvContact => {
      const nodes = parseRich(part);
      const only = nodes.length === 1 ? nodes[0] : null;
      if (only?.t === "a") return { text: richToPlain(only.c), url: only.href };
      return { text: richToPlain(nodes), url: null };
    });
  return { name, contacts };
}

function parseSection(key: string, title: string, note: string, content: string): CvSection {
  const base = { key, title, note };

  const subheadings = findMacros(content, /\\resumeSubheading(?:Spaced)?(?![a-zA-Z])/);
  if (subheadings.length) {
    const entries = subheadings.map((macro, n): CvEntry => {
      const { args, end } = readArgs(content, macro.end, 4);
      const region = content.slice(end, subheadings[n + 1]?.index ?? content.length);
      return {
        id: `${key}-${n}`,
        title: latexToRich(args[0] ?? ""),
        titleRight: latexToRich(args[1] ?? ""),
        subtitle: latexToRich(args[2] ?? ""),
        subtitleRight: latexToRich(args[3] ?? ""),
        bullets: extractBullets(region),
      };
    });
    return { ...base, type: "entries", spaced: /Spaced/.test(subheadings[0]!.name), entries };
  }

  const headings = findMacros(content, /\\resumeProjectHeading(?:Spaced|Wrap)?(?![a-zA-Z])/);
  if (headings.length) {
    const items = headings.map((macro, n): CvItem => {
      const { args, end } = readArgs(content, macro.end, 2);
      const region = content.slice(end, headings[n + 1]?.index ?? content.length);
      return { id: `${key}-${n}`, heading: latexToRich(args[0] ?? ""), date: latexToRich(args[1] ?? ""), bullets: extractBullets(region) };
    });
    const first = headings[0]!.name;
    return { ...base, type: "items", variant: first.endsWith("Wrap") ? "wrap" : first.endsWith("Spaced") ? "spaced" : "plain", items };
  }

  if (/\\textbf\s*\{[^{}]*\}\s*:/.test(content)) {
    const lines: CvSkillLine[] = [];
    for (const piece of content.split(/\\\\/)) {
      const label = /\\textbf\s*\{/.exec(piece);
      if (!label) continue;
      const g = readGroup(piece, label.index + label[0].length - 1);
      if (!g) continue;
      const after = piece.slice(g.end).replace(/^\s*:/, "");
      const items = splitTopLevelCommas(latexToRich(after));
      if (items.length) lines.push({ label: plain(latexToRich(g.content)), items });
    }
    if (lines.length) return { ...base, type: "skills", lines };
  }

  return { ...base, type: "raw", latex: content.trim() };
}

/** Parses a résumé written with the template's macros. Returns null if it isn't a LaTeX document. */
export function parseLatexCv(tex: string): CvDoc | null {
  const body = /\\begin\s*\{document\}([\s\S]*?)(?:\\end\s*\{document\}|$)/.exec(stripComments(tex))?.[1];
  if (body === undefined) return null;

  const starts: { index: number; end: number; title: string }[] = [];
  for (const macro of findMacros(body, /\\section\*?(?![a-zA-Z])/)) {
    const g = readGroup(body, macro.end);
    if (g) starts.push({ index: macro.index, end: g.end, title: g.content });
  }

  const sections = starts.map((s, n): CvSection => {
    const content = body.slice(s.end, starts[n + 1]?.index ?? body.length);
    const hfill = s.title.search(/\\hfill(?![a-zA-Z])/);
    const titleLatex = hfill > -1 ? s.title.slice(0, hfill) : s.title;
    const noteLatex = hfill > -1 ? s.title.slice(hfill + "\\hfill".length) : "";
    const title = plain(latexToRich(titleLatex));
    return parseSection(slug(title), title, latexToRich(noteLatex), content.replace(/\\vspace\s*\{[^}]*\}\s*$/, ""));
  });

  const header = parseHeader(body);
  if (!header.name && !sections.length) return null;
  return { header, sections };
}

// ---------------------------------------------------------------------------
// CvDoc → LaTeX / plain text
// ---------------------------------------------------------------------------

function bulletList(bullets: string[], indent: string): string[] {
  if (!bullets.length) return [];
  return [`${indent}\\resumeItemListStart`, ...bullets.map((b) => `${indent}  \\resumeItem{${latex(b)}}`), `${indent}\\resumeItemListEnd`];
}

function renderSection(s: CvSection, isLast: boolean): string[] {
  const title = `\\section{${escapeLatex(s.title)}${s.note ? ` \\hfill {\\normalfont\\small ${latex(s.note)}}` : ""}}`;
  const lines = [`%-----------${s.title.toUpperCase()}-----------`, title];

  switch (s.type) {
    case "entries": {
      const macro = s.spaced ? "\\resumeSubheadingSpaced" : "\\resumeSubheading";
      lines.push(s.spaced ? "\\resumeSubHeadingListStartSpaced" : "\\resumeSubHeadingListStart");
      for (const e of s.entries) {
        if (s.spaced) lines.push("");
        lines.push(`  ${macro}`, `    {${latex(e.title)}}{${latex(e.titleRight)}}`, `    {${latex(e.subtitle)}}{${latex(e.subtitleRight)}}`, ...bulletList(e.bullets, "    "));
      }
      if (s.spaced) lines.push("");
      lines.push("\\resumeSubHeadingListEnd");
      if (s.spaced && !isLast) lines.push("", "\\vspace{8pt}");
      break;
    }
    case "items": {
      if (s.variant === "plain") {
        lines.push("\\begin{itemize}[leftmargin=0.15in, label={}, itemsep=1.7pt]", "\\small");
        for (const it of s.items) lines.push("  \\resumeProjectHeading", `    {${latex(it.heading)}}{${latex(it.date)}}`, ...bulletList(it.bullets, "    "));
        lines.push("\\end{itemize}", "\\vspace{-1pt}");
        break;
      }
      const macro = s.variant === "wrap" ? "\\resumeProjectHeadingWrap" : "\\resumeProjectHeadingSpaced";
      lines.push("\\resumeSubHeadingListStartSpaced");
      for (const it of s.items) lines.push("", `  ${macro}`, `    {${latex(it.heading)}}{${latex(it.date)}}`, ...bulletList(it.bullets, "    "));
      lines.push("", "\\resumeSubHeadingListEnd");
      if (!isLast) lines.push("", "\\vspace{8pt}");
      break;
    }
    case "skills":
      lines.push(
        "\\begin{itemize}[leftmargin=0.15in, label={}]",
        "\\small{\\item{",
        ...s.lines.map((l) => `\\textbf{${escapeLatex(l.label)}}: ${l.items.map(latex).join(", ")} \\\\`),
        "}}",
        "\\end{itemize}",
      );
      break;
    case "raw":
      lines.push(s.latex);
      break;
  }
  return lines;
}

export function cvToLatex(doc: CvDoc): string {
  const contacts = doc.header.contacts.map((c, i) => {
    const text = c.url ? `\\href{${escapeUrl(c.url)}}{${escapeLatex(c.text)}}` : escapeLatex(c.text);
    return `  ${text}${i < doc.header.contacts.length - 1 ? " $|$" : ""}`;
  });
  const lines = [
    TEMPLATE_PREAMBLE.trimEnd(),
    "",
    "\\begin{document}",
    "",
    "%----------HEADING----------",
    "\\begin{center}",
    `  {\\Huge \\scshape \\textbf{${escapeLatex(doc.header.name)}}} \\\\ \\vspace{4pt}`,
    "  \\small",
    ...contacts,
    "\\end{center}",
    "",
  ];
  doc.sections.forEach((s, i) => lines.push(...renderSection(s, i === doc.sections.length - 1), ""));
  lines.push("\\end{document}", "");
  return lines.join("\n");
}

export function cvToPlainText(doc: CvDoc, opts: { urls?: boolean } = {}): string {
  const p = (rich: string) => plain(rich, opts).replace(/\n/g, " | ");
  const join = (left: string, right: string) => (right ? `${left} | ${right}` : left);
  const out: string[] = [doc.header.name, doc.header.contacts.map((c) => (opts.urls && c.url && c.url.replace(/^mailto:/, "") !== c.text ? `${c.text} (${c.url.replace(/^mailto:/, "")})` : c.text)).join(" | ")];

  for (const s of doc.sections) {
    out.push("", s.title.toUpperCase());
    switch (s.type) {
      case "entries":
        for (const e of s.entries) {
          out.push(join(p(e.title), p(e.titleRight)), join(p(e.subtitle), p(e.subtitleRight)), ...e.bullets.map((b) => `- ${p(b)}`));
        }
        break;
      case "items":
        for (const it of s.items) out.push(join(p(it.heading), p(it.date)), ...it.bullets.map((b) => `- ${p(b)}`));
        break;
      case "skills":
        for (const l of s.lines) out.push(`${l.label}: ${l.items.map(p).join(", ")}`);
        break;
      case "raw":
        out.push(plain(latexToRich(s.latex), opts));
        break;
    }
  }
  return out.join("\n").trim();
}

/** Text of a stored CV for matching, prompts and checks: LaTeX is flattened, anything else is returned as is. */
export function documentText(content: string, opts: { urls?: boolean } = { urls: true }): string {
  if (!isLatexCv(content)) return content;
  const doc = parseLatexCv(content);
  return doc ? cvToPlainText(doc, opts) : latexToRich(content);
}

/** The header lines of a CV (name and contact details), for checking that they survived tailoring. */
export function headerText(content: string): string {
  if (isLatexCv(content)) {
    const doc = parseLatexCv(content);
    return doc ? cvToPlainText({ header: doc.header, sections: [] }, { urls: true }) : "";
  }
  return content.slice(0, 500);
}

// ---------------------------------------------------------------------------
// Tailoring
// ---------------------------------------------------------------------------

export interface CvTailoring {
  entries: { id: string; bullets: string[] }[];
  skills: { label: string; items: string[] }[];
}

/** What the job asks for, used to rank entries, bullets and skills deterministically. */
export interface CvRelevance {
  required: string[];
  preferred: string[];
}

function normalizeItem(rich: string): string {
  return plain(rich).toLowerCase().replace(/\s+/g, " ").trim();
}

/** How much a piece of CV text overlaps with the job: required skills count double. */
function relevanceScore(rich: string, relevance: CvRelevance): number {
  const found = new Set(extractSkills(plain(rich), { includeImplied: true }));
  return relevance.required.filter((s) => found.has(s)).length * 2 + relevance.preferred.filter((s) => found.has(s)).length;
}

function entryText(x: CvEntry | CvItem): string {
  return ["heading" in x ? x.heading : `${x.title}\n${x.subtitle}`, ...x.bullets].join("\n");
}

type SectionRule = { keepAll: true } | { keepAll: false; min: number; max: number; orderByRelevance: boolean };

/**
 * Which entries a tailored CV keeps. Education, experience and one-line awards are always kept in the master's
 * order; projects, leadership and research are selected by relevance, so a weak model can't strip the CV bare.
 */
function sectionRule(s: CvSection): SectionRule {
  if (s.type === "entries") {
    if (/education|experience|employment|work/.test(s.key)) return { keepAll: true };
    return { keepAll: false, min: 1, max: 3, orderByRelevance: false };
  }
  if (s.type === "items") {
    if (s.variant === "plain") return { keepAll: true };
    if (/research|paper|publication/.test(s.key)) return { keepAll: false, min: 0, max: 2, orderByRelevance: true };
    return { keepAll: false, min: 3, max: 4, orderByRelevance: true };
  }
  return { keepAll: true };
}

/**
 * Applies a model's choices to the master CV. Only selection, order, bullet wording and skill order can change:
 * the header, section titles, organizations, roles, dates, locations and headings always come from the master.
 */
export function applyTailoring(master: CvDoc, tailoring: CvTailoring, relevance: CvRelevance = { required: [], preferred: [] }): CvDoc {
  const chosen = new Map<string, { order: number; bullets: string[] }>();
  tailoring.entries.forEach((e, order) => {
    if (!chosen.has(e.id)) chosen.set(e.id, { order, bullets: e.bullets });
  });

  const tailorBullets = (id: string, masterBullets: string[]) => {
    const proposed = (chosen.get(id)?.bullets ?? []).map((b) => b.trim()).filter(Boolean);
    if (proposed.length && masterBullets.length) return proposed.slice(0, masterBullets.length);
    // No rewrite: lead with the bullets closest to the job.
    return masterBullets
      .map((b, i) => ({ b, i, score: relevanceScore(b, relevance) }))
      .sort((x, y) => y.score - x.score || x.i - y.i)
      .map((x) => x.b);
  };

  const pick = <T extends CvEntry | CvItem>(s: CvSection, list: T[]): T[] => {
    const rule = sectionRule(s);
    const withBullets = (x: T): T => ({ ...x, bullets: tailorBullets(x.id, x.bullets) });
    if (rule.keepAll) return list.map(withBullets);

    const ranked = list
      .map((x, index) => ({ x, index, score: relevanceScore(entryText(x), relevance), model: chosen.get(x.id)?.order }))
      .sort((a, b) => {
        const am = a.model ?? Number.POSITIVE_INFINITY;
        const bm = b.model ?? Number.POSITIVE_INFINITY;
        return am - bm || b.score - a.score || a.index - b.index;
      });
    const selected = ranked.filter((r, rank) => r.model !== undefined || r.score > 0 || rank < rule.min).slice(0, Math.max(rule.max, rule.min));
    const ordered = rule.orderByRelevance ? selected : [...selected].sort((a, b) => a.index - b.index);
    return ordered.map((r) => withBullets(r.x));
  };

  const sections: CvSection[] = [];
  for (const s of master.sections) {
    if (s.type === "entries") {
      const entries = pick(s, s.entries);
      if (entries.length) sections.push({ ...s, entries });
    } else if (s.type === "items") {
      const items = pick(s, s.items);
      if (items.length) sections.push({ ...s, items });
    } else if (s.type === "skills") {
      const lines = s.lines.map((line) => {
        const proposal = tailoring.skills.find((l) => l.label.trim().toLowerCase() === line.label.trim().toLowerCase());
        const byKey = new Map(line.items.map((item) => [normalizeItem(item), item]));
        const proposed = proposal ? [...new Set(proposal.items.map(normalizeItem))].map((k) => byKey.get(k)).filter((x): x is string => Boolean(x)) : [];
        // Keep every skill the master lists; the proposal (or relevance) only decides the order.
        const lead = proposed.length ? proposed : line.items.filter((item) => relevanceScore(item, relevance) > 0);
        const items = [...lead, ...line.items.filter((item) => !lead.includes(item))];
        return { ...line, items };
      });
      sections.push({ ...s, lines });
    } else {
      sections.push(s);
    }
  }
  return { header: master.header, sections };
}

function entryName(x: CvEntry | CvItem): string {
  return "title" in x ? plain(x.subtitle ? `${x.title}, ${x.subtitle}` : x.title) : plain(x.heading).split(/\s*\|\s*|\n/)[0]!;
}

/** Deterministic summary of what tailoring changed, shown next to the model's own notes. */
export function describeTailoring(master: CvDoc, tailored: CvDoc): { section: string; change: string; reason: string }[] {
  const changes: { section: string; change: string; reason: string }[] = [];
  for (const { section, names } of omittedEntries(master, tailored)) {
    changes.push({ section, change: `Left out ${names.join("; ")}`, reason: "Less relevant to this posting. You can add them back in the Edit view." });
  }
  for (const s of tailored.sections) {
    const original = master.sections.find((m) => m.key === s.key);
    if (!original) continue;
    if (s.type === "skills" && original.type === "skills") {
      const moved = s.lines.filter((l, i) => l.items.join() !== original.lines[i]?.items.join());
      if (moved.length) {
        changes.push({
          section: s.title,
          change: `Listed ${moved.map((l) => `${l.items.slice(0, 3).map((x) => plain(x)).join(", ")} first in ${l.label}`).join("; ")}`,
          reason: "These match what the posting asks for.",
        });
      }
    }
    if ((s.type === "entries" && original.type === "entries") || (s.type === "items" && original.type === "items")) {
      const list: (CvEntry | CvItem)[] = s.type === "entries" ? s.entries : s.items;
      const originals: (CvEntry | CvItem)[] = original.type === "entries" ? original.entries : original.items;
      const reordered = list.filter((x) => {
        const o = originals.find((m) => m.id === x.id);
        return o && o.bullets.join("\n") !== x.bullets.join("\n") && [...o.bullets].sort().join("\n") === [...x.bullets].sort().join("\n");
      });
      if (reordered.length) {
        changes.push({ section: s.title, change: `Put the most relevant bullets first for ${reordered.map(entryName).join("; ")}`, reason: "Leads with the work closest to this role." });
      }
      const order = list.map((x) => x.id).join();
      const originalOrder = originals.filter((m) => list.some((x) => x.id === m.id)).map((m) => m.id).join();
      if (order !== originalOrder) {
        changes.push({ section: s.title, change: `Ordered as ${list.map(entryName).join(", ")}`, reason: "Most relevant to this posting first." });
      }
    }
  }
  return changes;
}

/** Human-readable list of entries the tailored CV leaves out, per section. */
export function omittedEntries(master: CvDoc, tailored: CvDoc): { section: string; names: string[] }[] {
  const kept = new Set(
    tailored.sections.flatMap((s) => (s.type === "entries" ? s.entries.map((e) => e.id) : s.type === "items" ? s.items.map((i) => i.id) : [])),
  );
  const result: { section: string; names: string[] }[] = [];
  for (const s of master.sections) {
    const names =
      s.type === "entries"
        ? s.entries.filter((e) => !kept.has(e.id)).map((e) => plain(e.subtitle ? `${e.title}, ${e.subtitle}` : e.title))
        : s.type === "items"
          ? s.items.filter((i) => !kept.has(i.id)).map((i) => plain(i.heading).split(/\s*\|\s*|\n/)[0]!)
          : [];
    if (names.length) result.push({ section: s.title, names });
  }
  return result;
}

/** Compact description of the master CV for the model: ids, context and editable text only. */
export function cvForPrompt(doc: CvDoc) {
  return {
    sections: doc.sections.flatMap((s): Record<string, unknown>[] => {
      switch (s.type) {
        case "entries":
          return [
            {
              section: s.title,
              ...(sectionRule(s).keepAll ? { always_included: true } : {}),
              entries: s.entries.map((e) => ({
                id: e.id,
                organization: plain(e.title),
                role: plain(e.subtitle),
                details: [plain(e.titleRight), plain(e.subtitleRight)].filter(Boolean).join(", "),
                bullets: e.bullets,
              })),
            },
          ];
        case "items":
          return [{ section: s.title, entries: s.items.map((i) => ({ id: i.id, heading: plain(i.heading).replace(/\n/g, " | "), date: plain(i.date), bullets: i.bullets })) }];
        case "skills":
          return [{ section: s.title, skill_lines: s.lines.map((l) => ({ label: l.label, items: l.items.map((x) => plain(x)) })) }];
        case "raw":
          return [];
      }
    }),
  };
}
