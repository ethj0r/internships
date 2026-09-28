// The candidate knowledge base: the master CV broken into citable evidence, plus the notes the candidate adds
// (details behind an entry, hackathons, open source, coursework, motivations) and their profile. Generated
// documents may only make claims that trace back to an evidence id from here.

import { entryKey, isLatexCv, parseLatexCv, plain, type CvDoc, type CvEntry, type CvItem } from "../../shared/cv";
import { NOTE_KIND_LABELS, type EvidenceItem, type KnowledgeEntry, type KnowledgeNote, type NoteKind } from "../../shared/personalization";
import { extractSkills } from "../../shared/skills";
import type { Document, Profile } from "../../shared/types";
import { getActiveMasterCv, parseJson } from "../lib/db";

export interface Knowledge {
  master: Document | null;
  doc: CvDoc | null;
  /** CV entries (and the skills section) with their own evidence. */
  entries: KnowledgeEntry[];
  notes: KnowledgeNote[];
  /** Everything citable: CV evidence, knowledge notes and profile. */
  evidence: EvidenceItem[];
  byId: Map<string, EvidenceItem>;
  /** Master CV entry id ("experiences-0") → evidence group ("exp1"). */
  groupOfEntryId: Map<string, string>;
}

function groupPrefix(sectionKey: string): string {
  if (/education/.test(sectionKey)) return "edu";
  if (/experience|employment|work/.test(sectionKey)) return "exp";
  if (/leader|activit|volunteer|organi/.test(sectionKey)) return "lead";
  if (/project/.test(sectionKey)) return "proj";
  if (/award|certif|honou?r/.test(sectionKey)) return "award";
  if (/research|paper|publication/.test(sectionKey)) return "paper";
  return "sec";
}

const DATE_LIKE = /\b(?:19|20)\d{2}\b|present|current/i;

function evidence(partial: Omit<EvidenceItem, "technologies">): EvidenceItem {
  return { ...partial, technologies: extractSkills(partial.text) };
}

const flat = (rich: string) => plain(rich).replace(/\n/g, " | ").trim();

function fromCvDoc(doc: CvDoc): { entries: KnowledgeEntry[]; groupOfEntryId: Map<string, string> } {
  const entries: KnowledgeEntry[] = [];
  const groupOfEntryId = new Map<string, string>();
  const counters = new Map<string, number>();
  const usedKeys = new Set<string>();

  for (const s of doc.sections) {
    if (s.type === "skills") {
      const items = s.lines.map((l, i) =>
        evidence({ id: `skills.${i + 1}`, group: "skills", entryKey: "skills", kind: "skills", section: s.title, label: s.title, text: `${l.label}: ${l.items.map(flat).join(", ")}` }),
      );
      entries.push({ entryKey: "skills", group: "skills", section: s.title, label: s.title, date: "", evidence: items });
      continue;
    }
    if (s.type !== "entries" && s.type !== "items") continue;

    const list: (CvEntry | CvItem)[] = s.type === "entries" ? s.entries : s.items;
    const prefix = groupPrefix(s.key);
    for (const x of list) {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      const group = `${prefix}${n}`;
      const baseKey = entryKey(s.key, x);
      let key = baseKey;
      for (let k = 2; usedKeys.has(key); k++) key = `${baseKey}-${k}`;
      usedKeys.add(key);
      groupOfEntryId.set(x.id, group);

      const { label, date, heading } =
        "title" in x
          ? {
              label: [flat(x.title), flat(x.subtitle)].filter(Boolean).join(", "),
              date: [x.subtitleRight, x.titleRight].map(flat).find((t) => DATE_LIKE.test(t)) ?? "",
              heading: [x.title, x.subtitle, x.titleRight, x.subtitleRight].map(flat).filter(Boolean).join(" | "),
            }
          : { label: flat(x.heading).split(" | ")[0]!, date: flat(x.date), heading: [flat(x.heading), flat(x.date)].filter(Boolean).join(" | ") };
      const base = { group, entryKey: key, section: s.title, label };
      entries.push({
        entryKey: key,
        group,
        section: s.title,
        label,
        date,
        evidence: [
          evidence({ ...base, id: `${group}.h`, kind: "heading", text: heading }),
          ...x.bullets.map((b, i) => evidence({ ...base, id: `${group}.b${i + 1}`, kind: "bullet", text: flat(b) })),
        ],
      });
    }
  }
  return { entries, groupOfEntryId };
}

