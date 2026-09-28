import { Hono } from "hono";
import { z } from "zod";
import { NOTE_KINDS, type KnowledgeBase } from "../../shared/personalization";
import { eventStmt, getProfile, nowIso } from "../lib/db";
import { idParam, notFound, readJson, type AppEnv } from "../lib/validate";
import { getNote, loadKnowledge } from "../personalization/knowledge";

export const knowledge = new Hono<AppEnv>();

knowledge.get("/", async (c) => {
  const k = await loadKnowledge(c.env.DB, await getProfile(c.env.DB));
  return c.json({ masterCvId: k.master?.id ?? null, entries: k.entries, notes: k.notes } satisfies KnowledgeBase);
});

const NoteBody = z.object({
  entryKey: z.string().trim().min(1).max(300).nullable(),
  kind: z.enum(NOTE_KINDS),
  title: z.string().trim().max(200),
  body: z.string().trim().min(1, "Write the details").max(4000),
  links: z
    .array(
      z.object({
        label: z.string().trim().max(50),
        url: z
          .string()
          .trim()
          .max(500)
          .refine((v) => /^https?:\/\//i.test(v), "Enter a full URL, starting with https://"),
      }),
    )
    .max(5),
});

knowledge.post("/notes", async (c) => {
  const n = await readJson(c, NoteBody);
  const db = c.env.DB;
  const row = await db
    .prepare("INSERT INTO knowledge_notes (entry_key, kind, title, body, links) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(n.entryKey, n.kind, n.title, n.body, JSON.stringify(n.links))
    .first<{ id: number }>();
  if (!row) throw new Error("Couldn't save the note.");
  await eventStmt(db, "profile", 1, "knowledge_note_added", { noteId: row.id, kind: n.kind }).run();
  return c.json(await getNote(db, row.id), 201);
});

knowledge.patch("/notes/:id", async (c) => {
  const id = idParam(c);
  const patch = await readJson(c, NoteBody.partial());
  const db = c.env.DB;
  if (!(await getNote(db, id))) throw notFound("Note");

  const columns: [keyof typeof patch, string][] = [
    ["entryKey", "entry_key"],
    ["kind", "kind"],
    ["title", "title"],
    ["body", "body"],
    ["links", "links"],
  ];
  const sets: string[] = [];
  const params: (string | null)[] = [];
  for (const [field, column] of columns) {
    if (patch[field] === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(field === "links" ? JSON.stringify(patch.links) : (patch[field] as string | null));
  }
  if (sets.length) {
    await db.batch([
      db.prepare(`UPDATE knowledge_notes SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...params, nowIso(), id),
      eventStmt(db, "profile", 1, "knowledge_note_edited", { noteId: id }),
    ]);
  }
  return c.json(await getNote(db, id));
});

knowledge.delete("/notes/:id", async (c) => {
  const id = idParam(c);
  const db = c.env.DB;
  if (!(await getNote(db, id))) throw notFound("Note");
  await db.batch([db.prepare("DELETE FROM knowledge_notes WHERE id = ?").bind(id), eventStmt(db, "profile", 1, "knowledge_note_deleted", { noteId: id })]);
  return c.body(null, 204);
});
