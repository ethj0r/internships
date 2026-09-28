import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { applyTailoring, parseLatexCv } from "../shared/cv";
import { findGenericPhrases, type JobRequirement, type KnowledgeNote } from "../shared/personalization";
import type { Document, Profile } from "../shared/types";
import { buildKnowledge, groupEvidence, knowledgeForPrompt } from "../worker/personalization/knowledge";
import {
  applyBulletProposals,
  checkBullet,
  cvIssues,
  letterIssues,
  overlapWithCv,
  parseResearchFacts,
  validateMatches,
} from "../worker/personalization/validate";

// Synthetic résumé using the template's macros (no real personal data).
const TEX = String.raw`\documentclass[letterpaper,11pt]{article}
\begin{document}
\begin{center}
  {\Huge \scshape \textbf{Alex Student}} \\ \vspace{4pt}
  \small \href{mailto:alex@example.com}{alex@example.com}
\end{center}

\section{Technical Skills}
\begin{itemize}[leftmargin=0.15in, label={}]
\small{\item{
\textbf{Languages}: Python, Go, TypeScript \\
}}
\end{itemize}

\section{Experiences}
\resumeSubHeadingListStartSpaced
  \resumeSubheadingSpaced
    {Acme Corp}{Remote}
    {Software Engineer Intern}{May 2025 -- Aug 2025}
    \resumeItemListStart
      \resumeItem{Built a \textbf{Go} REST API serving 1,000 users.}
      \resumeItem{Wrote CI pipelines with \textbf{GitHub Actions}.}
      \resumeItem{Contributed to the design review of the billing service.}
    \resumeItemListEnd
\resumeSubHeadingListEnd

\section{Leadership \& Activities}
\resumeSubHeadingListStartSpaced
  \resumeSubheadingSpaced
    {Robotics Club}{Springfield}
    {Director of Technology}{Jan 2025 -- present}
    \resumeItemListStart
      \resumeItem{Ran weekly build sessions for 30 members using \textbf{Python}.}
    \resumeItemListEnd
  \resumeSubheadingSpaced
    {Chess Society}{Springfield}
    {Member}{Sep 2024 -- present}
    \resumeItemListStart
      \resumeItem{Wrote a Python tool that generates tournament brackets.}
    \resumeItemListEnd
\resumeSubHeadingListEnd
\end{document}`;

const master: Document = {
  id: 1,
  kind: "master_cv",
  title: "Master CV",
  jobId: null,
  parentId: null,
  status: "draft",
  isActive: true,
  createdAt: "",
  updatedAt: "",
  content: TEX,
  generatedContent: null,
  meta: {},
};

const profile: Profile = {
  fullName: "Alex Student",
  email: "",
  phone: "",
  location: "",
  links: [],
  headline: "",
  education: "",
  graduationDate: null,
  skills: ["Python"],
  targetRoles: [],
  preferredLocations: [],
  remotePreference: "any",
  searchScope: "anywhere",
  workAuthorization: "",
  keywordsInclude: [],
  keywordsExclude: [],
  notifyMinScore: 70,
  updatedAt: "",
};

const note = (n: Partial<KnowledgeNote> & Pick<KnowledgeNote, "id" | "body">): KnowledgeNote => ({
  entryKey: null,
  kind: "context",
  title: "",
  links: [],
  createdAt: "",
  updatedAt: "",
  ...n,
});

const notes = [
  note({ id: 7, entryKey: "experiences/acme-corp", title: "Caching", body: "Added a Redis cache in front of the API after profiling slow queries." }),
  note({ id: 8, kind: "motivation", body: "I care about payments because my family runs a small shop." }),
];

const k = buildKnowledge(master, notes, profile);

