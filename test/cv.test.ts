import { describe, expect, it } from "vitest";
import {
  applyTailoring,
  cvToLatex,
  cvToPlainText,
  describeTailoring,
  documentText,
  escapeLatex,
  headerText,
  isLatexCv,
  omittedEntries,
  parseLatexCv,
  parseRich,
  plain,
} from "../shared/cv";

// Synthetic résumé using the template's macros (no real personal data).
const TEX = String.raw`\documentclass[letterpaper,11pt]{article}
\begin{document}

%----------HEADING----------
\begin{center}
  {\Huge \scshape \textbf{Alex Student}} \\ \vspace{4pt}
  \small
  (+1) 555-010-2000 $|$
  \href{mailto:alex@example.com}{alex@example.com} $|$
  \href{https://github.com/alex}{GitHub}
\end{center}

\section{Education}
\resumeSubHeadingListStart
  \resumeSubheading
    {Example University}{Aug 2024 -- present}
    {B.S. in Computer Science, GPA: 3.9 / 4.0}{Springfield}
    \resumeItemListStart
      \resumeItem{\textbf{Relevant Coursework:} Operating Systems, Databases}
    \resumeItemListEnd
\resumeSubHeadingListEnd

\section{Technical Skills}
\begin{itemize}[leftmargin=0.15in, label={}]
\small{\item{
\textbf{Languages}: Python, Go, C++, SQL \\
\textbf{Frameworks \& Libraries}: React, FastAPI \\
}}
\end{itemize}

\section{Certifications \& Awards}
\begin{itemize}[leftmargin=0.15in, label={}, itemsep=1.7pt]
\small
  \resumeProjectHeading
    {\textbf{2\textsuperscript{nd} Place Hackathon} $|$ \href{https://example.com/a?x=1\%20b}{Find out more}}{April 2026}
\end{itemize}
\vspace{-1pt}

\section{Experiences}
\resumeSubHeadingListStartSpaced
  \resumeSubheadingSpaced
    {Acme Corp}{Remote}
    {Software Engineer Intern}{May 2025 -- Aug 2025}
    \resumeItemListStart
      \resumeItem{Built a \textbf{Go} REST API serving 1,000 users; cut latency by 30\%.}
      \resumeItem{Wrote CI pipelines with \textbf{GitHub Actions}.}
    \resumeItemListEnd
  \resumeSubheadingSpaced
    {Beta Labs}{Springfield}
    {Data Intern}{Jan 2025 -- Apr 2025}
    \resumeItemListStart
      \resumeItem{Analyzed data with \textbf{Python} and SQL.}
    \resumeItemListEnd
\resumeSubHeadingListEnd

\vspace{8pt}

\section{Projects \hfill {\normalfont\small\textit{Selected work (\href{https://github.com/alex}{See all})}}}
\resumeSubHeadingListStartSpaced
  \resumeProjectHeadingSpaced
    {\textbf{Tracker} $|$ React, Go $|$ \href{https://github.com/alex/tracker}{GitHub}}{May 2026}
    \resumeItemListStart
      \resumeItem{Estimated CO\textsubscript{2}e --- all hand-implemented.}
    \resumeItemListEnd
  \resumeProjectHeadingSpaced
    {\textbf{Notes} $|$ Flutter}{Jan 2026}
    \resumeItemListStart
      \resumeItem{Mobile note-taking app.}
    \resumeItemListEnd
\resumeSubHeadingListEnd

\vspace{8pt}

\section{Research Papers}
\resumeSubHeadingListStartSpaced
  \resumeProjectHeadingWrap
    {\textbf{Graph Methods for Things} \newline Example University $|$ \href{https://example.com/p.pdf}{Paper}}{June 2025}
    \resumeItemListStart
      \resumeItem{Topics: Graphs, Algorithms.}
    \resumeItemListEnd
\resumeSubHeadingListEnd

\end{document}`;

describe("parseLatexCv", () => {
  const doc = parseLatexCv(TEX)!;

  it("reads the header", () => {
    expect(doc.header.name).toBe("Alex Student");
    expect(doc.header.contacts).toEqual([
      { text: "(+1) 555-010-2000", url: null },
      { text: "alex@example.com", url: "mailto:alex@example.com" },
      { text: "GitHub", url: "https://github.com/alex" },
    ]);
  });

  it("reads every section with its layout", () => {
    expect(doc.sections.map((s) => [s.key, s.type])).toEqual([
      ["education", "entries"],
      ["technical-skills", "skills"],
      ["certifications-and-awards", "items"],
      ["experiences", "entries"],
      ["projects", "items"],
      ["research-papers", "items"],
    ]);
  });

  it("keeps emphasis, links, dashes and escapes as rich text", () => {
    const exp = doc.sections[3]!;
    if (exp.type !== "entries") throw new Error("expected entries");
    expect(exp.spaced).toBe(true);
    expect(exp.entries[0]).toMatchObject({ title: "Acme Corp", titleRight: "Remote", subtitle: "Software Engineer Intern", subtitleRight: "May 2025 – Aug 2025" });
    expect(exp.entries[0]!.bullets[0]).toBe("Built a **Go** REST API serving 1,000 users; cut latency by 30%.");

    const awards = doc.sections[2]!;
    if (awards.type !== "items") throw new Error("expected items");
    expect(awards.variant).toBe("plain");
    expect(awards.items[0]!.heading).toBe("**2^{nd} Place Hackathon** | [Find out more](https://example.com/a?x=1%20b)");

    const projects = doc.sections[4]!;
    expect(projects.note).toBe("*Selected work ([See all](https://github.com/alex))*");

    const research = doc.sections[5]!;
    if (research.type !== "items") throw new Error("expected items");
    expect(research.variant).toBe("wrap");
    expect(research.items[0]!.heading).toBe("**Graph Methods for Things**\nExample University | [Paper](https://example.com/p.pdf)");
  });

  it("reads skill lines", () => {
    const skills = doc.sections[1]!;
    if (skills.type !== "skills") throw new Error("expected skills");
    expect(skills.lines).toEqual([
      { label: "Languages", items: ["Python", "Go", "C++", "SQL"] },
      { label: "Frameworks & Libraries", items: ["React", "FastAPI"] },
    ]);
  });

  it("round-trips through the template renderer", () => {
    const rendered = cvToLatex(doc);
    expect(rendered).toContain("\\newcommand{\\resumeItem}[1]");
    expect(rendered).toContain("\\href{https://example.com/a?x=1\\%20b}{Find out more}");
    expect(rendered).toContain("cut latency by 30\\%.");
    expect(rendered).toContain("\\resumeProjectHeadingWrap");
    expect(rendered).toContain("\\section{Projects \\hfill {\\normalfont\\small \\textit{Selected work (\\href{https://github.com/alex}{See all})}}}");
    expect(parseLatexCv(rendered)).toEqual(doc);
  });

  it("returns null for non-LaTeX text", () => {
    expect(isLatexCv("# Alex\n- Python")).toBe(false);
    expect(parseLatexCv("# Alex")).toBeNull();
  });
});

