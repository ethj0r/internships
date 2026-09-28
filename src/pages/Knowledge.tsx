import { useEffect, useState } from "react";
import { Link } from "react-router";
import { NOTE_KIND_LABELS, NOTE_KINDS, type KnowledgeEntry, type KnowledgeNote, type NoteKind } from "../../shared/personalization";
import { EmptyState, ErrorState, Field, Loading } from "../components/common";
import { Icon, Spinner } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { hostname, plural } from "../lib/format";
import { invalidate, useAction, useDocumentTitle, useResource } from "../lib/hooks";

interface EditTarget {
  note?: KnowledgeNote;
  entryKey: string | null;
  entryLabel?: string;
  kind: NoteKind;
}

const PLACEHOLDERS: Record<NoteKind, string> = {
  context: "What problem were you solving? What did you build or decide, and why? Any scale, constraints or results? Who did you work with?",
  achievement: "What did you achieve, where and when, and what did it take?",
  project: "What is it, what did you build, with which technologies, and what came of it?",
  open_source: "Which project, what did you contribute, and was it merged or used?",
  hackathon: "Which event, what did your team build, what was your part, and how did it place?",
  coursework: "Which course, and what did you build or learn that relates to engineering work?",
  motivation: "Which problems, products or kinds of work draw you, and why? What experience led you there?",
  other: "Anything true that an application could draw on.",
};

export function KnowledgePage() {
  const { data, error, loading, reload } = useResource("knowledge", api.knowledge);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeNote | null>(null);
  const toast = useToast();
  useDocumentTitle("Career Knowledge");

  const [remove, removing] = useAction(async (note: KnowledgeNote) => {
    await api.deleteNote(note.id);
    invalidate("knowledge", "job:");
    setDeleting(null);
    toast.show("Note deleted");
  }, toast.error);

  if (!data) return <div className="page">{loading ? <Loading /> : error && <ErrorState error={error} onRetry={() => void reload()} />}</div>;

  const keys = new Set(data.entries.map((e) => e.entryKey));
  const standalone = data.notes.filter((n) => !n.entryKey || !keys.has(n.entryKey));
  const sections: [string, KnowledgeEntry[]][] = [];
  for (const entry of data.entries) {
    const found = sections.find(([title]) => title === entry.section);
    if (found) found[1].push(entry);
    else sections.push([entry.section, [entry]]);
  }

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="large-title">Career Knowledge</h1>
            <p className="page-subtitle">The facts your applications are built from.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ entryKey: null, kind: "project" })}>
            <Icon name="plus" />
            Add Item
          </button>
        </header>

        <div className="notice" style={{ marginBottom: 32 }}>
          <Icon name="book" />
          <span>
            Tailored CVs and cover letters only claim what's here: your master CV plus the notes you add. Add the context a CV has no room for, like the problem, your
            technical decisions, scale, who you worked with and the result. Write only what's true, because it's treated as evidence.
          </span>
        </div>

        {!data.masterCvId && (
          <EmptyState
            icon="doc"
            title="Add your master CV first"
            message="Its entries become the backbone of your knowledge base."
            action={
              <Link className="btn btn-primary" to="/documents">
                Go to Documents
              </Link>
            }
          />
        )}

        {sections.map(([section, entries]) => (
          <section key={section} className="section">
            <div className="section-header">
              <h2 className="section-title">{section}</h2>
            </div>
            <div className="group">
              {entries.map((entry) => (
                <EntryRow
                  key={entry.entryKey}
                  entry={entry}
                  notes={data.notes.filter((n) => n.entryKey === entry.entryKey)}
                  onAdd={() => setEditing({ entryKey: entry.entryKey, entryLabel: entry.label, kind: "context" })}
                  onEdit={(note) => setEditing({ note, entryKey: note.entryKey, entryLabel: entry.label, kind: note.kind })}
                  onDelete={setDeleting}
                />
              ))}
            </div>
          </section>
        ))}

        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Beyond Your CV</h2>
          </div>
          <div className="group">
            {standalone.map((note) => (
              <div key={note.id} className="knowledge-body">
                <NoteCard
                  note={note}
                  context={note.entryKey ? "Its CV entry was renamed or removed" : undefined}
                  onEdit={() => setEditing({ note, entryKey: note.entryKey && keys.has(note.entryKey) ? note.entryKey : null, kind: note.kind })}
                  onDelete={() => setDeleting(note)}
                />
              </div>
            ))}
            <div className="row wrap" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setEditing({ entryKey: null, kind: "motivation" })}>
                <Icon name="plus" />
                Interests and Motivation
              </button>
              <button type="button" className="btn btn-sm btn-plain" onClick={() => setEditing({ entryKey: null, kind: "hackathon" })}>
                Hackathon or Competition
              </button>
              <button type="button" className="btn btn-sm btn-plain" onClick={() => setEditing({ entryKey: null, kind: "open_source" })}>
                Open Source
              </button>
            </div>
          </div>
          <p className="section-footer">
            Cover letters use your interests and motivation instead of inventing enthusiasm. Without them, a letter leaves a placeholder for you to fill in.
          </p>
        </section>
      </div>

      <NoteSheet target={editing} onClose={() => setEditing(null)} />
      <Sheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this note?"
        message="Applications you generate later won't be able to use it."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" style={{ background: "var(--color-red)" }} disabled={removing} onClick={() => deleting && void remove(deleting)}>
              Delete
            </button>
          </>
        }
      />
    </div>
  );
}

