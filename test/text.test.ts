import { describe, expect, it } from "vitest";
import { detectWorkplace, htmlToMarkdown, jobFingerprint, parseDeadline, parseDuration, plainTextToMarkdown } from "../worker/lib/text";

describe("htmlToMarkdown", () => {
  it("converts Greenhouse's escaped HTML into Markdown", () => {
    const html = "&lt;h2&gt;What you&amp;#39;ll need&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Experience with &lt;strong&gt;Python&lt;/strong&gt;&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;";
    expect(htmlToMarkdown(html)).toBe("### What you'll need\n\n- Experience with Python\n- SQL");
  });

  it("keeps safe links and drops scripts", () => {
    const html = '<p>Read <a href="https://example.com/team">about the team</a></p><script>alert(1)</script>';
    expect(htmlToMarkdown(html)).toBe("Read [about the team](https://example.com/team)");
  });

  it("turns bold-only lines into headings", () => {
    expect(htmlToMarkdown("<p><strong>Preferred qualifications:</strong></p><p>Go</p>")).toBe("### Preferred qualifications\n\nGo");
  });
});

describe("plainTextToMarkdown", () => {
  it("keeps paragraphs and lists from pasted text", () => {
    expect(plainTextToMarkdown("About the role\nBuild APIs.\n\nRequirements:\n• Python\n• SQL")).toBe("About the role\n\nBuild APIs.\n\nRequirements:\n- Python\n- SQL");
  });
});

describe("parseDeadline", () => {
  const now = new Date("2026-09-14T00:00:00Z");
  it.each([
    ["Applications close on March 15, 2027.", "2027-03-15"],
    ["Deadline: 1 October 2026", "2026-10-01"],
    ["Please apply by 2026-11-30 at the latest", "2026-11-30"],
    ["Application deadline is 12/01/2026", "2026-12-01"],
  ])("finds %s", (text, expected) => {
    expect(parseDeadline(text, now)).toBe(expected);
  });

  it("ignores dates without a deadline cue", () => {
    expect(parseDeadline("The internship starts June 1, 2027.", now)).toBeNull();
  });
});

describe("parseDuration", () => {
  it("combines length and season", () => {
    expect(parseDuration("Software Engineering Intern (Summer 2027)", "This is a 12-week program.")).toBe("12 weeks, Summer 2027");
  });
  it("rejects implausible spans", () => {
    expect(parseDuration("Intern", "We have 2 weeks of onboarding")).toBe("");
  });
});

describe("detectWorkplace", () => {
  it("prefers explicit hints", () => {
    expect(detectWorkplace("New York", "Intern", "", "remote")).toBe("remote");
  });
  it("reads location and description", () => {
    expect(detectWorkplace("Remote - US", "Intern", "")).toBe("remote");
    expect(detectWorkplace("London", "Intern", "This is a hybrid role")).toBe("hybrid");
    expect(detectWorkplace("London", "Intern", "")).toBe("onsite");
    expect(detectWorkplace("", "Intern", "")).toBe("unknown");
  });
});

describe("jobFingerprint", () => {
  it("matches the same role listed with different formatting", async () => {
    const a = await jobFingerprint("Stripe, Inc.", "Software Engineering Intern", "San Francisco, CA");
    const b = await jobFingerprint("stripe", "Software Engineering Intern ", "San Francisco");
    expect(a).toBe(b);
  });
});
