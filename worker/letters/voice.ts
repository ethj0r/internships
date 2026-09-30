// Voice samples: things the candidate wrote themselves (voice_samples/*.md or *.txt, git-ignored), used so cover
// letters match their natural phrasing and rhythm. Bundled at build time: `npm run dev` picks up edits, and
// `npm run deploy` from your machine ships them. README.md explains the folder and isn't a sample.

const files = import.meta.glob(["../../voice_samples/*.md", "../../voice_samples/*.txt", "!../../voice_samples/README.md"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const MAX_CHARS = 6_000;

export function voiceSamples(): string[] {
  return Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => text.replace(/<!--[\s\S]*?-->/g, "").trim())
    .filter((t) => t.length > 40);
}

/** The prompt block: samples to imitate in rhythm and word choice, never in content. */
export function voiceBlock(samples = voiceSamples()): string {
  if (!samples.length) {
    return "<voice>\nNo writing samples from the candidate yet. Write in a plain, direct student voice: short and medium sentences, everyday words, no corporate phrasing.\n</voice>";
  }
  let budget = MAX_CHARS;
  const kept: string[] = [];
  for (const s of samples) {
    if (budget <= 200) break;
    const part = s.slice(0, budget);
    kept.push(part);
    budget -= part.length;
  }
  return `<voice_samples>
Things the candidate wrote themselves. Match their rhythm, sentence length, level of formality and word choice. Don't copy their content, facts or distinctive phrases, and don't use anything here as evidence.
${kept.map((s, i) => `--- sample ${i + 1} ---\n${s}`).join("\n")}
</voice_samples>`;
}
