import { describe, expect, it } from "vitest";
import { buildEligibility, canGenerate, decide, quoteAppears, ruleFacts, singaporeNote, timezoneNote, type PostingInput } from "../shared/eligibility";
import { companyTier, detectSeason, findCompany, priorityScore } from "../shared/priority";

function classify(p: Partial<PostingInput> & { location: string }) {
  const input: PostingInput = { title: "Software Engineer Intern", description: "", workplace: "unknown", ...p };
  const facts = ruleFacts(input);
  return { facts, ...decide(facts, { hasDescription: Boolean(input.description) }) };
}

describe("eligibility: remote", () => {
  it("accepts remote roles open worldwide or in Indonesia", () => {
    expect(classify({ location: "Remote, Worldwide", workplace: "remote" }).status).toBe("ELIGIBLE_REMOTE");
    expect(classify({ location: "Remote, Indonesia", workplace: "remote" }).status).toBe("ELIGIBLE_REMOTE");
    expect(classify({ location: "Remote - APAC", workplace: "remote" }).status).toBe("ELIGIBLE_REMOTE");
  });

  it("excludes remote roles restricted to other countries", () => {
    const r = classify({ location: "Remote - US: All locations", workplace: "remote" });
    expect(r.status).toBe("EXCLUDED");
    expect(r.reason).toMatch(/US/);
    expect(classify({ location: "Remote (Canada)", workplace: "remote" }).status).toBe("EXCLUDED");
  });

  it("excludes a remote role whose description restricts the country", () => {
    const r = classify({ location: "Remote", workplace: "remote", description: "About us. You must be located in the United States to be considered." });
    expect(r.status).toBe("EXCLUDED");
  });

  it("doesn't read the pronoun 'us' as the United States", () => {
    const r = classify({ location: "Remote", workplace: "remote", description: "Join us to build tools. Tell us about yourself." });
    expect(r.status).toBe("CHECK_MANUALLY");
  });

  it("asks to check a remote role that doesn't say where it hires, quoting the doubt", () => {
    const r = classify({ location: "Flexible / Remote", workplace: "remote", description: "Work with our remote team." });
    expect(r.status).toBe("CHECK_MANUALLY");
    expect(r.doubtQuote).toBe("Flexible / Remote");
    expect(r.needsModel).toBe(true);
  });

  it("accepts APAC-wide remote roles that also name an Asian office", () => {
    expect(classify({ location: "APAC - Remote; Hong Kong SAR", workplace: "remote" }).status).toBe("ELIGIBLE_REMOTE");
    expect(classify({ location: "Remote - APAC; London", workplace: "remote" }).status).toBe("CHECK_MANUALLY");
  });

  it("asks to check remote roles listed in another Asian country", () => {
    expect(classify({ location: "Remote, Minato City, Japan", workplace: "remote" }).status).toBe("CHECK_MANUALLY");
  });

  it("reads a time-zone overlap requirement", () => {
    const r = classify({ location: "Remote, Worldwide", workplace: "remote", description: "We are distributed. You need at least 4 hours overlap with PST working hours." });
    expect(r.facts.timezoneRequirement).toMatch(/4 hours overlap with PST/);
  });
});

describe("eligibility: on-site and hybrid", () => {
  it("accepts on-site roles in Indonesia", () => {
    expect(classify({ location: "Jakarta, Indonesia", workplace: "onsite" }).status).toBe("ELIGIBLE_INDONESIA");
    expect(classify({ location: "Bandung", workplace: "hybrid" }).status).toBe("ELIGIBLE_INDONESIA");
  });

  it("accepts Singapore, including multi-location postings", () => {
    expect(classify({ location: "Singapore", workplace: "onsite" }).status).toBe("ELIGIBLE_SINGAPORE");
    const r = classify({ location: "Singapore; London", workplace: "hybrid" });
    expect(r.status).toBe("ELIGIBLE_SINGAPORE");
    expect(r.reason).toMatch(/other locations/);
  });

  it("excludes Singapore roles for citizens only or without sponsorship", () => {
    expect(classify({ location: "Singapore", workplace: "onsite", description: "This role is open to Singapore Citizens or PRs only." }).status).toBe("EXCLUDED");
    expect(classify({ location: "Singapore", workplace: "onsite", description: "We are unable to sponsor work passes for this role." }).status).toBe("EXCLUDED");
  });

  it("ignores equal-opportunity boilerplate about citizenship", () => {
    const r = classify({ location: "Singapore", workplace: "onsite", description: "We hire without regard to race, citizenship or national origin." });
    expect(r.status).toBe("ELIGIBLE_SINGAPORE");
    expect(r.facts.citizenshipRequired).toBe(false);
  });

  it("excludes on-site roles elsewhere", () => {
    expect(classify({ location: "San Francisco, CA", workplace: "onsite" }).status).toBe("EXCLUDED");
    expect(classify({ location: "London", workplace: "hybrid" }).status).toBe("EXCLUDED");
    expect(classify({ location: "Doha, Qatar", workplace: "onsite" }).status).toBe("EXCLUDED");
  });

  it("detects the work mode from the location and description when the platform doesn't say", () => {
    expect(classify({ location: "Remote, Worldwide" }).facts.workMode).toBe("remote");
    expect(classify({ location: "Singapore", description: "This is a hybrid role, 3 days in the office." }).facts.workMode).toBe("hybrid");
  });
});