describe("buildKnowledge", () => {
  it("turns every CV entry into citable evidence with stable keys", () => {
    expect(k.entries.map((e) => [e.group, e.entryKey, e.label, e.date])).toEqual([
      ["skills", "skills", "Technical Skills", ""],
      ["exp1", "experiences/acme-corp", "Acme Corp, Software Engineer Intern", "May 2025 – Aug 2025"],
      ["lead1", "leadership-and-activities/robotics-club", "Robotics Club, Director of Technology", "Jan 2025 – present"],
      ["lead2", "leadership-and-activities/chess-society", "Chess Society, Member", "Sep 2024 – present"],
    ]);
    expect(k.byId.get("exp1.h")?.text).toBe("Acme Corp | Software Engineer Intern | Remote | May 2025 – Aug 2025");
    expect(k.byId.get("exp1.b1")).toMatchObject({ kind: "bullet", text: "Built a Go REST API serving 1,000 users." });
    expect(k.byId.get("exp1.b2")?.technologies).toContain("CI/CD");
    expect(k.byId.get("skills.1")?.text).toBe("Languages: Python, Go, TypeScript");
    expect(k.groupOfEntryId.get("experiences-0")).toBe("exp1");
  });

  it("attaches notes to their entry and keeps standalone notes and the profile separate", () => {
    expect(k.byId.get("note7")).toMatchObject({ group: "exp1", entryKey: "experiences/acme-corp", kind: "note", label: "Acme Corp, Software Engineer Intern" });
    expect(k.byId.get("note8")).toMatchObject({ group: "note8", entryKey: null, section: "Interests and Motivation" });
    expect(groupEvidence(k, "exp1").map((e) => e.id)).toEqual(["exp1.h", "exp1.b1", "exp1.b2", "exp1.b3", "note7"]);
    expect(k.byId.get("profile.skills")?.text).toBe("Python");
  });

  it("renders a citable view for prompts", () => {
    const text = knowledgeForPrompt(k);
    expect(text).toContain("[exp1] Experiences: Acme Corp, Software Engineer Intern");
    expect(text).toContain("  exp1.b2: Wrote CI pipelines with GitHub Actions.");
    expect(text).toContain("  note7 (candidate's note): Caching: Added a Redis cache");
  });

  it("uses lines as evidence for masters that aren't LaTeX", () => {
    const text = buildKnowledge({ ...master, content: "# Alex\n## Experience\n- Built things with **Python**" }, [], profile);
    expect(text.doc).toBeNull();
    expect(text.entries[0]!.evidence.map((e) => [e.id, e.section, e.text])).toEqual([
      ["cv.1", "Alex", "Alex"],
      ["cv.2", "Experience", "Experience"],
      ["cv.3", "Experience", "Built things with Python"],
    ]);
  });
});

const requirement = (id: string, text: string): JobRequirement => ({
  id,
  text,
  kind: "required",
  importance: 4,
  competencies: [],
  whyItMatters: "",
  convincingEvidence: "",
  employerTerms: [],
});

describe("validateMatches", () => {
  const requirements = [
    requirement("R1", "Experience building REST APIs"),
    requirement("R2", "Hands-on Kubernetes experience"),
    requirement("R3", "Collaborate with cross-functional teams"),
    requirement("R4", "Familiarity with GraphQL"),
  ];
  const matches = validateMatches(
    requirements,
    [
      { requirement_id: "R1", strength: "strong", evidence_ids: ["exp1.b1", "made.up"], rationale: "Built one.", cv_action: "" },
      { requirement_id: "R2", strength: "relevant", evidence_ids: ["exp1.b2"], rationale: "CI work.", cv_action: "" },
      { requirement_id: "R3", strength: "relevant", evidence_ids: [], rationale: "", cv_action: "" },
    ],
    k.byId,
  );

  it("keeps supported matches and drops evidence that doesn't exist", () => {
    expect(matches[0]).toMatchObject({ requirementId: "R1", strength: "strong", evidenceIds: ["exp1.b1"] });
    expect(matches[0]!.correction).toBeUndefined();
  });

  it("never counts related experience as having used a named technology", () => {
    expect(matches[1]).toMatchObject({ strength: "transferable", evidenceIds: ["exp1.b2"] });
    expect(matches[1]!.correction).toContain("Kubernetes");
  });

  it("turns uncited matches into gaps and marks unassessed requirements unknown", () => {
    expect(matches[2]).toMatchObject({ strength: "gap", evidenceIds: [] });
    expect(matches[2]!.correction).toContain("no evidence was cited");
    expect(matches[3]).toMatchObject({ requirementId: "R4", strength: "unknown" });
  });
});

