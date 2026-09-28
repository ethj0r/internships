import { describe, expect, it } from "vitest";
import { isRelevantInternship } from "../shared/roles";
import { canonicalizeSkill, extractSkills } from "../shared/skills";
import type { Profile } from "../shared/types";
import { buildMatchContext, extractJobSkills, scoreJob } from "../worker/matching/score";
import { missingContactDetails, verifyGenerated } from "../worker/matching/verify";

const baseProfile: Profile = {
  fullName: "Test Student",
  email: "",
  phone: "",
  location: "",
  links: [],
  headline: "",
  education: "BSc Computer Science",
  graduationDate: "2027-06",
  skills: ["python", "TypeScript", "react.js", "SQL"],
  targetRoles: ["backend", "fullstack"],
  preferredLocations: ["London"],
  remotePreference: "any",
  searchScope: "anywhere",
  workAuthorization: "",
  keywordsInclude: [],
  keywordsExclude: [],
  notifyMinScore: 70,
  updatedAt: "",
};

describe("isRelevantInternship", () => {
  it.each([
    ["Software Engineering Intern, Summer 2027", true],
    ["Machine Learning Research Intern", true],
    ["Backend Engineer (Internship)", true],
    ["Data Science Co-op", true],
    ["Quality Assurance - Internship", true],
    ["Magang Backend Developer", true],
    ["Build Internship Plus, Software Engineer (Internship) - Mercari", true],
    ["Intern, Marketing and Partnership (GrabRentals)", false],
    ["Senior Software Engineer", false],
    ["Marketing Intern", false],
    ["Mechanical Engineering Intern", false],
    ["Internal Tools Engineer", false],
    ["International Sales Associate", false],
  ])("%s → %s", (title, expected) => {
    expect(isRelevantInternship(title)).toBe(expected);
  });
});

describe("skills", () => {
  it("distinguishes Java from JavaScript", () => {
    expect(extractSkills("We use JavaScript and TypeScript")).toEqual(expect.not.arrayContaining(["Java"]));
    expect(extractSkills("Experience with Java or Kotlin")).toEqual(expect.arrayContaining(["Java", "Kotlin"]));
  });
  it("only counts Go as a language mention", () => {
    expect(extractSkills("Languages: Python, Go, Rust")).toContain("Go");
    expect(extractSkills("Go beyond expectations")).not.toContain("Go");
  });
  it("canonicalizes user input", () => {
    expect(canonicalizeSkill("golang")).toBe("Go");
    expect(canonicalizeSkill("ReactJS")).toBe("React");
    expect(canonicalizeSkill("Figma")).toBe("Figma");
  });
});

const description = `### About the role
You'll build APIs for our payments platform.

### Minimum qualifications
- Experience with Python or Java
- Knowledge of SQL and REST APIs

### Preferred qualifications
- Kubernetes
- React`;

describe("extractJobSkills", () => {
  it("splits required and preferred by section", () => {
    const skills = extractJobSkills(description);
    expect(skills.required).toEqual(expect.arrayContaining(["Python", "Java", "SQL", "REST APIs"]));
    expect(skills.preferred).toEqual(expect.arrayContaining(["Kubernetes", "React"]));
    expect(skills.required).not.toContain("Kubernetes");
  });
});

describe("scoreJob", () => {
  const job = {
    title: "Backend Software Engineering Intern",
    description,
    location: "London, UK",
    workplace: "onsite" as const,
    skills: extractJobSkills(description),
  };

  it("rewards skill, role and location fit", () => {
    const result = scoreJob(job, buildMatchContext(baseProfile, null));
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.matchedSkills).toEqual(expect.arrayContaining(["Python", "SQL"]));
    expect(result.missingRequired).toEqual(expect.arrayContaining(["Java", "REST APIs"]));
    expect(result.highlights.join(" ")).toMatch(/Located in London/);
  });

  it("flags graduation-year mismatches", () => {
    const result = scoreJob({ ...job, description: `${description}\nOpen to students graduating in 2026.` }, buildMatchContext(baseProfile, null));
    expect(result.concerns.join(" ")).toMatch(/graduation in 2026/);
  });

  it("caps jobs that mention an excluded keyword", () => {
    const result = scoreJob(job, buildMatchContext({ ...baseProfile, keywordsExclude: ["payments"] }, null));
    expect(result.score).toBeLessThanOrEqual(15);
  });

  it("ranks by search area when it isn't Anywhere", () => {
    const ctx = buildMatchContext({ ...baseProfile, preferredLocations: [], searchScope: "indonesia_remote" }, null);
    const jakarta = scoreJob({ ...job, location: "Jakarta, Indonesia", workplace: "onsite" }, ctx);
    const remote = scoreJob({ ...job, location: "Remote - APAC", workplace: "remote" }, ctx);
    const singapore = scoreJob({ ...job, location: "Singapore", workplace: "onsite" }, ctx);
    const us = scoreJob({ ...job, location: "San Francisco, CA", workplace: "onsite" }, ctx);
    expect(jakarta.breakdown.location).toBe(100);
    expect(remote.breakdown.location).toBe(100);
    expect(singapore.score).toBeLessThan(jakarta.score);
    expect(us.score).toBeLessThan(singapore.score);
    expect(us.concerns.join(" ")).toMatch(/outside your search area/);
  });

  it("uses skills from the master CV", () => {
    const withoutCv = scoreJob(job, buildMatchContext({ ...baseProfile, skills: [] }, null));
    const withCv = scoreJob(job, buildMatchContext({ ...baseProfile, skills: [] }, "Built REST APIs in Java and Python with SQL"));
    expect(withCv.score).toBeGreaterThan(withoutCv.score);
  });
});

describe("verifyGenerated", () => {
  const cv = "# Test Student\n- Built a Python API serving 2,000 users\n- React dashboard";
  it("accepts content grounded in the CV", () => {
    expect(verifyGenerated("Built a Python API serving 2,000 users with a React dashboard.", { evidence: cv })).toEqual([]);
  });
  it("flags contact details dropped from a tailored CV", () => {
    const master = "# Test Student\ntest@example.com | +44 7700 900123 | github.com/test-student\n\n## Education\n- BSc, 2024 - 2027";
    expect(missingContactDetails("# Test Student\ntest@example.com\n+44 7700 900123\ngithub.com/test-student", master)).toEqual([]);
    const warnings = missingContactDetails("# Test Student\n## Education\n- BSc, 2024 - 2027", master);
    expect(warnings).toHaveLength(3);
  });

  it("flags skills and figures not in the CV", () => {
    const warnings = verifyGenerated("Built a Kubernetes platform that cut latency by 40%.", { evidence: cv, context: "We use Kubernetes" });
    expect(warnings.some((w) => w.includes("Kubernetes") && w.includes("job posting"))).toBe(true);
    expect(warnings.some((w) => w.includes("40%"))).toBe(true);
  });
});
