// Views for evidence-based personalization: the role analysis, requirement → evidence map, before/after
// bullet changes, cover letter reasoning, and the quality review that gates exports.

import { useState, type ReactNode } from "react";
import {
  CRITERION_LABELS,
  EVIDENCE_STRENGTHS,
  REQUIREMENT_KIND_LABELS,
  STRENGTH_HINTS,
  STRENGTH_LABELS,
  type BulletChange,
  type ClaimCheck,
  type CompanyFact,
  type EvidenceItem,
  type EvidenceStrength,
  type JobInsights,
  type JobRequirement,
  type LetterCritique,
  type LetterLintReport,
  type QualityReview,
  type RequirementMatch,
  type RoleAnalysis,
  type TailoringStrategy,
} from "../../shared/personalization";
import type { Document, DocumentMeta } from "../../shared/types";
import { hostname, relativeTime } from "../lib/format";
import { Segmented } from "./common";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

export function StrengthBadge({ strength }: { strength: EvidenceStrength }) {
  return (
    <span className="strength" data-strength={strength} title={STRENGTH_HINTS[strength]}>
      {STRENGTH_LABELS[strength]}
    </span>
  );
}

export function StrengthSummary({ matches }: { matches: RequirementMatch[] }) {
  const counts = EVIDENCE_STRENGTHS.map((s) => [s, matches.filter((m) => m.strength === s).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="tags" aria-label="Evidence by requirement">
      {counts.map(([s, n]) => (
        <span key={s} className="strength" data-strength={s} title={STRENGTH_HINTS[s]}>
          {n} {STRENGTH_LABELS[s]}
        </span>
      ))}
    </div>
  );
}

function EvidenceList({ ids, evidence }: { ids: string[]; evidence: EvidenceItem[] }) {
  const items = ids.map((id) => evidence.find((e) => e.id === id)).filter((e): e is EvidenceItem => Boolean(e));
  if (!items.length) return null;
  return (
    <ul className="evidence-list">
      {items.map((e) => (
        <li key={e.id}>
          <span className="evidence-source">{e.kind === "note" ? `Your note, ${e.label}` : e.label}</span>
          {e.text}
        </li>
      ))}
    </ul>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function StrategyCard({ strategy, concerns = [] }: { strategy: TailoringStrategy; concerns?: string[] }) {
  return (
    <div className="group group-padded">
      <dl className="kv">
        <Detail label="Target role">{strategy.targetRole}</Detail>
        <Detail label="Top hiring signals">
          <div className="tags">
            {strategy.topHiringSignals.map((s) => (
              <span key={s} className="tag">
                {s}
              </span>
            ))}
          </div>
        </Detail>
        <Detail label="Strongest evidence">{strategy.strongestEvidence.join("; ") || <span className="muted">Nothing stands out yet</span>}</Detail>
        {strategy.secondaryEvidence.length > 0 && <Detail label="Secondary evidence">{strategy.secondaryEvidence.join("; ")}</Detail>}
        <Detail label="Important gaps">
          {strategy.importantGaps.length ? (
            <ul className="bullets warn">
              {strategy.importantGaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          ) : (
            <span className="muted">None among the important requirements</span>
          )}
        </Detail>
        {strategy.deemphasize.length > 0 && <Detail label="De-emphasize">{strategy.deemphasize.join("; ")}</Detail>}
        <Detail label="CV strategy">{strategy.cvStrategy}</Detail>
        {strategy.coverLetterAngle && <Detail label="Cover letter angle">{strategy.coverLetterAngle}</Detail>}
        {concerns.length > 0 && (
          <Detail label="Risks">
            <ul className="bullets warn">
              {concerns.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Detail>
        )}
      </dl>
    </div>
  );
}

export function RequirementMap({ requirements, matches, evidence }: { requirements: JobRequirement[]; matches: RequirementMatch[]; evidence: EvidenceItem[] }) {
  const [onlyGaps, setOnlyGaps] = useState(false);
  const isGap = (r: JobRequirement) => ["gap", "weak", "unknown"].includes(matches.find((m) => m.requirementId === r.id)?.strength ?? "unknown");
  const shown = onlyGaps ? requirements.filter(isGap) : requirements;
  return (
    <>
      <div className="hstack wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <StrengthSummary matches={matches} />
        <Segmented
          label="Requirements shown"
          value={onlyGaps ? "gaps" : "all"}
          onChange={(v) => setOnlyGaps(v === "gaps")}
          options={[
            { value: "all", label: "All" },
            { value: "gaps", label: "Gaps and Weak Spots" },
          ]}
        />
      </div>
      <div className="group">
        {shown.map((r) => {
          const m = matches.find((x) => x.requirementId === r.id);
          return (
            <div key={r.id} className="row requirement">
              <div className="row-main">
                <div className="requirement-head">
                  <p className="row-title">{r.text}</p>
                  {m && <StrengthBadge strength={m.strength} />}
                </div>
                <p className="caption muted">
                  {REQUIREMENT_KIND_LABELS[r.kind]}, importance {r.importance} of 5{r.competencies.length ? `. Evaluates ${r.competencies.join(", ")}` : ""}
                </p>
                {m?.rationale && <p className="subhead">{m.rationale}</p>}
                {m?.correction && <p className="subhead correction">{m.correction}</p>}
                {m && <EvidenceList ids={m.evidenceIds} evidence={evidence} />}
                <details className="disclosure">
                  <summary>What the employer is looking for</summary>
                  <dl className="kv compact">
                    <Detail label="Why it matters">{r.whyItMatters}</Detail>
                    <Detail label="Convincing evidence">{r.convincingEvidence}</Detail>
                    {m?.cvAction && <Detail label="In your CV">{m.cvAction}</Detail>}
                    {r.employerTerms.length > 0 && <Detail label="Their terms">{r.employerTerms.join(", ")}</Detail>}
                  </dl>
                </details>
              </div>
            </div>
          );
        })}
        {!shown.length && <p className="row muted">No gaps or weak spots among the requirements.</p>}
      </div>
    </>
  );
}

export function CompanyFacts({ facts, research, generator }: { facts: CompanyFact[]; research: JobInsights["research"]; generator: string }) {
  if (!facts.length) {
    return (
      <div className="notice">
        <Icon name="search" />
        <span>
          {generator.startsWith("Workers AI")
            ? "Company research uses Claude's web search, so only the job posting was used. Add an ANTHROPIC_API_KEY to research the company."
            : "No facts about the company could be verified from public sources, so applications use only the job posting."}
        </span>
      </div>
    );
  }
  return (
    <>
      <div className="group">
        {facts.map((f) => (
          <div key={f.id} className="row" style={{ alignItems: "flex-start" }}>
            <div className="row-main">
              <p className="row-title">{f.text}</p>
              <p className="caption">
                {f.sources.map((s, i) => (
                  <span key={s.url}>
                    {i > 0 && ", "}
                    <a href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}>
                      {hostname(s.url)}
                    </a>
                  </span>
                ))}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="section-footer">{research === "web" ? "Only statements with a cited public source are kept. Check anything you plan to mention." : ""}</p>
    </>
  );
}

export function InsightsView({ insights, stale, onRefresh, disabled }: { insights: JobInsights; stale: boolean; onRefresh: () => void; disabled: boolean }) {
  const [view, setView] = useState<"strategy" | "requirements" | "company">("strategy");
  return (
    <div className="stack-v">
      {stale && (
        <div className="notice notice-warning">
          <Icon name="warning" />
          <span style={{ flex: 1 }}>Your CV, knowledge base, profile or this posting changed since this analysis. The next document you generate uses a fresh one.</span>
          <button type="button" className="btn btn-sm" onClick={onRefresh} disabled={disabled}>
            Update
          </button>
        </div>
      )}
      <div className="group group-padded stack-v">
        <p>{insights.roleSummary}</p>
        {insights.companyContext && <p className="subhead muted">{insights.companyContext}</p>}
        {insights.role && <RoleAnalysisView role={insights.role} />}
        <StrengthSummary matches={insights.matches} />
      </div>
      <Segmented
        label="Analysis"
        value={view}
        onChange={setView}
        options={[
          { value: "strategy", label: "Strategy" },
          { value: "requirements", label: `Requirements (${insights.requirements.length})` },
          { value: "company", label: `Company (${insights.companyFacts.length})` },
        ]}
      />
      {view === "strategy" && <StrategyCard strategy={insights.strategy} concerns={insights.concerns} />}
      {view === "requirements" && <RequirementMap requirements={insights.requirements} matches={insights.matches} evidence={insights.evidence} />}
      {view === "company" && <CompanyFacts facts={insights.companyFacts} research={insights.research} generator={insights.generator} />}
      <p className="caption muted">
        {insights.matching === "semantic" ? "Evidence matched by meaning (open embeddings), then judged. " : ""}
        {insights.generator}, {relativeTime(insights.createdAt).toLowerCase()}. Gaps are shown so you can decide how to address them. Your documents never claim them.
      </p>
    </div>
  );
}

// ---------- Tailored CV ----------

const CHANGE_LABELS: Record<BulletChange["status"], string> = {
  rewritten: "Rewritten",
  kept: "Unchanged",
  reverted: "Rewrite rejected",
  removed: "Left out",
};

function BulletChangeRow({ change: c, requirements, evidence }: { change: BulletChange; requirements: JobRequirement[]; evidence: EvidenceItem[] }) {
  const addresses = c.requirementIds.map((id) => requirements.find((r) => r.id === id)?.text).filter(Boolean);
  return (
    <div className="row change" style={{ alignItems: "flex-start" }}>
      <div className="row-main stack-v tight">
        <span className="change-status" data-status={c.status}>
          {CHANGE_LABELS[c.status]}
        </span>
        {c.status === "kept" ? (
          <p>{c.tailored}</p>
        ) : c.status === "removed" ? (
          <p className="before">{c.original.join(" ")}</p>
        ) : (
          <div className="before-after">
            <div>
              <p className="ba-label">Before</p>
              {c.original.length ? (
                c.original.map((o, i) => (
                  <p key={i} className="before">
                    {o}
                  </p>
                ))
              ) : (
                <p className="muted">No original bullet</p>
              )}
            </div>
            <div>
              <p className="ba-label">{c.status === "reverted" ? "Proposed, not used" : "After"}</p>
              <p className={c.status === "reverted" ? "before" : undefined}>{c.status === "reverted" ? c.proposed : c.tailored}</p>
            </div>
          </div>
        )}
        {c.reason && (
          <p className="subhead">
            <strong>Why: </strong>
            {c.reason}
          </p>
        )}
        {addresses.length > 0 && (
          <p className="subhead">
            <strong>Addresses: </strong>
            {addresses.join("; ")}
          </p>
        )}
        {c.issues.length > 0 && (
          <ul className="bullets warn">
            {c.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        {c.status === "reverted" && <p className="caption muted">{c.tailored ? "Your original bullet was kept instead." : "It was dropped."}</p>}
        {c.evidenceIds.length > 0 && (
          <details className="disclosure">
            <summary>Evidence</summary>
            <EvidenceList ids={c.evidenceIds} evidence={evidence} />
          </details>
        )}
      </div>
    </div>
  );
}

export function BulletChanges({ changes, requirements, evidence }: { changes: BulletChange[]; requirements: JobRequirement[]; evidence: EvidenceItem[] }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const groups: { key: string; section: string; label: string; items: BulletChange[] }[] = [];
  for (const c of changes) {
    const key = `${c.section}|${c.entryLabel}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.items.push(c);
    else groups.push({ key, section: c.section, label: c.entryLabel, items: [c] });
  }
  const count = (s: BulletChange["status"]) => changes.filter((c) => c.status === s).length;
  const unchanged = count("kept");
  return (
    <>
      <div className="hstack wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <p className="subhead muted">
          {count("rewritten")} rewritten, {unchanged} unchanged, {count("removed")} left out
          {count("reverted") ? `, ${count("reverted")} rejected for claiming more than your evidence shows` : ""}
        </p>
        {unchanged > 0 && (
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setShowUnchanged(!showUnchanged)}>
            {showUnchanged ? "Hide Unchanged" : "Show Unchanged"}
          </button>
        )}
      </div>
      {groups.map((g) => {
        const items = g.items.filter((c) => showUnchanged || c.status !== "kept");
        if (!items.length) return null;
        return (
          <div key={g.key} style={{ marginBottom: 20 }}>
            <p className="headline" style={{ margin: "0 4px 8px" }}>
              {g.label} <span className="caption muted">{g.section}</span>
            </p>
            <div className="group">
              {items.map((c, i) => (
                <BulletChangeRow key={i} change={c} requirements={requirements} evidence={evidence} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function RoleAnalysisView({ role }: { role: RoleAnalysis }) {
  return (
    <dl className="kv compact">
      {role.coreProblems.length > 0 && (
        <Detail label="Problems the team solves">
          <ul className="evidence-list">
            {role.coreProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Detail>
      )}
      {role.internScope && <Detail label="Intern scope">{role.internScope}</Detail>}
      {role.implicitSignals.length > 0 && (
        <Detail label="Unwritten signals">
          <ul className="evidence-list">
            {role.implicitSignals.map((s) => (
              <li key={s.signal}>
                {s.signal} <span className="caption muted">“{s.quote}”</span>
              </li>
            ))}
          </ul>
        </Detail>
      )}
      {role.companySignals.length > 0 && (
        <Detail label="What they tend to weigh">
          <span className="caption muted">From your company notes (config/companies.json). Used to pick evidence, never quoted.</span>
          <ul className="evidence-list">
            {role.companySignals.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Detail>
      )}
    </dl>
  );
}

const SUPPORT_LABELS: Record<ClaimCheck["claims"][number]["support"], string> = { supported: "Supported", partial: "Overstated", unsupported: "Unsupported" };

function ClaimVerification({ checks }: { checks: ClaimCheck[] }) {
  const flagged = checks.filter((c) => c.claims.some((x) => x.support !== "supported"));
  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">Claim Check</h2>
      </div>
      {flagged.length === 0 ? (
        <div className="notice">
          <Icon name="check" />
          <span>Every claim in the {checks.length} rewritten bullets is supported by your master CV and notes.</span>
        </div>
      ) : (
        <div className="group">
          {flagged.map((c, i) => (
            <div key={i} className="row" style={{ alignItems: "flex-start" }}>
              <div className="row-main">
                <p className="row-title">
                  {c.entryLabel} <span className="caption muted">{c.action === "reverted" ? "Reverted to your original bullet" : "Kept, check the wording"}</span>
                </p>
                <p className="row-subtitle">{c.bullet}</p>
                <ul className="evidence-list">
                  {c.claims
                    .filter((x) => x.support !== "supported")
                    .map((x, j) => (
                      <li key={j}>
                        <strong>{SUPPORT_LABELS[x.support]}:</strong> {x.claim}
                        {x.problem && <span className="muted"> ({x.problem})</span>}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="section-footer">Each rewritten bullet is checked claim by claim against its own entry's evidence. An unsupported claim puts your original bullet back.</p>
    </section>
  );
}

export function TailoringView({ meta }: { meta: DocumentMeta }) {
  const requirements = meta.requirements ?? [];
  const evidence = meta.evidence ?? [];
  return (
    <>
      {meta.verification && meta.verification.length > 0 && <ClaimVerification checks={meta.verification} />}
      {meta.strategy && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Tailoring Strategy</h2>
          </div>
          <StrategyCard strategy={meta.strategy} />
        </section>
      )}
      {meta.bulletChanges && meta.bulletChanges.length > 0 && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Before and After</h2>
          </div>
          <BulletChanges changes={meta.bulletChanges} requirements={requirements} evidence={evidence} />
        </section>
      )}
      {meta.omitted && meta.omitted.length > 0 && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Left Out</h2>
          </div>
          <div className="group">
            {meta.omitted.map((o) => (
              <div key={`${o.section}|${o.label}`} className="row">
                <div className="row-main">
                  <p className="row-title">
                    {o.label} <span className="caption muted">{o.section}</span>
                  </p>
                  <p className="row-subtitle">{o.reason}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="section-footer">Add any of them back in the Edit view.</p>
        </section>
      )}
      {meta.matches && requirements.length > 0 && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Requirements and Your Evidence</h2>
          </div>
          <RequirementMap requirements={requirements} matches={meta.matches} evidence={evidence} />
        </section>
      )}
    </>
  );
}

// ---------- Cover letter ----------

function LetterRules({ lint }: { lint: LetterLintReport }) {
  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">Writing Rules</h2>
      </div>
      {lint.ok ? (
        <div className="notice">
          <Icon name="check" />
          <span>
            Passes every rule: {lint.words} words, no dashes, semicolons or colons, no banned phrases, one concrete detail from you and from them in each paragraph.
            {lint.attempts > 1 ? ` Took ${lint.attempts} drafts.` : ""}
          </span>
        </div>
      ) : (
        <div className="notice notice-warning">
          <Icon name="warning" />
          <span>
            Still breaks {lint.violations.length} rule{lint.violations.length === 1 ? "" : "s"} after {lint.attempts} drafts. Fix these before sending:
            <ul>
              {lint.violations.map((v, i) => (
                <li key={i}>
                  {v.message}
                  {v.quote && <span className="muted"> “{v.quote}”</span>}
                </li>
              ))}
            </ul>
          </span>
        </div>
      )}
      <p className="section-footer">Rules and the banned-phrase list live in config/letter.json and config/banned_phrases.txt.</p>
    </section>
  );
}

function RecruiterCritique({ critique }: { critique: LetterCritique }) {
  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">Skeptical Recruiter</h2>
      </div>
      <div className="group group-padded stack-v">
        <p>
          <strong>{critique.verdict === "send" ? "Would forward it." : "Wanted changes."}</strong> {critique.summary}
        </p>
        {critique.flags.length > 0 && (
          <ul className="evidence-list">
            {critique.flags.map((f, i) => (
              <li key={i}>
                <span className="muted">“{f.quote}”</span> {f.problem} <em>{f.fix}</em>
              </li>
            ))}
          </ul>
        )}
        {critique.strongestLine && (
          <p className="subhead">
            <span className="muted">Strongest line:</span> “{critique.strongestLine}”
          </p>
        )}
        {critique.revised && critique.before && (
          <details>
            <summary className="subhead">The draft before this revision</summary>
            <div className="prose subhead" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
              {critique.before}
            </div>
          </details>
        )}
      </div>
      <p className="section-footer">{critique.revised ? "The letter you see was revised once from this critique." : "The letter wasn't revised: the revision broke more writing rules than the draft."}</p>
    </section>
  );
}

export function LetterReasoning({ meta }: { meta: DocumentMeta }) {
  const plan = meta.plan;
  if (!plan) return null;
  const requirements = meta.requirements ?? [];
  const evidence = meta.evidence ?? [];
  const facts = (meta.companyFacts ?? []).filter((f) => plan.companyFactIds.includes(f.id));
  const placeholder = /^placeholder$/i.test(plan.motivation.trim());
  return (
    <>
      {meta.lint && <LetterRules lint={meta.lint} />}
      {meta.critique && <RecruiterCritique critique={meta.critique} />}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">The Case This Letter Makes</h2>
        </div>
        <div className="group group-padded">
          <dl className="kv">
            <Detail label="What the team needs">{plan.companyNeed}</Detail>
            <Detail label="Why this role">{plan.whyRole}</Detail>
            <Detail label="Why this company">
              {plan.whyCompany}
              {plan.companyFactIds.includes("posting") && <span className="caption muted"> From the job posting.</span>}
              {facts.length > 0 && (
                <ul className="evidence-list">
                  {facts.map((f) => (
                    <li key={f.id}>
                      <span className="evidence-source">
                        {f.sources.map((s) => (
                          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
                            {hostname(s.url)}{" "}
                          </a>
                        ))}
                      </span>
                      {f.text}
                    </li>
                  ))}
                </ul>
              )}
            </Detail>
            <Detail label="Contribution">{plan.contribution}</Detail>
            <Detail label="Motivation">{placeholder ? <span className="muted">Not in your knowledge base, so the letter leaves a placeholder.</span> : plan.motivation}</Detail>
          </dl>
        </div>
        {placeholder && (
          <p className="section-footer">Add an Interests and Motivation note under Career Knowledge so future letters can say why this work matters to you, in your words.</p>
        )}
      </section>
      {plan.narrative.length > 0 && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Narrative</h2>
          </div>
          <ol className="narrative">
            {plan.narrative.map((step, i) => (
              <li key={i} className="group group-padded">
                <dl className="kv compact">
                  <Detail label="Their need">{step.need}</Detail>
                  <Detail label="Your experience">{step.experience}</Detail>
                  <Detail label="Why it matters here">{step.whyItMatters}</Detail>
                  {step.requirementIds.length > 0 && (
                    <Detail label="Requirements">{step.requirementIds.map((id) => requirements.find((r) => r.id === id)?.text ?? id).join("; ")}</Detail>
                  )}
                </dl>
                <EvidenceList ids={step.evidenceIds} evidence={evidence} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

// ---------- Quality review ----------

export function QualityReviewPanel({ review, running, onRun, id }: { review: QualityReview | undefined; running: boolean; onRun: () => void; id?: string }) {
  const [showScores, setShowScores] = useState(false);
  if (running) {
    return (
      <div id={id} className="group group-padded" role="status">
        <div className="progress" />
        <p className="subhead muted" style={{ marginTop: 10 }}>
          Reviewing it against the role, your evidence and what hiring managers look for. This usually takes under a minute.
        </p>
      </div>
    );
  }
  if (!review) {
    return (
      <div id={id} className="group row">
        <div className="row-main">
          <p className="row-title">Not reviewed yet</p>
          <p className="row-subtitle">Check relevance, evidence, authenticity and generic language before you use it.</p>
        </div>
        <button type="button" className="btn" onClick={onRun}>
          Run Review
        </button>
      </div>
    );
  }

  const state = review.stale ? "stale" : review.verdict;
  const issues = [...review.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1));
  return (
    <section id={id} className="group group-padded stack-v" aria-label="Quality review">
      <div className="hstack" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <p className="verdict" data-verdict={state}>
            <Icon name={state === "ready" ? "check" : "warning"} />
            {state === "ready" ? "Ready to send" : state === "stale" ? "Edited since the last review" : "Needs work"}
          </p>
          {review.summary && <p className="subhead muted" style={{ marginTop: 4 }}>{review.summary}</p>}
        </div>
        <button type="button" className="btn btn-sm" onClick={onRun}>
          Review Again
        </button>
      </div>
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((issue, i) => (
            <li key={i} data-severity={issue.severity}>
              <span className="issue-severity">{issue.severity === "blocking" ? "Fix" : "Consider"}</span>
              <span>
                {issue.message}
                {issue.quote && <span className="quote"> “{issue.quote}”</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {review.scores.length > 0 && (
        <div>
        <button type="button" className="btn-link" onClick={() => setShowScores(!showScores)} aria-expanded={showScores}>
          {showScores ? "Hide scores" : "Show scores"}
        </button>
        {showScores && (
          <div className="scores" style={{ marginTop: 12 }}>
            {review.scores.map((s) => (
              <div key={s.criterion}>
                <div className="hstack" style={{ justifyContent: "space-between" }}>
                  <span className="subhead">{CRITERION_LABELS[s.criterion]}</span>
                  <span className="subhead num">{s.score}/5</span>
                </div>
                <div className="meter" data-tone={s.score >= 4 ? "good" : s.score === 3 ? "mid" : "bad"} role="meter" aria-label={CRITERION_LABELS[s.criterion]} aria-valuenow={s.score} aria-valuemin={1} aria-valuemax={5}>
                  <span style={{ width: `${s.score * 20}%` }} />
                </div>
                {s.note && <p className="caption muted" style={{ marginTop: 4 }}>{s.note}</p>}
              </div>
            ))}
          </div>
        )}
        </div>
      )}
      <p className="caption muted">
        {review.attempts > 1 ? "The first draft didn't pass review, so it was regenerated with the feedback. " : ""}
        Reviewed by {review.generator}, {relativeTime(review.reviewedAt).toLowerCase()}.
      </p>
    </section>
  );
}

/** Why a tailored CV or cover letter shouldn't be exported yet, or null when it's ready. */
export function reviewBlocker(doc: Document, dirty = false): string | null {
  if (doc.kind !== "tailored_cv" && doc.kind !== "cover_letter") return null;
  if (dirty) return "You have unsaved edits that haven't been reviewed.";
  const review = doc.meta.review;
  if (!review) return "This hasn't had a quality review yet.";
  if (review.stale) return "You've edited it since its last quality review.";
  if (review.verdict === "needs_work") {
    const n = review.issues.filter((i) => i.severity === "blocking").length;
    return n ? `The last review found ${n === 1 ? "1 issue" : `${n} issues`} to fix before sending.` : "The last review found it isn't ready to send.";
  }
  return null;
}

/** Wraps export and approval actions so an unreviewed or failing document asks before going out. */
export function useExportGuard(doc: Document | undefined, { dirty = false, onReview }: { dirty?: boolean; onReview: () => void }) {
  const [pending, setPending] = useState<{ label: string; run: () => void } | null>(null);
  const blocker = doc ? reviewBlocker(doc, dirty) : null;
  const guard = (label: string, run: () => void) => () => (blocker ? setPending({ label, run }) : run());
  const needsRun = dirty || !doc?.meta.review || doc.meta.review.stale;
  const sheet = (
    <Sheet
      open={pending !== null}
      onClose={() => setPending(null)}
      title="Check it before it goes out"
      message={blocker}
      actions={
        <>
          <button
            type="button"
            className="btn btn-plain"
            onClick={() => {
              const action = pending;
              setPending(null);
              action?.run();
            }}
          >
            {pending?.label} Anyway
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setPending(null);
              onReview();
            }}
          >
            {needsRun ? "Run Review" : "Show Issues"}
          </button>
        </>
      }
    />
  );
  return { guard, sheet, blocker };
}