function EntryRow({
  entry,
  notes,
  onAdd,
  onEdit,
  onDelete,
}: {
  entry: KnowledgeEntry;
  notes: KnowledgeNote[];
  onAdd: () => void;
  onEdit: (note: KnowledgeNote) => void;
  onDelete: (note: KnowledgeNote) => void;
}) {
  const [open, setOpen] = useState(false);
  const facts = entry.evidence.filter((e) => e.kind !== "heading");
  return (
    <div className="knowledge-entry">
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="row-main">
          <span className="row-title" style={{ display: "block" }}>
            {entry.label}
          </span>
          <span className="row-subtitle" style={{ display: "block" }}>
            {[entry.date, plural(facts.length, "fact"), notes.length ? plural(notes.length, "note") : ""].filter(Boolean).join(", ")}
          </span>
        </span>
        <Icon name="chevron-right" className="row-chevron" style={{ transform: open ? "rotate(90deg)" : undefined }} />
      </button>
      {open && (
        <div className="knowledge-body stack-v">
          <ul className="evidence-list">
            {facts.map((e) => (
              <li key={e.id}>{e.text}</li>
            ))}
          </ul>
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} onEdit={() => onEdit(note)} onDelete={() => onDelete(note)} />
          ))}
          <div>
            <button type="button" className="btn btn-sm" onClick={onAdd}>
              <Icon name="plus" />
              Add Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteCard({ note, context, onEdit, onDelete }: { note: KnowledgeNote; context?: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="note-card">
      <div className="hstack" style={{ justifyContent: "space-between" }}>
        <span className="caption muted">
          {NOTE_KIND_LABELS[note.kind]}
          {context ? `. ${context}` : ""}
        </span>
        <span className="hstack" style={{ gap: 0 }}>
          <button type="button" className="btn btn-plain btn-sm" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn btn-plain btn-sm btn-destructive" onClick={onDelete}>
            Delete
          </button>
        </span>
      </div>
      {note.title && <p className="headline">{note.title}</p>}
      <p className="subhead" style={{ whiteSpace: "pre-wrap" }}>
        {note.body}
      </p>
      {note.links.length > 0 && (
        <p className="caption">
          {note.links.map((l, i) => (
            <span key={l.url}>
              {i > 0 && ", "}
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label || hostname(l.url)}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function NoteSheet({ target, onClose }: { target: EditTarget | null; onClose: () => void }) {
  const [kind, setKind] = useState<NoteKind>("context");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [links, setLinks] = useState("");
  const toast = useToast();

  useEffect(() => {
    if (!target) return;
    setKind(target.note?.kind ?? target.kind);
    setTitle(target.note?.title ?? "");
    setBody(target.note?.body ?? "");
    setLinks(target.note?.links.map((l) => l.url).join("\n") ?? "");
  }, [target]);

  const [save, saving] = useAction(async () => {
    if (!target) return;
    const input = {
      entryKey: target.entryKey,
      kind: target.entryKey ? "context" : kind,
      title: title.trim(),
      body: body.trim(),
      links: links
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 5)
        .map((url) => ({ label: hostname(url), url })),
    } as const;
    if (target.note) await api.updateNote(target.note.id, input);
    else await api.createNote(input);
    invalidate("knowledge", "job:");
    toast.show("Saved. Your next role analysis will use it.");
    onClose();
  }, toast.error);

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      wide
      title={target?.note ? "Edit note" : target?.entryLabel ? `Add details to ${target.entryLabel}` : "Add to your knowledge base"}
      message="Write it plainly, the way you'd explain it to an engineer. Applications treat it as evidence, so include only what's true."
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!body.trim() || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            Save
          </button>
        </>
      }
    >
      <div className="fields">
        {!target?.entryKey && (
          <Field label="Type" htmlFor="note-kind">
            <select id="note-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
              {NOTE_KINDS.filter((k) => k !== "context").map((k) => (
                <option key={k} value={k}>
                  {NOTE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Title" htmlFor="note-title" hint="Optional" className={target?.entryKey ? "full" : undefined}>
          <input id="note-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Details" htmlFor="note-body" className="full">
          <textarea
            id="note-body"
            className="textarea"
            rows={7}
            placeholder={PLACEHOLDERS[target?.entryKey ? "context" : kind]}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            data-autofocus
          />
        </Field>
        <Field label="Links" htmlFor="note-links" hint="Optional. One per line, like a repository, demo or write-up." className="full">
          <textarea id="note-links" className="textarea" rows={2} style={{ minHeight: 60 }} value={links} onChange={(e) => setLinks(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
