// Guards against fabrication in generated documents: anything a draft asserts that the
// candidate's own material doesn't support is surfaced as a warning for review.

import { extractSkills } from "../../shared/skills";

export interface VerifySources {
  /** The candidate's own material: master CV + profile. */
  evidence: string;
  /** Context that may legitimately be quoted (the job posting). */
  context?: string;
}

const NUMBER = /(?<![\w.])\d[\d,]*(?:\.\d+)?\s?(?:%|\+|x\b|k\b|m\b)?/gi;

export function verifyGenerated(generated: string, sources: VerifySources): string[] {
  const warnings: string[] = [];
  const evidenceSkills = new Set(extractSkills(sources.evidence, { includeImplied: true }));
  const contextSkills = new Set(sources.context ? extractSkills(sources.context) : []);

  for (const skill of extractSkills(generated)) {
    if (evidenceSkills.has(skill)) continue;
    warnings.push(
      contextSkills.has(skill)
        ? `Mentions ${skill}, which is from the job posting but not your CV. Make sure it isn't presented as your experience.`
        : `Mentions ${skill}, which isn't in your master CV or profile.`,
    );
  }

  for (const raw of unsupportedFigures(generated, `${sources.evidence}\n${sources.context ?? ""}`)) {
    warnings.push(`The figure “${raw}” doesn't appear in your master CV.`);
  }

  return warnings.slice(0, 15);
}

/** Figures (counts, percentages, multipliers) in generated text that the allowed text doesn't contain. */
export function unsupportedFigures(generated: string, allowedText: string): string[] {
  const allowed = allowedText.replace(/,/g, "");
  const seen = new Set<string>();
  const unsupported: string[] = [];
  for (const match of generated.matchAll(NUMBER)) {
    const raw = match[0].trim();
    const digits = raw.replace(/,/g, "").replace(/\s/g, "");
    const core = digits.replace(/[%+xkm]$/i, "");
    if (seen.has(digits) || (core.length < 2 && !/%/.test(digits))) continue;
    seen.add(digits);
    if (!allowed.includes(core)) unsupported.push(raw);
  }
  return unsupported;
}

/** A tailored CV must keep the contact details from the master CV. */
export function missingContactDetails(generated: string, masterCv: string): string[] {
  const warnings: string[] = [];
  const haystack = generated.toLowerCase();
  for (const email of new Set(masterCv.match(/[\w.+-]+@[\w-]+\.[\w.-]*\w/g) ?? [])) {
    if (!haystack.includes(email.toLowerCase())) warnings.push(`Your email address (${email}) is missing.`);
  }
  for (const link of new Set(masterCv.match(/(?:https?:\/\/|www\.)[^\s)>\]]+|(?:github|linkedin|gitlab)\.com\/[^\s)>\]]+/gi) ?? [])) {
    const bare = link.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[/.,;]+$/, "").toLowerCase();
    if (!haystack.includes(bare)) warnings.push(`The link ${bare} from your master CV is missing.`);
  }
  const phone = (masterCv.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []).find((p) => p.replace(/\D/g, "").length >= 9);
  if (phone && !generated.replace(/\D/g, "").includes(phone.replace(/\D/g, ""))) warnings.push("Your phone number is missing.");
  return warnings;
}
