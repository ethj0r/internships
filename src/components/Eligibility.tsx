import { useState } from "react";
import { canGenerate, ELIGIBILITY_LABELS, type EligibilityStatus } from "../../shared/eligibility";
import { SEASON_LABEL, TIER_LABELS, type Tier } from "../../shared/priority";
import type { JobDetail, JobSummary, RefreshCycle } from "../../shared/types";
import { api } from "../lib/api";
import { formatDate, plural, relativeTime } from "../lib/format";
import { invalidate, useAction, useResource } from "../lib/hooks";
import { Icon, Spinner } from "./Icon";
import { MenuButton } from "./Menu";
import { useToast } from "./Toast";

const TONE: Record<EligibilityStatus, string> = {
  ELIGIBLE_REMOTE: "elig-remote",
  ELIGIBLE_INDONESIA: "elig-indonesia",
  ELIGIBLE_SINGAPORE: "elig-singapore",
  CHECK_MANUALLY: "elig-check",
  EXCLUDED: "elig-excluded",
  UNCLASSIFIED: "elig-unknown",
};

export const SHORT_LABELS: Record<EligibilityStatus, string> = {
  ELIGIBLE_REMOTE: "Remote",
  ELIGIBLE_INDONESIA: "Indonesia",
  ELIGIBLE_SINGAPORE: "Singapore",
  CHECK_MANUALLY: "Check",
  EXCLUDED: "Excluded",
  UNCLASSIFIED: "Unclassified",
};

export function EligibilityBadge({ status, short }: { status: EligibilityStatus; short?: boolean }) {
  return <span className={`tag elig ${TONE[status]}`}>{short ? SHORT_LABELS[status] : ELIGIBILITY_LABELS[status]}</span>;
}

/** Company tier and season chips for rows and headers. Only shown when they add information. */
export function PriorityChips({ job }: { job: Pick<JobSummary, "priorityTier" | "season"> }) {
  const tier = job.priorityTier as Tier;
  return (
    <>
      {tier <= 3 && <span className={`tag tier tier-${tier}`}>{TIER_LABELS[tier]}</span>}
      {job.season && <span className={`tag ${job.season === "summer_2027" ? "tag-match" : ""}`}>{SEASON_LABEL(job.season)}</span>}
    </>
  );
}

export function jobCanGenerate(job: Pick<JobSummary, "eligibilityStatus" | "eligibility">): boolean {
  return canGenerate(job.eligibility ? { status: job.eligibilityStatus, approvedAt: job.eligibility.approvedAt ?? null } : null);
}

const OVERRIDES: Exclude<EligibilityStatus, "UNCLASSIFIED">[] = ["ELIGIBLE_REMOTE", "ELIGIBLE_INDONESIA", "ELIGIBLE_SINGAPORE", "CHECK_MANUALLY", "EXCLUDED"];

