import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ROLE_LABELS } from "../../shared/roles";
import { PRIORITIES, type DocumentKind, type JobDetail, type Priority } from "../../shared/types";
import { api } from "../lib/api";
import { deadlineLabel, formatDate, KIND_LABELS, relativeTime, SOURCE_LABELS, WORKPLACE_LABELS } from "../lib/format";
import { invalidate, useAction, useResource } from "../lib/hooks";
import { ErrorState, Loading, Markdown, MatchRing } from "./common";
import { Icon, Spinner } from "./Icon";
import { MenuButton } from "./Menu";
import { Sheet } from "./Sheet";
import { invalidateTracking, StatusMenu } from "./StatusMenu";
import { useToast } from "./Toast";

type Generating = DocumentKind | "analysis" | null;

const PRIORITY_LABELS: Record<Priority, string> = { low: "Low Priority", medium: "Normal Priority", high: "High Priority" };

export function JobDetailView({
  jobId,
  onBack,
  backLabel = "Back",
  backAlways = false,
  onDismissed,
}: {
  jobId: number;
  onBack?: () => void;
  backLabel?: string;
  backAlways?: boolean;
  onDismissed?: () => void;
}) {
  const { data: job, error, loading, reload, mutate } = useResource(`job:${jobId}`, () => api.job(jobId));
  const { data: overview } = useResource("overview", api.overview);
  const toast = useToast();
  const navigate = useNavigate();
  const [generating, setGenerating] = useState<Generating>(null);
  const [sheet, setSheet] = useState<"deadline" | "untrack" | "answers" | null>(null);

  const [track, tracking] = useAction(async () => {
    const app = await api.track(jobId);
    invalidateTracking(jobId);
    await reload();
    toast.show(`Tracking ${app.job.company}`);
  }, toast.error);

  const [setDismissed] = useAction(async (dismissed: boolean) => {
    await api.updateJob(jobId, { dismissed });
    invalidate("jobs", "overview", `job:${jobId}`);
    if (dismissed) {
      toast.show("Hidden from Discover", { label: "Undo", onClick: () => void setDismissed(false) });
      onDismissed?.();
    }
  }, toast.error);

  const [setPriority] = useAction(async (priority: Priority) => {
    if (!job?.application) return;
    await api.updateApplication(job.application.id, { priority });
    invalidateTracking(jobId);
  }, toast.error);

  const [untrack, untracking] = useAction(async () => {
    if (!job?.application) return;
    await api.untrack(job.application.id);
    invalidateTracking(jobId);
    setSheet(null);
    toast.show("Stopped tracking");
  }, toast.error);

  async function generate(kind: Exclude<Generating, null>, questions?: string[]) {
    if (!job) return;
    setGenerating(kind);
    try {
      if (kind === "analysis") {
        const analysis = await api.analyzeJob(jobId);
        mutate({ ...job, aiAnalysis: analysis, aiAnalyzedAt: new Date().toISOString() });
        invalidate("events");
      } else {
        const doc = kind === "tailored_cv" ? await api.tailorCv(jobId) : kind === "cover_letter" ? await api.coverLetter(jobId) : await api.answers(jobId, questions);
        invalidateTracking(jobId);
        invalidate("documents");
        navigate(`/documents/${doc.id}`);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setGenerating(null);
    }
  }

  if (!job) return loading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => void reload()} /> : null;

  const app = job.application;
  const canGenerate = overview?.hasMasterCv !== false;
  const workplace = WORKPLACE_LABELS[job.workplace];

  return (
    <>
      <div className="bar">
        {onBack && (
          <button type="button" className={`btn btn-plain${backAlways ? "" : " show-mobile"}`} onClick={onBack}>
            <Icon name="chevron-left" />
            {backLabel}
          </button>
        )}
        <span className="spacer" />
        {!app && (
          <button type="button" className="btn btn-plain btn-icon" title={job.dismissedAt ? "Show in Discover" : "Not Interested"} aria-label={job.dismissedAt ? "Show in Discover" : "Not interested"} onClick={() => void setDismissed(!job.dismissedAt)}>
            <Icon name="eye-slash" />
          </button>
        )}
        <a className="btn btn-plain btn-icon" href={job.url} target="_blank" rel="noopener noreferrer" title="Open Original Posting" aria-label="Open original posting">
          <Icon name="external" />
        </a>
        <MenuButton
          className="btn btn-plain btn-icon"
          label="More"
          align="end"
          items={[
            { key: "deadline", label: job.deadline ? "Change Deadline…" : "Add Deadline…", onSelect: () => setSheet("deadline") },
            {
              key: "copy",
              label: "Copy Link to Posting",
              onSelect: () => void navigator.clipboard.writeText(job.url).then(() => toast.show("Link copied")),
            },
            ...(app
              ? [{ key: "untrack", label: "Stop Tracking…", destructive: true, separatorBefore: true, onSelect: () => setSheet("untrack") }]
              : [{ key: "dismiss", label: job.dismissedAt ? "Show in Discover" : "Not Interested", separatorBefore: true, onSelect: () => void setDismissed(!job.dismissedAt) }]),
          ]}
        >
          <Icon name="ellipsis" />
        </MenuButton>
      </div>

      <div className="detail-scroll">
        <article className="detail-inner">
          <header className="detail-header">
            <div style={{ minWidth: 0 }}>
              <p className="detail-company">{job.company}</p>
              <h1 className="detail-title">{job.title}</h1>
              <p className="muted" style={{ marginTop: 6 }}>
                {[job.location, workplace && !job.location.toLowerCase().includes(workplace.toLowerCase()) ? workplace : ""].filter(Boolean).join(", ") || "Location not listed"}
              </p>
            </div>
            <MatchRing score={job.matchScore} size="lg" />
          </header>

          <div className="detail-actions">
            {app ? (
              <>
                <StatusMenu application={app} company={job.company} onChanged={() => void reload()} />
                <MenuButton
                  label="Priority"
                  items={PRIORITIES.map((p) => ({ key: p, label: PRIORITY_LABELS[p], checked: app.priority === p, onSelect: () => void setPriority(p) }))}
                >
                  {app.priority === "high" && <span className="priority-mark">!!</span>}
                  {PRIORITY_LABELS[app.priority]}
                  <Icon name="chevron-updown" width={13} height={13} />
                </MenuButton>
                <Link className="btn btn-primary" to={`/applications/${app.id}/apply`}>
                  <Icon name="checklist" />
                  Prepare to Apply
                </Link>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-primary" onClick={() => void track()} disabled={tracking}>
                  {tracking ? <Spinner /> : <Icon name="bookmark" />}
                  Track
                </button>
                <a className="btn" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                  View Posting
                </a>
              </>
            )}
          </div>

          {job.closedAt && (
            <div className="notice" style={{ marginTop: 20 }}>
              <Icon name="warning" />
              <span>This posting is no longer listed on {job.sourceName ?? SOURCE_LABELS[job.sourceKind]}. It may have closed.</span>
            </div>
          )}
          {job.duplicates.length > 0 && (
            <div className="notice" style={{ marginTop: 20 }}>
              <Icon name="link" />
              <span>
                Also listed{" "}
                {job.duplicates.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 && ", "}
                    <Link to={`/jobs/${d.id}`}>on {SOURCE_LABELS[d.sourceKind]}</Link>
                  </span>
                ))}
                . Tracking one of them is enough.
              </span>
            </div>
          )}

          <dl className="facts">
            <Fact label="Deadline">
              {job.deadline ? (
                <button type="button" className="btn-link" onClick={() => setSheet("deadline")}>
                  {deadlineLabel(job.deadline)}
                </button>
              ) : (
                <button type="button" className="btn-link muted" onClick={() => setSheet("deadline")}>
                  Not listed. Add one
                </button>
              )}
            </Fact>
            {job.duration && <Fact label="Duration">{job.duration}</Fact>}
            {workplace && <Fact label="Workplace">{workplace}</Fact>}
            <Fact label="Posted">{job.postedAt ? formatDate(job.postedAt) : `Found ${relativeTime(job.firstSeenAt).toLowerCase()}`}</Fact>
            <Fact label="Source">
              <a href={job.url} target="_blank" rel="noopener noreferrer">
                {job.sourceName ?? SOURCE_LABELS[job.sourceKind]}
              </a>
            </Fact>
            {job.department && <Fact label="Team">{job.department}</Fact>}
          </dl>

          <MatchSection job={job} />

          <section className="section">
            <div className="section-header">
              <h2 className="section-title">Fit Analysis</h2>
              {job.aiAnalysis && (
                <button type="button" className="btn btn-plain btn-sm" disabled={generating !== null} onClick={() => void generate("analysis")}>
                  Analyze Again
                </button>
              )}
            </div>
            {generating === "analysis" ? (
              <Progress label="Comparing the posting with your CV. This usually takes under a minute." />
            ) : job.aiAnalysis ? (
              <AnalysisView job={job} />
            ) : (
              <div className="group row">
                <div className="row-main">
                  <p className="row-title">Get a written assessment</p>
                  <p className="row-subtitle">Strengths, gaps and what to emphasize, based on your CV.</p>
                </div>
                {canGenerate ? (
                  <button type="button" className="btn" disabled={generating !== null} onClick={() => void generate("analysis")}>
                    Analyze Fit
                  </button>
                ) : (
                  <Link className="btn" to="/documents">
                    Add Your CV
                  </Link>
                )}
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-header">
              <h2 className="section-title">Application Materials</h2>
            </div>
            {generating && generating !== "analysis" && (
              <div style={{ marginBottom: 12 }}>
                <Progress label={`Writing your ${KIND_LABELS[generating].toLowerCase()} from your master CV. This can take a minute.`} />
              </div>
            )}
            <div className="group">
              {job.documents.map((doc) => (
                <Link key={doc.id} to={`/documents/${doc.id}`} className="row inset-icon">
                  <span className="row-icon">
                    <Icon name="doc" />
                  </span>
                  <span className="row-main">
                    <span className="row-title truncate" style={{ display: "block" }}>
                      {doc.title}
                    </span>
                    <span className="row-subtitle">
                      {KIND_LABELS[doc.kind]}, {doc.status === "approved" ? "approved" : "draft"}
                    </span>
                  </span>
                  <span className="row-trailing">
                    {relativeTime(doc.updatedAt)}
                    <Icon name="chevron-right" className="row-chevron" />
                  </span>
                </Link>
              ))}
              {!canGenerate ? (
                <div className="row">
                  <span className="row-main row-subtitle">Add your master CV to generate a tailored CV, cover letter and answers.</span>
                  <Link className="btn btn-sm" to="/documents">
                    Add CV
                  </Link>
                </div>
              ) : (
                <div className="row wrap" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-sm" disabled={generating !== null} onClick={() => void generate("tailored_cv")}>
                    <Icon name="compose" />
                    Tailor CV
                  </button>
                  <button type="button" className="btn btn-sm" disabled={generating !== null} onClick={() => void generate("cover_letter")}>
                    Write Cover Letter
                  </button>
                  <button type="button" className="btn btn-sm" disabled={generating !== null} onClick={() => setSheet("answers")}>
                    Draft Answers
                  </button>
                </div>
              )}
            </div>
            <p className="section-footer">Drafts only use facts from your master CV and profile. Review and approve them before applying.</p>
          </section>

          {app && <NotesSection applicationId={app.id} jobId={job.id} />}

          <section className="section">
            <div className="section-header">
              <h2 className="section-title">Description</h2>
            </div>
            {job.description ? <Markdown source={job.description} /> : <p className="muted">No description was provided. Open the original posting for details.</p>}
          </section>

          <HistorySection jobId={job.id} />
        </article>
      </div>

      <DeadlineSheet
        open={sheet === "deadline"}
        job={job}
        onClose={() => setSheet(null)}
        onSaved={(updated) => {
          mutate({ ...job, deadline: updated.deadline });
          invalidate("jobs", "overview");
          setSheet(null);
        }}
      />
      <Sheet
        open={sheet === "untrack"}
        onClose={() => setSheet(null)}
        title="Stop tracking this application?"
        message="Its status, priority and notes will be removed. Generated documents are kept."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" style={{ background: "var(--color-red)" }} disabled={untracking} onClick={() => void untrack()}>
              Stop Tracking
            </button>
          </>
        }
      />
      <AnswersSheet
        open={sheet === "answers"}
        company={job.company}
        onClose={() => setSheet(null)}
        onSubmit={(questions) => {
          setSheet(null);
          void generate("answers", questions);
        }}
      />
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="fact-label">{label}</dt>
      <dd className="fact-value" style={{ margin: 0 }}>
        {children}
      </dd>
    </div>
  );
}