/** Masters that aren't LaTeX have no entry structure: every line becomes evidence under its nearest heading. */
function fromText(text: string): KnowledgeEntry[] {
  const items: EvidenceItem[] = [];
  let section = "CV";
  for (const raw of text.split("\n")) {
    const heading = raw.match(/^#{1,6}\s+(.+)$/)?.[1]?.replace(/\*\*/g, "").trim();
    if (heading) section = heading;
    const line = heading ?? raw.replace(/^\s*(?:[-*•]|\d+\.)\s+/, "").replace(/\*\*|__/g, "").trim();
    if (line.length < 3) continue;
    items.push(evidence({ id: `cv.${items.length + 1}`, group: "cv", entryKey: "cv", kind: heading ? "heading" : "bullet", section, label: section, text: line }));
  }
  return items.length ? [{ entryKey: "cv", group: "cv", section: "CV", label: "Master CV", date: "", evidence: items }] : [];
}

export function buildKnowledge(master: Document | null, notes: KnowledgeNote[], profile: Profile): Knowledge {
  const doc = master && isLatexCv(master.content) ? parseLatexCv(master.content) : null;
  const { entries, groupOfEntryId } = doc ? fromCvDoc(doc) : { entries: master ? fromText(master.content) : [], groupOfEntryId: new Map<string, string>() };
  const byKey = new Map(entries.map((e) => [e.entryKey, e]));

  const noteEvidence = notes.map((note) => {
    const entry = note.entryKey ? byKey.get(note.entryKey) : undefined;
    return evidence({
      id: `note${note.id}`,
      group: entry?.group ?? `note${note.id}`,
      entryKey: entry?.entryKey ?? null,
      kind: "note",
      section: entry?.section ?? NOTE_KIND_LABELS[note.kind],
      label: entry?.label ?? (note.title || NOTE_KIND_LABELS[note.kind]),
      text: [note.title && entry ? `${note.title}:` : "", note.body.replace(/\s+/g, " ").trim(), ...note.links.map((l) => l.url)].filter(Boolean).join(" "),
    });
  });

  const profileBase = { group: "profile", entryKey: null, section: "Profile" } as const;
  const profileEvidence: EvidenceItem[] = [];
  if (profile.headline) profileEvidence.push(evidence({ ...profileBase, id: "profile.headline", kind: "heading", label: "Headline", text: profile.headline }));
  if (profile.education) profileEvidence.push(evidence({ ...profileBase, id: "profile.education", kind: "heading", label: "Education", text: profile.education }));
  if (profile.skills.length) profileEvidence.push(evidence({ ...profileBase, id: "profile.skills", kind: "skills", label: "Skills you listed", text: profile.skills.join(", ") }));

  const all = [...entries.flatMap((e) => e.evidence), ...noteEvidence, ...profileEvidence];
  return { master, doc, entries, notes, evidence: all, byId: new Map(all.map((e) => [e.id, e])), groupOfEntryId };
}

export async function loadKnowledge(db: D1Database, profile: Profile): Promise<Knowledge> {
  const [master, notes] = await Promise.all([getActiveMasterCv(db), listNotes(db)]);
  return buildKnowledge(master, notes, profile);
}

/** Evidence describing one CV entry: its heading and bullets plus the notes attached to it. */
export function groupEvidence(k: Knowledge, group: string): EvidenceItem[] {
  return k.evidence.filter((e) => e.group === group);
}

/** Plain text of every piece of evidence, for fabrication checks. */
export function evidenceText(k: Knowledge): string {
  return k.evidence.map((e) => e.text).join("\n");
}

/** The knowledge base in a compact, citable form for prompts. */
export function knowledgeForPrompt(k: Knowledge): string {
  const groups = new Map<string, EvidenceItem[]>();
  for (const e of k.evidence) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);
  const lines: string[] = [];
  for (const [group, items] of groups) {
    const first = items[0]!;
    lines.push(`[${group}] ${first.section}: ${first.label}`);
    for (const e of items) lines.push(`  ${e.id}${e.kind === "note" ? " (candidate's note)" : ""}: ${e.text}`);
  }
  return lines.join("\n");
}

// ---------- Notes ----------

interface NoteRow {
  id: number;
  entry_key: string | null;
  kind: NoteKind;
  title: string;
  body: string;
  links: string;
  created_at: string;
  updated_at: string;
}

export function toNote(r: NoteRow): KnowledgeNote {
  return { id: r.id, entryKey: r.entry_key, kind: r.kind, title: r.title, body: r.body, links: parseJson(r.links, []), createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function listNotes(db: D1Database): Promise<KnowledgeNote[]> {
  const { results } = await db.prepare("SELECT * FROM knowledge_notes ORDER BY entry_key IS NULL, created_at").all<NoteRow>();
  return results.map(toNote);
}

export async function getNote(db: D1Database, id: number): Promise<KnowledgeNote | null> {
  const row = await db.prepare("SELECT * FROM knowledge_notes WHERE id = ?").bind(id).first<NoteRow>();
  return row ? toNote(row) : null;
}