describe("checkBullet", () => {
  const acme = groupEvidence(k, "exp1");
  const robotics = groupEvidence(k, "lead1");

  it("blocks technologies, figures and scope the evidence doesn't show", () => {
    expect(checkBullet("Built a Go REST API on Kubernetes serving 1,000 users.", acme, 40).blocking).toEqual([expect.stringContaining("Kubernetes")]);
    expect(checkBullet("Built a REST API serving 5,000 users.", acme, 40).blocking).toEqual([expect.stringContaining("5,000")]);
    expect(checkBullet("Led the design review of the billing service.", acme, 60).blocking).toEqual([expect.stringContaining("Led")]);
  });

  it("allows scope the role supports and warns about filler", () => {
    expect(checkBullet("Led weekly Python build sessions for 30 members.", robotics, 60).blocking).toEqual([]);
    expect(checkBullet("Ran fast-paced weekly build sessions for 30 members using Python.", robotics, 60).warnings).toEqual([expect.stringContaining("fast-paced")]);
  });
});

describe("applyBulletProposals", () => {
  const doc = parseLatexCv(TEX)!;
  const exp = doc.sections.find((s) => s.key === "experiences");
  if (exp?.type !== "entries") throw new Error("expected entries");
  const base = {
    masterBullets: exp.entries[0]!.bullets,
    group: "exp1",
    support: groupEvidence(k, "exp1"),
    requirementIds: new Set(["R1"]),
    section: "Experiences",
    label: "Acme Corp, Software Engineer Intern",
  };

  const { bullets, changes } = applyBulletProposals({
    ...base,
    proposals: [
      {
        text: "Built a **Go** REST API serving 1,000 users, adding a **Redis** cache after profiling slow queries.",
        from: [1],
        evidence_ids: ["exp1.b1", "note7"],
        requirement_ids: ["R1", "R9"],
        reason: "API work first.",
      },
      { text: "Automated deployments to **Kubernetes** with **GitHub Actions**.", from: [2], evidence_ids: ["exp1.b2"], requirement_ids: [], reason: "" },
      { text: "Scaled the billing service.", from: [], evidence_ids: ["lead1.b1"], requirement_ids: [], reason: "" },
    ],
    drops: [{ bullet: 3, reason: "Design reviews matter less for this role." }],
  });

  it("accepts rewrites grounded in the entry's own evidence, including its notes", () => {
    expect(bullets[0]).toBe("Built a **Go** REST API serving 1,000 users, adding a **Redis** cache after profiling slow queries.");
    expect(changes[0]).toMatchObject({ status: "rewritten", original: ["Built a Go REST API serving 1,000 users."], requirementIds: ["R1"], evidenceIds: ["exp1.b1", "note7"] });
  });

  it("rejects unsupported rewrites and keeps the original bullet", () => {
    expect(bullets[1]).toBe("Wrote CI pipelines with **GitHub Actions**.");
    expect(changes[1]).toMatchObject({ status: "reverted", tailored: "Wrote CI pipelines with GitHub Actions.", proposed: "Automated deployments to Kubernetes with GitHub Actions." });
    expect(changes[1]!.issues[0]).toContain("Kubernetes");
  });

  it("drops bullets built from another entry's evidence", () => {
    expect(changes[2]).toMatchObject({ status: "reverted", tailored: "" });
    expect(changes[2]!.issues.join(" ")).toContain("outside this entry");
    expect(bullets).toHaveLength(2);
  });

  it("leaves out master bullets only when dropped with a reason", () => {
    expect(changes[3]).toMatchObject({
      status: "removed",
      original: ["Contributed to the design review of the billing service."],
      reason: "Design reviews matter less for this role.",
      evidenceIds: ["exp1.b3"],
    });
  });

  it("keeps bullets the model copied or didn't mention, after the tailored ones", () => {
    const result = applyBulletProposals({ ...base, proposals: [{ text: base.masterBullets[1]!, from: [2], evidence_ids: [], requirement_ids: [], reason: "" }] });
    expect(result.bullets).toEqual([base.masterBullets[1], base.masterBullets[0], base.masterBullets[2]]);
    expect(result.changes.map((c) => [c.status, c.evidenceIds])).toEqual([
      ["kept", ["exp1.b2"]],
      ["kept", ["exp1.b1"]],
      ["kept", ["exp1.b3"]],
    ]);
  });
});