function Progress({ label }: { label: string }) {
  return (
    <div className="group group-padded" role="status">
      <div className="progress" />
      <p className="subhead muted" style={{ marginTop: 10 }}>
        {label}
      </p>
    </div>
  );
}

function MatchSection({ job }: { job: JobDetail }) {
  const m = job.matchDetail;
  if (!m) return null;
  const parts: [string, number][] = [
    ["Skills", m.breakdown.skills],
    ["Role", m.breakdown.role],
    ["Location", m.breakdown.location],
    ["Eligibility", m.breakdown.eligibility],
  ];
  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">Match</h2>
        {m.roles.length > 0 && <span className="subhead muted">{m.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}</span>}
      </div>
      <div className="group group-padded" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="breakdown">
          {parts.map(([label, value]) => (
            <div key={label}>
              <div className="hstack" style={{ justifyContent: "space-between" }}>
                <span className="subhead muted">{label}</span>
                <span className="subhead num">{value}</span>
              </div>
              <div className="meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${value}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="columns-2">
          <div>
            <h3 className="headline" style={{ marginBottom: 10 }}>
              Skills you have
            </h3>
            {m.matchedSkills.length ? (
              <div className="tags">
                {m.matchedSkills.map((s) => (
                  <span key={s} className="tag tag-match">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="subhead muted">None of the skills this posting names are in your profile or CV yet.</p>
            )}
          </div>
          <div>
            <h3 className="headline" style={{ marginBottom: 10 }}>
              Not in your profile
            </h3>
            {m.missingRequired.length || m.missingPreferred.length ? (
              <div className="tags">
                {m.missingRequired.map((s) => (
                  <span key={s} className="tag tag-missing">
                    {s}
                  </span>
                ))}
                {m.missingPreferred.map((s) => (
                  <span key={s} className="tag tag-missing" title="Nice to have">
                    {s} <span className="caption">(nice to have)</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="subhead muted">Nothing missing from the skills this posting names.</p>
            )}
          </div>
        </div>

        {(m.highlights.length > 0 || m.concerns.length > 0) && (
          <div className="columns-2">
            {m.highlights.length > 0 && (
              <ul className="bullets good">
                {m.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            )}
            {m.concerns.length > 0 && (
              <ul className="bullets warn">
                {m.concerns.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function AnalysisView({ job }: { job: JobDetail }) {
  const a = job.aiAnalysis!;
  const list = (title: string, items: string[], tone?: "good" | "warn") =>
    items.length > 0 && (
      <div>
        <h3 className="headline" style={{ marginBottom: 8 }}>
          {title}
        </h3>
        <ul className={`bullets${tone ? ` ${tone}` : ""}`}>
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="group group-padded" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p>{a.summary}</p>
      <div className="columns-2">
        {list("Strengths", a.strengths, "good")}
        {list("Gaps", a.gaps, "warn")}
      </div>
      {list("Concerns", a.concerns, "warn")}
      <div className="columns-2">
        {list("What the role needs most", a.keyQualifications)}
        {list("What to emphasize", a.talkingPoints)}
      </div>
      <p className="caption muted">
        {a.generator}, {relativeTime(job.aiAnalyzedAt)}. Check it against the posting.
      </p>
    </div>
  );
}

function NotesSection({ applicationId, jobId }: { applicationId: number; jobId: number }) {
  const { data: apps } = useResource("applications", () => api.applications());
  const app = apps?.find((a) => a.id === applicationId);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const toast = useToast();

  useEffect(() => {
    if (app) setNotes(app.notes);
  }, [app?.id, app?.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!app || notes === app.notes) return;
    setSaved("saving");
    try {
      await api.updateApplication(applicationId, { notes });
      invalidate("applications", `kit:`);
      setSaved("saved");
    } catch (err) {
      setSaved("idle");
      toast.error(err);
    }
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">Notes</h2>
        <span className="caption muted" aria-live="polite">
          {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : ""}
        </span>
      </div>
      <label className="sr-only" htmlFor={`notes-${jobId}`}>
        Notes
      </label>
      <textarea
        id={`notes-${jobId}`}
        className="textarea"
        rows={4}
        placeholder="Referrals, contacts, interview dates, anything worth remembering"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved("idle");
        }}
        onBlur={() => void save()}
      />
    </section>
  );
}

function HistorySection({ jobId }: { jobId: number }) {
  const { data: events } = useResource(`events:job:${jobId}`, () => api.jobEvents(jobId));
  if (!events?.length) return null;
  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">History</h2>
      </div>
      <ol className="timeline">
        {events.slice(0, 12).map((e) => (
          <li key={e.id}>
            <span className="timeline-dot" data-status={typeof e.detail.to === "string" ? e.detail.to : undefined} />
            <span>{describeJobEvent(e.entityType, e.action, e.detail)}</span>
            <span className="caption muted">{relativeTime(e.createdAt)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function describeJobEvent(entityType: string, action: string, detail: Record<string, unknown>): string {
  const kind = typeof detail.kind === "string" ? (KIND_LABELS as Record<string, string>)[detail.kind] ?? "document" : "document";
  switch (`${entityType}.${action}`) {
    case "job.discovered":
      return `Discovered with a ${detail.score}% match`;
    case "job.imported":
      return "Added by you";
    case "job.analyzed":
      return "Fit analyzed";
    case "job.dismissed":
      return "Hidden from Discover";
    case "job.restored":
      return "Shown in Discover again";
    case "job.deadline_changed":
      return detail.to ? `Deadline set to ${formatDate(String(detail.to))}` : "Deadline removed";
    case "job.untracked":
      return "Stopped tracking";
    case "application.created":
      return "Started tracking";
    case "application.status_changed":
      return `Moved to ${typeof detail.label === "string" ? detail.label : String(detail.to)}`;
    case "application.priority_changed":
      return `Priority set to ${detail.to}`;
    case "application.cv_selected":
      return "CV chosen for this application";
    case "application.cover_letter_selected":
      return "Cover letter chosen for this application";
    case "document.generated":
      return `${kind} drafted`;
    case "document.approved":
      return `${kind} approved`;
    case "document.unapproved":
      return `${kind} moved back to draft`;
    case "document.edited":
      return `${kind} edited`;
    case "document.deleted":
      return `${kind} deleted`;
    default:
      return action.replace(/_/g, " ");
  }
}

function DeadlineSheet({ open, job, onClose, onSaved }: { open: boolean; job: JobDetail; onClose: () => void; onSaved: (job: JobDetail) => void }) {
  const [value, setValue] = useState(job.deadline ?? "");
  const toast = useToast();
  useEffect(() => {
    if (open) setValue(job.deadline ?? "");
  }, [open, job.deadline]);
  const [save, pending] = useAction(async (deadline: string | null) => onSaved(await api.updateJob(job.id, { deadline })), toast.error);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={job.deadline ? "Change deadline" : "Add a deadline"}
      message={`You'll get a reminder a week before ${job.company}'s deadline while this role is in your pipeline.`}
      actions={
        <>
          {job.deadline && (
            <button type="button" className="btn btn-plain btn-destructive" style={{ marginRight: "auto" }} disabled={pending} onClick={() => void save(null)}>
              Remove
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={pending || !value} onClick={() => void save(value)}>
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="deadline">
          Application deadline
        </label>
        <input id="deadline" className="input" type="date" value={value} onChange={(e) => setValue(e.target.value)} data-autofocus />
      </div>
    </Sheet>
  );
}

function AnswersSheet({ open, company, onClose, onSubmit }: { open: boolean; company: string; onClose: () => void; onSubmit: (questions?: string[]) => void }) {
  const [text, setText] = useState("");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Draft application answers"
      message={`Paste the questions from ${company}'s application form, one per line. Leave it empty to answer common questions.`}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const questions = text.split("\n").map((q) => q.trim()).filter(Boolean);
              onSubmit(questions.length ? questions.slice(0, 10) : undefined);
              setText("");
            }}
          >
            Draft Answers
          </button>
        </>
      }
    >
      <textarea
        className="textarea"
        rows={6}
        aria-label="Questions"
        placeholder={`Why are you interested in this role?\nWhy do you want to work at ${company}?\nTell us about a technical project you're proud of.`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        data-autofocus
      />
      <p className="field-hint">Each draft also includes a short introduction and explanations of your two most relevant projects.</p>
    </Sheet>
  );
}