describe("eligibility notes", () => {
  const facts = ruleFacts({ title: "Intern", location: "Singapore", workplace: "onsite", description: "This is a 12 week internship." });

  it("explains the likely Singapore pass without claiming one", () => {
    const note = singaporeNote(facts, "");
    expect(note).toMatch(/Training Employment Pass/);
    expect(note).toMatch(/12 week/);
    expect(note).toMatch(/Unknown/);
  });

  it("flags internships longer than a TEP allows", () => {
    const long = ruleFacts({ title: "Intern", location: "Singapore", workplace: "onsite", description: "Duration: 6 months." });
    expect(singaporeNote(long, "")).toMatch(/longer than a TEP allows/);
  });

  it("uses the confirmed authorization from the profile when there is one", () => {
    expect(singaporeNote(facts, "Training Employment Pass approved for May–Aug 2027")).toMatch(/Your profile confirms/);
  });

  it("converts a time-zone overlap to WIB", () => {
    expect(timezoneNote("4 hours overlap with PST")).toMatch(/00:00–08:00 WIB/);
    expect(timezoneNote("overlap with SGT business hours")).toMatch(/Easy/);
    expect(timezoneNote(null)).toBeNull();
  });

  it("only lets eligible or approved postings through generation", () => {
    const e = buildEligibility(facts, decide(facts, { hasDescription: true }), { classifier: "rules", confirmedSingaporeAuthorization: "", now: "2026-09-28T00:00:00Z" });
    expect(e.status).toBe("ELIGIBLE_SINGAPORE");
    expect(e.workAuthorizationNote).toBeTruthy();
    expect(canGenerate(e)).toBe(true);
    expect(canGenerate({ status: "CHECK_MANUALLY", approvedAt: null })).toBe(false);
    expect(canGenerate({ status: "CHECK_MANUALLY", approvedAt: "2026-09-28" })).toBe(true);
    expect(canGenerate({ status: "EXCLUDED" })).toBe(false);
  });

  it("checks that model quotes really appear in the posting", () => {
    expect(quoteAppears("You must be located in the  US", "Great team. You must be located in the US.")).toBe(true);
    expect(quoteAppears("Open to candidates worldwide", "You must be located in the US.")).toBe(false);
  });
});

describe("priority", () => {
  it("finds configured companies by alias", () => {
    expect(findCompany("Amazon Web Services")?.name).toBe("Amazon");
    expect(findCompany("TikTok")?.name).toBe("ByteDance / TikTok");
    expect(findCompany("Shopee Singapore")?.name).toBe("Sea Group");
    expect(companyTier("GoTo Group")).toBe(2);
    expect(companyTier("Remote")).toBe(3);
    expect(companyTier("Remote Sensing Co")).toBe(4);
    expect(companyTier("Lumina")).toBe(4);
  });

  it("detects the internship season", () => {
    expect(detectSeason("Software Engineer Intern (Summer 2027)")).toBe("summer_2027");
    expect(detectSeason("Software Engineering Intern (2027 Start) - Winter")).toBe("2027");
    expect(detectSeason("Intern", "Internship dates: May 27 - August 13, 2027")).toBe("summer_2027");
    expect(detectSeason("SWE Intern, Summer '27")).toBe("summer_2027");
    expect(detectSeason("Intern")).toBeNull();
  });

  it("sinks postings for a season that's already over", () => {
    const stale = priorityScore({ tier: 4, season: "fall_2024", status: "ELIGIBLE_REMOTE", matchScore: 90, currentYear: 2026 });
    const live = priorityScore({ tier: 4, season: null, status: "ELIGIBLE_REMOTE", matchScore: 60, currentYear: 2026 });
    expect(stale).toBeLessThan(live);
  });

  it("ranks big tech Summer 2027 first", () => {
    const bigTech = priorityScore({ tier: 1, season: "summer_2027", status: "ELIGIBLE_SINGAPORE", matchScore: 60 });
    const local = priorityScore({ tier: 4, season: null, status: "ELIGIBLE_REMOTE", matchScore: 90 });
    const seaTech = priorityScore({ tier: 2, season: "summer_2027", status: "ELIGIBLE_INDONESIA", matchScore: 60 });
    expect(bigTech).toBeGreaterThan(seaTech);
    expect(seaTech).toBeGreaterThan(local);
  });
});
