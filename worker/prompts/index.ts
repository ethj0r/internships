// Prompt templates live in this folder as Markdown files so they can be edited without touching code.
//
// A template has an optional "# system" section and a "# prompt" section. {{name}} placeholders are filled by
// render(); a placeholder without a value throws, so a renamed variable can't silently produce a broken prompt.
// Files are bundled at build time: `npm run dev` reloads on save, and a deploy picks up the edited files.

const files = import.meta.glob("./*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface Rendered {
  system: string;
  prompt: string;
}

function template(name: string): string {
  const text = files[`./${name}.md`];
  if (text === undefined) throw new Error(`Prompt template ${name}.md is missing.`);
  return text;
}

function fill(text: string, vars: Record<string, string | number>, name: string): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Prompt ${name}.md uses {{${key}}}, which wasn't provided.`);
    return String(vars[key]);
  });
}

/** Splits a template into its "# system" and "# prompt" sections. Lines starting with "<!--" are comments. */
function sections(text: string): { system: string; prompt: string } {
  const body = text.replace(/<!--[\s\S]*?-->\n?/g, "");
  const system = body.match(/^# system\s*\n([\s\S]*?)(?=^# prompt\s*$)/m)?.[1] ?? "";
  const prompt = body.match(/^# prompt\s*\n([\s\S]*)$/m)?.[1] ?? body;
  return { system: system.trim(), prompt: prompt.trim() };
}

export function render(name: string, vars: Record<string, string | number>): Rendered {
  const { system, prompt } = sections(template(name));
  return { system: fill(system, vars, name), prompt: fill(prompt, vars, name) };
}

/** A template with no sections, used as a shared block (e.g. writing principles). */
export function block(name: string, vars: Record<string, string | number> = {}): string {
  return fill(template(name).replace(/<!--[\s\S]*?-->\n?/g, "").trim(), vars, name);
}