/** Job page: why the posting has its status, what to verify, and the candidate's approve/override controls. */
export function EligibilitySection({ job, onChanged }: { job: JobDetail; onChanged: () => void }) {
  const toast = useToast();
  const e = job.eligibility;
  const status = job.eligibilityStatus;
  const [act, busy] = useAction(async (body: Parameters<typeof api.jobEligibility>[1], message: string) => {
    await api.jobEligibility(job.id, body);
    invalidate("jobs", "shortlist");
    onChanged();
    toast.show(message);
  }, toast.error);

  const approved = status === "CHECK_MANUALLY" && Boolean(e?.approvedAt);
  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">Can You Take It?</h2>
        <MenuButton
          className="btn btn-plain btn-sm"
          label="Change eligibility"
          align="end"
          items={[
            { key: "reclassify", label: "Check Again", onSelect: () => void act({ action: "reclassify" }, "Checked again") },
            ...OVERRIDES.map((s, i) => ({
              key: s,
              label: `Mark as ${ELIGIBILITY_LABELS[s]}`,
              checked: status === s,
              separatorBefore: i === 0,
              onSelect: () => void act({ action: "override", status: s }, `Marked as ${ELIGIBILITY_LABELS[s]}`),
            })),
          ]}
        >
          {busy ? <Spinner /> : "Change"}
        </MenuButton>
      </div>
      <div className="group">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="row-main">
            <p className="row-title hstack" style={{ gap: 8 }}>
              <EligibilityBadge status={status} />
              {approved && <span className="tag tag-match">Approved for tailoring</span>}
            </p>
            <p className="row-subtitle" style={{ marginTop: 6 }}>
              {e?.reason ?? "Not classified yet. It will be checked on the next run, or use Change → Check Again."}
            </p>
            {e?.doubtQuote && (
              <blockquote className="elig-quote">
                <span className="muted">The sentence that raised the doubt:</span> “{e.doubtQuote}”
              </blockquote>
            )}
          </div>
          {status === "CHECK_MANUALLY" && !approved && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void act({ action: "approve" }, "Approved. You can tailor documents now.")}>
              Approve
            </button>
          )}
        </div>
        {e?.workAuthorizationNote && (
          <div className="row" style={{ alignItems: "flex-start" }}>
            <Icon name="warning" style={{ color: "var(--color-orange)", marginTop: 2, flex: "none" }} />
            <div className="row-main">
              <p className="row-title">Work authorization to verify</p>
              <p className="row-subtitle">{e.workAuthorizationNote}</p>
            </div>
          </div>
        )}
        {e?.timezoneNote && (
          <div className="row" style={{ alignItems: "flex-start" }}>
            <Icon name="clock" style={{ marginTop: 2, flex: "none" }} />
            <div className="row-main">
              <p className="row-title">Time-zone overlap</p>
              <p className="row-subtitle">{e.timezoneNote}</p>
            </div>
          </div>
        )}
        {e && e.facts.quotes.length > 0 && (
          <details className="row elig-details">
            <summary className="row-subtitle">What the posting says ({plural(e.facts.quotes.length, "quote")})</summary>
            <ul>
              {e.facts.quotes.map((q, i) => (
                <li key={i}>“{q.text}”</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {e && (
        <p className="section-footer">
          {e.classifier === "model" ? "Facts extracted by the model, checked against the posting's own words; the status comes from fixed rules." : "Decided by fixed rules from the posting."}{" "}
          Checked {relativeTime(e.classifiedAt).toLowerCase()}.
        </p>
      )}
    </section>
  );
}

/** Discover: big tech career pages that aren't crawled, to check by hand. */
export function WatchlistCard() {
  const { data } = useResource("watchlist", api.watchlist);
  const [open, setOpen] = useState(false);
  if (!data?.length) return null;
  return (
    <div className="notice watchlist" style={{ margin: "4px 12px 8px" }}>
      <Icon name="antenna" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <button type="button" className="btn-link" style={{ fontWeight: 600 }} onClick={() => setOpen(!open)} aria-expanded={open}>
          Big tech career pages ({data.length})
        </button>
        <span className="muted" style={{ display: "block" }}>
          Not crawled. Check them by hand and add a posting with <Icon name="plus" width={12} height={12} /> (paste its details).
        </span>
        {open && (
          <ul className="watchlist-links">
            {data.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.company}
                </a>{" "}
                <span className="muted">{s.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function cycleLine(c: RefreshCycle): string {
  if (!c.finishedAt) return `In progress: ${c.sourcesChecked} of ${c.sourcesTotal} sources checked since ${formatDate(c.startedAt)}.`;
  const s = c.summary;
  if (!s) return `Finished ${relativeTime(c.finishedAt).toLowerCase()}.`;
  const eligible = (s.byStatus.ELIGIBLE_REMOTE ?? 0) + (s.byStatus.ELIGIBLE_INDONESIA ?? 0) + (s.byStatus.ELIGIBLE_SINGAPORE ?? 0);
  return `${plural(s.newPostings, "new posting")}, ${s.changedPostings} changed, ${s.closedPostings} closed. ${eligible} eligible, ${s.byStatus.CHECK_MANUALLY ?? 0} to check, ${s.byStatus.EXCLUDED ?? 0} excluded.`;
}

/** Sources: the 3-day refresh schedule, the last cycle's summary and a "Refresh now" button. */
export function RefreshCard() {
  const toast = useToast();
  const { data, reload } = useResource("cycles", api.refreshCycles);
  const [refresh, refreshing] = useAction(async () => {
    const r = await api.refreshNow();
    invalidate("jobs", "shortlist", "sources", "runs", "overview");
    await reload();
    toast.show(r.cycle ? `Refresh started: ${r.cycle.sourcesChecked} of ${r.cycle.sourcesTotal} sources checked. The rest follow hourly.` : "Refresh started");
  }, toast.error);
  const last = data?.[0];
  return (
    <div className="group" style={{ marginBottom: 20 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="row-main">
          <p className="row-title">Every 3 days</p>
          <p className="row-subtitle">
            All sources are checked once per cycle, a few each hour. New and changed postings go through the eligibility check first; only eligible ones can be tailored.
          </p>
          {last && (
            <p className="row-subtitle" style={{ marginTop: 6 }}>
              <strong>Last cycle:</strong> {cycleLine(last)}
            </p>
          )}
          {last?.summary?.topNew.length ? (
            <ul className="watchlist-links">
              {last.summary.topNew.map((j) => (
                <li key={j.id}>
                  <a href={`/jobs/${j.id}`}>
                    {j.company}: {j.title}
                  </a>{" "}
                  <EligibilityBadge status={j.status} short />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? <Spinner /> : <Icon name="refresh" />}
          Refresh Now
        </button>
      </div>
    </div>
  );
}
