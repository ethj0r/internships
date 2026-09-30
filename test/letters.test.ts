import { describe, expect, it } from "vitest";
import { bodyParagraphs, countWords, lintFeedback, lintLetter, locationGuidance, normalizeHyphens, parseBanned, type LintContext } from "../worker/letters/lint";

const ctx: LintContext = {
  company: "Stripe",
  status: "ELIGIBLE_SINGAPORE",
  sgWorkAuthorization: "",
  candidateTerms: ["Concorde Systems", "Go", "sqlc", "offline-first sync", "Inkubator IT", "GitHub Actions", "domTraverse"],
  companyTerms: ["Stripe", "payments", "APIs", "idempotency", "Singapore"],
  rules: { minWords: 60, maxWords: 280, maxLintAttempts: 3, maxRecruiterRevisions: 1, banEmDash: true, banSemicolon: true, banColonInProse: true, banExclamation: true },
};

const good = `Dear Hiring Team,

Retries are where payment APIs get subtle, and Stripe's posting asks interns to own a project on exactly that kind of infrastructure. At Concorde Systems I wrote the Go backend for an offline-first maintenance app, so I have spent weeks thinking about duplicate writes.

The sync layer queues changes on the device and replays them when a technician gets signal back. Getting that right in Go with sqlc taught me to design endpoints so a repeated request is harmless, which is the idempotency problem Stripe APIs handle at a much larger scale.

I also run CI/CD with GitHub Actions at Inkubator IT, so shipping small changes behind review is normal for me. I can work on-site in Singapore for the internship.

I would like to spend the summer on a Stripe API team, learning how idempotency holds up at that volume.

Best,
Made`;

