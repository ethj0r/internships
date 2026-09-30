import { describe, expect, it } from "vitest";
import { ruleFacts } from "../shared/eligibility";
import { cycleDue } from "../worker/discovery/refresh";
import { mergeModelFacts } from "../worker/eligibility/classify";

describe("refresh cycles", () => {
  const start = "2026-09-01T03:00:00.000Z";

  it("starts the first cycle right away", () => {
    expect(cycleDue(null, new Date("2026-09-01T00:00:00Z"), 72)).toBe(true);
  });

  it("waits 72 hours from the start of the last cycle, across month boundaries", () => {
    const last = { startedAt: "2026-08-30T03:00:00.000Z", finishedAt: "2026-08-30T09:00:00.000Z" };
    expect(cycleDue(last, new Date("2026-09-02T02:59:00Z"), 72)).toBe(false);
    expect(cycleDue(last, new Date("2026-09-02T03:00:00Z"), 72)).toBe(true);
  });

  it("never starts a new cycle while one is still running", () => {
    expect(cycleDue({ startedAt: start, finishedAt: null }, new Date("2026-09-10T00:00:00Z"), 72)).toBe(false);
  });
});

describe("model facts for eligibility", () => {
  const description = "Join our remote team. This role is 100% remote. You must be based in the United States to be considered.";
  const rules = ruleFacts({ title: "Intern", location: "Remote", description, workplace: "remote" });
  const base = {
    work_mode: "remote" as const,
    locations: [],
    countries: ["Worldwide"],
    remote_restriction: [] as string[],
    timezone_requirement: "",
    authorization_requirement: "",
    citizenship_required: false,
    sponsorship: "unknown" as const,
    duration: "",
    quotes: [] as { field: string; text: string }[],
    doubt: "",
  };

  it("ignores a model fact that has no quote in the posting", () => {
    const { facts } = mergeModelFacts(rules, { ...base, remote_restriction: ["Worldwide"] }, { header: "Intern\nRemote", text: description });
    expect(facts.remoteRestriction).toEqual(rules.remoteRestriction);
  });

  it("uses a model fact backed by a verbatim quote, and drops invented quotes", () => {
    const { facts } = mergeModelFacts(
      rules,
      {
        ...base,
        remote_restriction: ["United States"],
        quotes: [
          { field: "remote_restriction", text: "You must be based in the United States to be considered." },
          { field: "countries", text: "Open to candidates worldwide." },
        ],
      },
      { header: "Intern\nRemote", text: description },
    );
    expect(facts.remoteRestriction).toEqual(["United States"]);
    expect(facts.quotes.map((q) => q.text)).not.toContain("Open to candidates worldwide.");
  });
});
