// Semantic retrieval: which of the candidate's real experiences are closest in meaning to each requirement.
//
// Evidence and requirements are embedded with an open multilingual model (EMBEDDING_MODEL, bge-m3 by default) and
// compared by cosine similarity. Retrieval only proposes candidates; the evidence judge (prompts/evidence_judge.md)
// decides. Embeddings are cached in D1 by model and text, so an unchanged knowledge base is embedded once.

import type { EvidenceItem, JobRequirement } from "../../shared/personalization";
import { embed } from "../ai/provider";
import { chunk, placeholders } from "../lib/db";
import { sha256Hex } from "../lib/text";

export interface Candidate {
  id: string;
  score: number;
}

export interface Retrieval {
  requirementId: string;
  candidates: Candidate[];
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** What gets embedded for a piece of evidence: its CV entry label gives the bullet context. */
export function evidenceEmbeddingText(e: EvidenceItem): string {
  return e.kind === "heading" ? `${e.section}: ${e.label}. ${e.text}` : `${e.label}: ${e.text}`;
}

export function requirementEmbeddingText(r: JobRequirement): string {
  return [r.text, r.competencies.length ? `Competencies: ${r.competencies.join(", ")}` : "", r.convincingEvidence].filter(Boolean).join(". ");
}

/** Embeds texts, reusing cached vectors. */
async function embedCached(env: Env, texts: string[]): Promise<number[][]> {
  const model = env.EMBEDDING_MODEL;
  const keys = await Promise.all(texts.map((t) => sha256Hex(`${model}\n${t}`)));
  const cached = new Map<string, number[]>();
  for (const group of chunk([...new Set(keys)], 90)) {
    const { results } = await env.DB.prepare(`SELECT key, vector FROM embeddings WHERE key IN (${placeholders(group.length)})`).bind(...group).all<{ key: string; vector: string }>();
    for (const r of results) cached.set(r.key, JSON.parse(r.vector) as number[]);
  }
  const missing = [...new Set(keys.map((k, i) => (cached.has(k) ? -1 : i)).filter((i) => i >= 0).map((i) => keys[i]!))];
  if (missing.length) {
    const firstIndex = new Map(keys.map((k, i) => [k, i] as const).reverse());
    const vectors = await embed(env, missing.map((k) => texts[firstIndex.get(k)!]!));
    const stmts = missing.map((k, i) => {
      cached.set(k, vectors[i]!);
      return env.DB.prepare("INSERT INTO embeddings (key, model, vector) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING").bind(k, model, JSON.stringify(vectors[i]));
    });
    for (const group of chunk(stmts, 50)) await env.DB.batch(group);
  }
  return keys.map((k) => cached.get(k)!);
}

/**
 * Top-k evidence per requirement. Skill lines and profile items are excluded (a tool in a list isn't evidence of
 * doing the work); at most `perGroup` items come from the same CV entry, so one strong entry can't crowd out the rest.
 */
export function rankCandidates(
  reqVectors: number[][],
  evidence: EvidenceItem[],
  evidenceVectors: number[][],
  requirements: JobRequirement[],
  opts: { k?: number; perGroup?: number } = {},
): Retrieval[] {
  const k = opts.k ?? 8;
  const perGroup = opts.perGroup ?? 3;
  return requirements.map((r, ri) => {
    const scored = evidence
      .map((e, ei) => ({ e, score: cosine(reqVectors[ri]!, evidenceVectors[ei]!) }))
      .sort((a, b) => b.score - a.score);
    const perGroupCount = new Map<string, number>();
    const candidates: Candidate[] = [];
    for (const { e, score } of scored) {
      const n = perGroupCount.get(e.group) ?? 0;
      if (n >= perGroup) continue;
      perGroupCount.set(e.group, n + 1);
      candidates.push({ id: e.id, score: Math.round(score * 1000) / 1000 });
      if (candidates.length >= k) break;
    }
    return { requirementId: r.id, candidates };
  });
}

export function retrievableEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  return evidence.filter((e) => e.kind !== "skills" && !e.id.startsWith("profile."));
}

export async function retrieveEvidence(env: Env, requirements: JobRequirement[], evidence: EvidenceItem[], opts?: { k?: number; perGroup?: number }): Promise<Retrieval[]> {
  const pool = retrievableEvidence(evidence);
  if (!pool.length || !requirements.length) return requirements.map((r) => ({ requirementId: r.id, candidates: [] }));
  const vectors = await embedCached(env, [...requirements.map(requirementEmbeddingText), ...pool.map(evidenceEmbeddingText)]);
  return rankCandidates(vectors.slice(0, requirements.length), pool, vectors.slice(requirements.length), requirements, opts);
}
