export function texFilename(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "resume"}.tex`;
}

export function downloadTex(tex: string, filename: string) {
  const url = URL.createObjectURL(new Blob([tex], { type: "application/x-tex" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the LaTeX source as a new Overleaf project, where it compiles to PDF. */
export function openInOverleaf(tex: string, filename: string) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://www.overleaf.com/docs";
  form.target = "_blank";
  const fields: Record<string, string> = { encoded_snip: encodeURIComponent(tex), snip_name: filename, engine: "pdflatex" };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