describe("letter lint", () => {
  it("passes a specific letter", () => {
    const r = lintLetter(good, ctx);
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("strips greeting and sign-off before counting", () => {
    const paragraphs = bodyParagraphs(good);
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[0]).toMatch(/^Retries/);
    expect(paragraphs.join(" ")).not.toMatch(/Made$/);
    expect(countWords("one two, three")).toBe(3);
  });

  it("rejects dashes, semicolons, colons and exclamation marks", () => {
    const rules = (text: string) => lintLetter(good.replace("so I have spent", text), ctx).violations.map((v) => v.rule);
    expect(rules("so — honestly — I have spent")).toContain("em_dash");
    expect(rules("so I have spent; indeed")).toContain("semicolon");
    expect(rules("so here is the thing: I have spent")).toContain("colon");
    expect(rules("so I have spent!")).toContain("exclamation");
  });

  it("allows colons in times and URLs", () => {
    const r = lintLetter(good.replace("for the internship.", "for the internship, from 09:00 at https://stripe.com."), ctx);
    expect(r.violations.map((v) => v.rule)).not.toContain("colon");
  });

  it("rejects banned phrases, including regex entries", () => {
    const r = lintLetter(good.replace("Retries are where", "I am passionate about how retries are where"), ctx);
    expect(r.violations.some((v) => v.rule === "banned_phrase")).toBe(true);
    const banned = parseBanned("# comment\nleverage\nre:\\bnot only\\b[^.]{1,80}\\bbut also\\b");
    expect(banned).toHaveLength(2);
    const s = lintLetter(good.replace("taught me to", "not only taught me but also helped me"), { ...ctx, banned });
    expect(s.violations.some((v) => v.rule === "banned_phrase")).toBe(true);
  });

  it("rejects forced triplets and generic openers", () => {
    expect(lintLetter(good.replace("so shipping small changes", "so fast, careful, and tested changes"), ctx).violations.map((v) => v.rule)).toContain("triplet");
    expect(lintLetter(good.replace("Retries are where", "I am writing to say retries are where"), ctx).violations.map((v) => v.rule)).toContain("generic_opener");
  });

  it("enforces the word limits", () => {
    const long = good.replace("Best,", `${"Extra words about Stripe and Go. ".repeat(40)}\n\nBest,`);
    expect(lintLetter(long, ctx).violations.map((v) => v.rule)).toContain("length");
  });

  it("never lets an unconfirmed work pass through, and allows a confirmed one", () => {
    const withPass = good.replace("I can work on-site in Singapore for the internship.", "I will need a Training Employment Pass to work in Singapore.");
    expect(lintLetter(withPass, ctx).violations.map((v) => v.rule)).toContain("authorization");
    expect(lintLetter(withPass, { ...ctx, sgWorkAuthorization: "TEP approved" }).violations.map((v) => v.rule)).not.toContain("authorization");
  });

  it("keeps location to one sentence", () => {
    const heavy = good.replace("I can work on-site in Singapore for the internship.", "I can work on-site in Singapore. I am based in Bandung, Indonesia today.");
    expect(lintLetter(heavy, ctx).violations.map((v) => v.rule)).toContain("location");
  });

  it("flags a paragraph with no concrete detail", () => {
    const vague = good.replace(
      "I also run CI/CD with GitHub Actions at Inkubator IT, so shipping small changes behind review is normal for me.",
      "I enjoy learning quickly and working well with others on hard problems.",
    );
    expect(lintLetter(vague, ctx).violations.map((v) => v.rule)).toContain("specificity");
  });

  it("gives location guidance that never mentions passes unless confirmed", () => {
    const sg = locationGuidance("ELIGIBLE_SINGAPORE", { location: "Bandung, Indonesia", sgWorkAuthorization: "", timezoneNote: null, asyncEvidence: false });
    expect(sg).toMatch(/Say nothing about passes/);
    const remote = locationGuidance("ELIGIBLE_REMOTE", { location: "Bandung, Indonesia", sgWorkAuthorization: "", timezoneNote: "Their 09:00–17:00 is 00:00–08:00 WIB.", asyncEvidence: false });
    expect(remote).toMatch(/UTC\+7/);
  });
});

describe("self-assessment phrases from the evaluation", () => {
  it("rejects telling the reader what the experience proves", () => {
    const hits = (text: string) => lintLetter(good.replace("so shipping small changes behind review is normal for me.", text), ctx).violations.filter((v) => v.rule === "banned_phrase");
    expect(hits("showing I can deliver the kind of reliable services Stripe relies on.")).not.toHaveLength(0);
    expect(hits("These experiences prove I can learn new systems quickly.")).not.toHaveLength(0);
    expect(hits("mirroring the review loops at Stripe.")).not.toHaveLength(0);
    expect(hits("so shipping small changes behind review is normal for me.")).toHaveLength(0);
  });
});

describe("length feedback", () => {
  it("tells the writer how much to add and where", () => {
    const short = lintLetter(good, { ...ctx, rules: { ...ctx.rules!, minWords: 200, maxWords: 280 } });
    expect(short.ok).toBe(false);
    const feedback = lintFeedback(short, { ...ctx.rules!, minWords: 200, maxWords: 280 });
    expect(feedback).toMatch(/add about \d+ words/);
    expect(feedback).toMatch(/one more sentence/);
  });
});

describe("tells found in the 2026-09-30 evaluation", () => {
  const hits = (text: string) =>
    lintLetter(normalizeHyphens(good.replace("so shipping small changes behind review is normal for me.", text)), ctx).violations.filter((v) => v.rule === "banned_phrase");

  it("catches banned words written with Unicode hyphens", () => {
    expect(normalizeHyphens("production‑grade")).toBe("production-grade");
    expect(hits("matching the need for production‑grade APIs.")).not.toHaveLength(0);
  });

  it("catches self-assessment clauses and borrowed expectations", () => {
    expect(hits("so I evaluated K3s alone, demonstrating rapid learning of unfamiliar systems.")).not.toHaveLength(0);
    expect(hits("matching Stripe’s demand for reliable APIs.")).not.toHaveLength(0);
    expect(hits("mirroring Stripe’s expectations for code review.")).not.toHaveLength(0);
  });
});