describe("rich text", () => {
  it("parses nested markup and escapes", () => {
    expect(plain("**Go** and *[docs](https://x.dev)* 2^{nd} CO_{2} A\\*")).toBe("Go and docs 2nd CO2 A*");
    expect(parseRich("**a *b* c**")).toEqual([{ t: "b", c: [{ t: "text", v: "a " }, { t: "i", c: [{ t: "text", v: "b" }] }, { t: "text", v: " c" }] }]);
  });

  it("escapes LaTeX specials and unsupported characters", () => {
    expect(escapeLatex("R&D 50% user_id #1 “quoted” – ok 🚀")).toBe("R\\&D 50\\% user\\_id \\#1 ``quoted'' -- ok ");
  });
});

describe("applyTailoring", () => {
  const master = parseLatexCv(TEX)!;
  const relevance = { required: ["Go", "SQL"], preferred: ["CI/CD"] };
  const tailored = applyTailoring(
    master,
    {
      entries: [
        { id: "experiences-1", bullets: ["Analyzed product data with **Python** and SQL."] },
        { id: "experiences-0", bullets: ["A", "B", "C"] },
        { id: "made-up-9", bullets: ["Invented"] },
      ],
      skills: [{ label: "languages", items: ["SQL", "Rust", "go"] }],
    },
    relevance,
  );
  const section = (key: string) => tailored.sections.find((s) => s.key === key);

  it("keeps the header, education, experience and awards, and ignores unknown entries", () => {
    expect(tailored.header).toEqual(master.header);
    expect(tailored.sections[0]).toEqual(master.sections[0]);
    expect(section("certifications-and-awards")).toEqual(master.sections[2]);
    expect(cvToPlainText(tailored)).not.toContain("Invented");
  });

  it("keeps experience in the master's order with the master's facts, capping rewritten bullets", () => {
    const exp = section("experiences");
    if (exp?.type !== "entries") throw new Error("expected entries");
    expect(exp.entries.map((e) => e.title)).toEqual(["Acme Corp", "Beta Labs"]);
    expect(exp.entries[0]).toMatchObject({ subtitleRight: "May 2025 – Aug 2025", bullets: ["A", "B"] });
    expect(exp.entries[1]!.bullets).toEqual(["Analyzed product data with **Python** and SQL."]);
  });

  it("keeps projects even when the model selects none, most relevant first", () => {
    const projects = section("projects");
    if (projects?.type !== "items") throw new Error("expected items");
    expect(projects.items.map((i) => i.id)).toEqual(["projects-0", "projects-1"]);
  });

  it("drops research papers unrelated to the job", () => {
    expect(section("research-papers")).toBeUndefined();
    expect(omittedEntries(master, tailored)).toEqual([{ section: "Research Papers", names: ["Graph Methods for Things"] }]);
  });

  it("reorders skills without removing any", () => {
    const skills = section("technical-skills");
    if (skills?.type !== "skills") throw new Error("expected skills");
    expect(skills.lines[0]!.items).toEqual(["SQL", "Go", "Python", "C++"]);
    expect(skills.lines[1]!.items).toEqual(["React", "FastAPI"]);
  });

  it("leads with relevant bullets when the model doesn't rewrite them", () => {
    const withoutRewrites = applyTailoring(master, { entries: [], skills: [] }, { required: ["CI/CD"], preferred: [] });
    const exp = withoutRewrites.sections.find((s) => s.key === "experiences");
    if (exp?.type !== "entries") throw new Error("expected entries");
    expect(exp.entries[0]!.bullets[0]).toContain("GitHub Actions");
    expect(describeTailoring(master, withoutRewrites).some((c) => c.change.startsWith("Put the most relevant bullets first for Acme Corp"))).toBe(true);
  });
});

describe("documentText", () => {
  it("flattens LaTeX for matching and checks", () => {
    const text = documentText(TEX);
    expect(text).toContain("Acme Corp | Remote");
    expect(text).toContain("- Built a Go REST API serving 1,000 users; cut latency by 30%.");
    expect(text).toContain("GitHub (https://github.com/alex)");
    expect(headerText(TEX)).toBe("Alex Student\n(+1) 555-010-2000 | alex@example.com | GitHub (https://github.com/alex)");
    expect(documentText("plain CV")).toBe("plain CV");
  });
});
