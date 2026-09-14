import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { isLatexCv, parseLatexCv } from "../../shared/cv";
import type { ApplyKit, Document } from "../../shared/types";
import { ErrorState, Loading, Markdown } from "../components/common";
import { CvPreview } from "../components/CvPreview";
import { downloadTex, texFilename } from "../lib/cvExport";
import { Icon, Spinner } from "../components/Icon";
import { ConfirmAppliedSheet, invalidateTracking, StatusMenu, SUBMITTED_STATUSES } from "../components/StatusMenu";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { copyableText, deadlineLabel, formatDate, hostname, KIND_LABELS } from "../lib/format";
import { invalidate, useAction, useDocumentTitle, useResource } from "../lib/hooks";

export function ApplyKitPage() {
  const appId = Number(useParams().appId);
  const { data: kit, error, loading, reload, mutate } = useResource(`kit:${appId}`, () => api.applyKit(appId));
  const toast = useToast();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  useDocumentTitle(kit ? `Apply to ${kit.job.company}` : "Apply");

  const [toggle] = useAction(async (key: string, done: boolean) => {
    if (!kit) return;
    mutate({ ...kit, steps: kit.steps.map((s) => (s.key === key ? { ...s, done } : s)) });
    await api.updateApplication(appId, { checklist: { [key]: done } });
    void reload();
  }, toast.error);

  const [markApplied, marking] = useAction(async (appliedAt: string) => {
    await api.updateApplication(appId, { status: "applied", confirmSubmitted: true, appliedAt });
    invalidateTracking(kit?.job.id);
    setConfirming(false);
    await reload();
    toast.show("Marked as applied. Good luck!");
  }, toast.error);

  async function generate(kind: "tailored_cv" | "cover_letter" | "answers") {
    if (!kit) return;
    setGenerating(kind);
    try {
      const jobId = kit.job.id;
      const doc = kind === "tailored_cv" ? await api.tailorCv(jobId) : kind === "cover_letter" ? await api.coverLetter(jobId) : await api.answers(jobId);
      invalidate("documents", `job:${jobId}`, "kit:");
      navigate(`/documents/${doc.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setGenerating(null);
    }
  }

  if (!kit) return <div className="page">{loading ? <Loading /> : error && <ErrorState error={error} onRetry={() => void reload()} />}</div>;

  const { job, application } = kit;
  const submitted = SUBMITTED_STATUSES.includes(application.status);
  const copy = (doc: Document) => void navigator.clipboard.writeText(copyableText(doc.content)).then(() => toast.show(`${KIND_LABELS[doc.kind]} copied`));

  const docFor: Record<string, { doc: Document | null; kind: "tailored_cv" | "cover_letter" | "answers"; create: string }> = {
    cv: { doc: kit.cv, kind: "tailored_cv", create: "Tailor CV" },
    cover_letter: { doc: kit.coverLetter, kind: "cover_letter", create: "Write" },
    answers: { doc: kit.answers, kind: "answers", create: "Draft" },
  };

  return (
    <div className="page">
      <div className="bar">
        <Link to={`/jobs/${job.id}`} className="btn btn-plain">
          <Icon name="chevron-left" />
          {job.company}
        </Link>
      </div>
      <div className="page-inner">
        <header className="page-header">
          <div style={{ minWidth: 0 }}>
            <h1 className="large-title">Apply to {job.company}</h1>
            <p className="page-subtitle">{job.title}</p>
          </div>
          <StatusMenu application={application} company={job.company} onChanged={() => void reload()} />
        </header>

        <div className="notice" style={{ marginBottom: 32 }}>
          <Icon name="paperplane" />
          <span>
            You submit the application yourself on {hostname(job.applyUrl)}. Company application portals don't offer a way to apply on your behalf, and many use
            CAPTCHAs, so everything you need is gathered here instead.
          </span>
        </div>

        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Checklist</h2>
            <span className="subhead muted">
              {kit.steps.filter((s) => s.done).length} of {kit.steps.length} done
            </span>
          </div>
          <div className="group">
            {kit.steps.map((step) => {
              const material = docFor[step.key];
              return (
                <div key={step.key} className="row" data-done={step.done}>
                  <button
                    type="button"
                    className="check"
                    role="checkbox"
                    aria-checked={step.done}
                    aria-label={step.label}
                    disabled={step.key === "record" && submitted}
                    onClick={() => (step.key === "record" ? setConfirming(true) : void toggle(step.key, !step.done))}
                  >
                    <Icon name="check" />
                  </button>
                  <div className="row-main">
                    <p className="row-title">
                      {step.label}
                      {step.optional && <span className="caption muted"> Optional</span>}
                    </p>
                    <p className="row-subtitle truncate">
                      {step.key === "requirements" && job.deadline
                        ? deadlineLabel(job.deadline)
                        : step.key === "record" && application.appliedAt
                          ? `Applied ${formatDate(application.appliedAt)}`
                          : step.detail}
                    </p>
                  </div>
                  <div className="row-trailing">
                    {material &&
                      (material.doc ? (
                        <Link className="btn btn-sm" to={`/documents/${material.doc.id}`}>
                          {material.doc.status === "approved" ? "View" : "Review"}
                        </Link>
                      ) : (
                        <button type="button" className="btn btn-sm" disabled={generating !== null} onClick={() => void generate(material.kind)}>
                          {generating === material.kind && <Spinner />}
                          {material.create}
                        </button>
                      ))}
                    {step.key === "requirements" && (
                      <Link className="btn btn-sm btn-plain" to={`/jobs/${job.id}`}>
                        Posting
                      </Link>
                    )}
                    {step.key === "submit" && (
                      <a className="btn btn-sm btn-primary" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                        Open Application
                        <Icon name="external" />
                      </a>
                    )}
                    {step.key === "record" && !submitted && (
                      <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)}>
                        Mark as Applied
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {generating && (
            <p className="section-footer" role="status">
              Drafting from your master CV. This can take a minute.
            </p>
          )}
        </section>

        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Quick Reference</h2>
          </div>
          <div className="group">
            <CopyRow label="Application link" value={job.applyUrl} />
            <CopyRow label="Position" value={job.title} />
            {job.location && <CopyRow label="Location" value={job.location} />}
            {job.deadline && (
              <div className="row">
                <div className="row-main">
                  <p className="row-subtitle">Deadline</p>
                  <p className="row-title">{deadlineLabel(job.deadline)}</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {kit.cv && <MaterialSection kit={kit} doc={kit.cv} onCopy={copy} printable />}
        {kit.coverLetter && <MaterialSection kit={kit} doc={kit.coverLetter} onCopy={copy} printable />}
        {kit.answers && <MaterialSection kit={kit} doc={kit.answers} onCopy={copy} />}
      </div>

      <ConfirmAppliedSheet open={confirming} company={job.company} pending={marking} onClose={() => setConfirming(false)} onConfirm={(d) => void markApplied(d)} />
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div className="row">
      <div className="row-main">
        <p className="row-subtitle">{label}</p>
        <p className="row-title truncate">{value}</p>
      </div>
      <button type="button" className="btn btn-plain btn-icon" aria-label={`Copy ${label.toLowerCase()}`} title="Copy" onClick={() => void navigator.clipboard.writeText(value).then(() => toast.show("Copied"))}>
        <Icon name="copy" />
      </button>
    </div>
  );
}

function MaterialSection({ doc, onCopy, printable }: { kit: ApplyKit; doc: Document; onCopy: (doc: Document) => void; printable?: boolean }) {
  const cv = useMemo(() => (isLatexCv(doc.content) ? parseLatexCv(doc.content) : null), [doc.content]);
  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">{KIND_LABELS[doc.kind]}</h2>
        <div className="hstack wrap" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-sm" onClick={() => onCopy(doc)}>
            <Icon name="copy" />
            Copy Text
          </button>
          {cv && (
            <button type="button" className="btn btn-sm" onClick={() => downloadTex(doc.content, texFilename(doc.title))}>
              Download .tex
            </button>
          )}
          {printable && (
            <a className="btn btn-sm" href={`/print/${doc.id}`} target="_blank" rel="noopener">
              <Icon name="printer" />
              Save as PDF
            </a>
          )}
        </div>
      </div>
      {doc.status !== "approved" && (
        <p className="subhead muted" style={{ margin: "0 4px 12px" }}>
          Draft. <Link to={`/documents/${doc.id}`}>Review and approve it</Link> before using it.
        </p>
      )}
      {cv ? (
        <div className="cv-sheet">
          <CvPreview doc={cv} />
        </div>
      ) : (
        <div className="paper">
          <Markdown source={doc.content} />
        </div>
      )}
    </section>
  );
}