describe("applyTailoring with omitted entries", () => {
  const doc = parseLatexCv(TEX)!;
  const leadership = (omit?: string[]) => {
    const s = applyTailoring(doc, { entries: [{ id: "leadership-and-activities-0", bullets: [] }], skills: [], omit }, { required: ["Python"], preferred: [] }).sections.find(
      (x) => x.key === "leadership-and-activities",
    );
    return s?.type === "entries" ? s.entries.map((e) => e.title) : [];
  };

  it("keeps a low-relevance entry out even when it shares a keyword with the job", () => {
    expect(leadership()).toEqual(["Robotics Club", "Chess Society"]);
    expect(leadership(["leadership-and-activities-1"])).toEqual(["Robotics Club"]);
  });
});

describe("document checks", () => {
  it("flags unsupported technologies, repeated posting terms and duplicate bullets in a CV", () => {
    const text = "- Built REST APIs.\n- Built REST APIs.\n- Designed REST APIs with Kubernetes. REST APIs and more REST APIs.";
    const issues = cvIssues(text, { evidence: "Built REST APIs", masterText: "Built REST APIs", posting: "Kubernetes and REST APIs", employerTerms: ["REST APIs"] });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "blocking", message: expect.stringContaining("Kubernetes") }),
        expect.objectContaining({ severity: "warning", message: expect.stringContaining("appears 5 times (1 in your master CV)") }),
        expect.objectContaining({ severity: "warning", message: "The same bullet appears twice." }),
      ]),
    );
  });

  it("treats the master CV's own header, links and wording as supported", () => {
    const master = "Alex | (+62) 812-0000-0000 | GitHub (https://github.com/alex)\n- Git and GitHub workflows with Git branching, Git review and Git hooks";
    const issues = cvIssues(`${master}\n- Git-based code review`, { evidence: "", masterText: master, posting: "Git", employerTerms: ["git"] });
    expect(issues).toEqual([]);
  });

  it("blocks generic cover letters that don't name the company", () => {
    const letter = "Dear Hiring Team,\n\nI am passionate about building products and thrilled to apply. I am a team player. [Add a sentence on why payments matter to you]\n\nSincerely,\nAlex";
    const issues = letterIssues(letter, { company: "Xendit (Indonesia)", evidence: "Built a Go REST API", posting: "", cvText: "" });
    const blocking = issues.filter((i) => i.severity === "blocking").map((i) => i.message);
    expect(blocking).toEqual([expect.stringContaining("generic phrases"), "Doesn't mention Xendit by name."]);
    expect(issues.map((i) => i.message)).toEqual(expect.arrayContaining([expect.stringContaining("Fill in the placeholder"), expect.stringContaining("words")]));
  });

  it("measures how much of a letter repeats the CV", () => {
    expect(overlapWithCv("a b c d e f g h", "x a b c d e f g h y")).toBe(1);
    expect(overlapWithCv("a b c d e f g h", "one two three four five six")).toBe(0);
  });

  it("finds filler phrases as whole words", () => {
    expect(findGenericPhrases("We leverage a fast-paced, cutting-edge stack.")).toEqual(["fast-paced", "leverage", "cutting-edge"]);
    expect(findGenericPhrases("We leveraged caching.")).toEqual([]);
  });
});

describe("parseResearchFacts", () => {
  const cite = (url: string, title: string | null) => ({ type: "web_search_result_location", url, title, cited_text: "", encrypted_index: "" });
  const content = [
    { type: "server_tool_use", id: "t1", name: "web_search", input: { query: "Xendit" } },
    { type: "text", text: "Here is what I found:\n\n", citations: null },
    { type: "text", text: "Xendit provides payment infrastructure for businesses in Southeast Asia.", citations: [cite("https://www.xendit.co/en/about", "About Xendit")] },
    { type: "text", text: "\n- ", citations: null },
    { type: "text", text: "It processes payments in Indonesia and the Philippines.", citations: [cite("https://docs.xendit.co", null)] },
    { type: "text", text: "\nThey probably run Kubernetes internally.", citations: null },
  ] as unknown as Anthropic.Beta.BetaContentBlock[];

  it("keeps only cited statements, with their sources", () => {
    expect(parseResearchFacts(content)).toEqual([
      { id: "F1", text: "Xendit provides payment infrastructure for businesses in Southeast Asia.", sources: [{ url: "https://www.xendit.co/en/about", title: "About Xendit" }] },
      { id: "F2", text: "It processes payments in Indonesia and the Philippines.", sources: [{ url: "https://docs.xendit.co", title: "https://docs.xendit.co" }] },
    ]);
  });
});
