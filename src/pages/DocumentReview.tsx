import { diffWords } from "diff";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { documentText, isLatexCv, parseLatexCv } from "../../shared/cv";
import type { Document } from "../../shared/types";
import { ErrorState, Loading, Markdown, Segmented, Warnings } from "../components/common";
import { CvPreview } from "../components/CvPreview";
import { Icon, Spinner } from "../components/Icon";
import { MenuButton, type MenuItem } from "../components/Menu";
import { LetterReasoning, QualityReviewPanel, TailoringView, useExportGuard } from "../components/Personalization";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { downloadTex, openInOverleaf, texFilename } from "../lib/cvExport";
import { copyableText, KIND_LABELS, relativeTime } from "../lib/format";
import { invalidate, useAction, useDocumentTitle, useResource } from "../lib/hooks";

type Mode = "tailoring" | "reasoning" | "changes" | "edit" | "preview";

export function DocumentReview() {
  const id = Number(useParams().docId);
  const { data: doc, error, loading, reload, mutate } = useResource(`doc:${id}`, () => api.document(id));
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useDocumentTitle(doc?.title);

  const content = draft ?? doc?.content ?? "";
  const isLatex = isLatexCv(content);
  const cv = useMemo(() => (isLatex ? parseLatexCv(content) : null), [isLatex, content]);
  const hasDiff = doc?.kind === "tailored_cv" && Boolean(doc.meta.parentContent);
  const hasTailoring = doc?.kind === "tailored_cv" && Boolean(doc.meta.bulletChanges?.length || doc.meta.strategy);
  const hasReasoning = doc?.kind === "cover_letter" && Boolean(doc.meta.plan);
  const reviewable = doc?.kind === "tailored_cv" || doc?.kind === "cover_letter";
  const defaultMode: Mode =
    doc?.status === "draft" && hasTailoring ? "tailoring" : doc?.status === "draft" && hasDiff ? "changes" : doc?.kind === "master_cv" && doc.content.length < 40 ? "edit" : "preview";
  const currentMode = mode ?? defaultMode;
  const dirty = draft !== null && draft !== doc?.content;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const afterChange = (updated: Document) => {
    mutate({ ...updated, meta: { ...updated.meta, parentContent: updated.meta.parentContent ?? doc?.meta.parentContent } });
    invalidate("documents", "overview", "kit:", "applications", "events", ...(updated.jobId ? [`job:${updated.jobId}`] : []));
  };

  const [save, saving] = useAction(async (): Promise<Document | undefined> => {
    if (!doc || draft === null) return doc;
    const updated = await api.updateDocument(doc.id, { content: draft });
    afterChange(updated);
    setDraft(null);
    toast.show("Changes saved");
    if (updated.kind === "master_cv") invalidate("jobs", "job:", "knowledge");
    return updated;
  }, toast.error);

  const [setStatus, statusPending] = useAction(async (status: "draft" | "approved") => {
    if (!doc) return;
    if (dirty) await save();
    const updated = await api.updateDocument(doc.id, { status });
    afterChange(updated);
    toast.show(status === "approved" ? `${KIND_LABELS[doc.kind]} approved` : "Moved back to draft");
  }, toast.error);

  const [runReview, reviewing] = useAction(async () => {
    if (!doc) return;
    if (dirty && !(await save())) return;
    const updated = await api.reviewDocument(doc.id);
    afterChange(updated);
    toast.show(updated.meta.review?.verdict === "ready" ? "Ready to send" : "The review found things to fix");
  }, toast.error);

  const [remove] = useAction(async () => {
    if (!doc) return;
    await api.deleteDocument(doc.id);
    invalidate("documents", "overview", "kit:", ...(doc.jobId ? [`job:${doc.jobId}`] : []));
    toast.show(`${KIND_LABELS[doc.kind]} deleted`);
    navigate(doc.jobId ? `/jobs/${doc.jobId}` : "/documents", { replace: true });
  }, toast.error);

  const { guard, sheet: exportSheet } = useExportGuard(doc, {
    dirty,
    onReview: () => {
      const review = doc?.meta.review;
      if (dirty || !review || review.stale) {
        void runReview();
        return;
      }
      if (currentMode === "edit") setMode("preview");
      requestAnimationFrame(() => document.getElementById("quality-review")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save]);

  if (!doc) return <div className="page">{loading ? <Loading /> : error && <ErrorState error={error} onRetry={() => void reload()} />}</div>;

  const isMaster = doc.kind === "master_cv";
  const filename = texFilename(doc.title);
  const modes: { value: Mode; label: string }[] = [
    ...(hasTailoring ? [{ value: "tailoring" as const, label: "Tailoring" }] : []),
    ...(hasReasoning ? [{ value: "reasoning" as const, label: "Reasoning" }] : []),
    ...(hasDiff ? [{ value: "changes" as const, label: "Diff" }] : []),
    { value: "preview", label: "Preview" },
    { value: "edit", label: "Edit" },
  ];
  const warnings = doc.meta.warnings ?? [];
  const canRevert = doc.generatedContent && content !== doc.generatedContent;
  const download = guard("Download", () => downloadTex(content, filename));
  const overleaf = guard("Open", () => openInOverleaf(content, filename));

  const menu: MenuItem[] = [
    ...(isLatex
      ? [
          { key: "tex", label: "Download .tex", onSelect: download },
          { key: "overleaf", label: "Open in Overleaf", onSelect: overleaf },
        ]
      : []),
    { key: "print", label: "Print or Save as PDF", separatorBefore: isLatex, onSelect: guard("Print", () => window.open(`/print/${doc.id}`, "_blank", "noopener")) },
    {
      key: "copy",
      label: "Copy as Plain Text",
      onSelect: guard("Copy", () => void navigator.clipboard.writeText(copyableText(content)).then(() => toast.show("Copied"))),
    },
    ...(reviewable ? [{ key: "review", label: "Run Quality Review", onSelect: () => void runReview() }] : []),
    ...(canRevert
      ? [
          {
            key: "revert",
            label: "Revert to Generated Version",
            onSelect: () => {
              setDraft(doc.generatedContent);
              setMode("edit");
            },
          },
        ]
      : []),
    ...(doc.status === "approved" ? [{ key: "unapprove", label: "Move Back to Draft", onSelect: () => void setStatus("draft") }] : []),
    { key: "delete", label: "Delete…", destructive: true, separatorBefore: true, onSelect: () => setConfirmDelete(true) },
  ];

  return (
    <div className="page">
      <div className="bar">
        <Link to={doc.jobId ? `/jobs/${doc.jobId}` : "/documents"} className="btn btn-plain">
          <Icon name="chevron-left" />
          <span className="hide-mobile">{doc.job ? doc.job.company : "Documents"}</span>
        </Link>
        <span className="spacer" />
        <Segmented label="View" value={currentMode} options={modes} onChange={setMode} />
        <span className="spacer" />
        <MenuButton className="btn btn-plain btn-icon" label="More" align="end" items={menu}>
          <Icon name="ellipsis" />
        </MenuButton>
        {dirty && (
          <button type="button" className="btn" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner />}
            Save
          </button>
        )}
        {!isMaster &&
          (doc.status === "approved" ? (
            <span className="btn btn-plain" style={{ color: "var(--color-green)", cursor: "default" }} aria-live="polite">
              <Icon name="check" />
              Approved
            </span>
          ) : (
            <button type="button" className="btn btn-primary" onClick={guard("Approve", () => void setStatus("approved"))} disabled={statusPending}>
              {statusPending && <Spinner />}
              Approve
            </button>
          ))}
      </div>

      <div className="page-inner wide">
        <header className="hstack wrap" style={{ marginBottom: 24, alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <p className="detail-company">{doc.job ? `${doc.job.company}, ${doc.job.title}` : KIND_LABELS[doc.kind]}</p>
            <h1 className="title-1" style={{ marginTop: 2 }}>
              {doc.title}
            </h1>
            <p className="subhead muted" style={{ marginTop: 6 }}>
              {isMaster
                ? doc.meta.filename
                  ? `From ${doc.meta.filename}${isLatex ? "" : ". Check the text converted cleanly."}`
                  : `Updated ${relativeTime(doc.updatedAt).toLowerCase()}`
                : `${doc.status === "approved" ? "Approved" : "Draft"}${doc.meta.generator ? `, written by ${doc.meta.generator}` : ""}, ${relativeTime(doc.createdAt).toLowerCase()}`}
            </p>
          </div>
          {isLatex && (
            <div className="hstack">
              <button type="button" className="btn btn-sm" onClick={download}>
                <Icon name="upload" style={{ transform: "rotate(180deg)" }} />
                Download .tex
              </button>
              <button type="button" className="btn btn-sm" onClick={overleaf}>
                <Icon name="external" />
                Open in Overleaf
              </button>
            </div>
          )}
        </header>

        {isMaster && !isLatex && (
          <div className="notice" style={{ marginBottom: 24 }}>
            <Icon name="doc" />
            <span>
              Tailored CVs use your LaTeX résumé template. For exact wording and layout, upload your résumé's <strong>.tex</strong> file under Documents instead of a
              PDF.
            </span>
          </div>
        )}

        {warnings.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <Warnings title={warnings.length === 1 ? "Check this before using it" : `Check these ${warnings.length} things before using it`} warnings={warnings} />
          </div>
        )}

        {reviewable && currentMode !== "edit" && (
          <div style={{ marginBottom: 32 }}>
            <QualityReviewPanel id="quality-review" review={doc.meta.review} running={reviewing} onRun={() => void runReview()} />
          </div>
        )}

        {currentMode === "tailoring" && <TailoringView meta={doc.meta} />}
        {currentMode === "reasoning" && <LetterReasoning meta={doc.meta} />}
        {currentMode === "changes" && hasDiff && <ChangesView doc={doc} content={content} />}
        {currentMode === "preview" &&
          (isLatex ? (
            cv ? (
              <div className="cv-sheet">
                <CvPreview doc={cv} />
              </div>
            ) : (
              <div className="notice notice-error" role="alert">
                <Icon name="warning" />
                <span>This LaTeX couldn't be read for the preview. Check the Edit view for unbalanced braces, or download the .tex file.</span>
              </div>
            )
          ) : (
            <div className="paper">
              <Markdown source={content} />
            </div>
          ))}
        {currentMode === "edit" && (
          <div className="field">
            <label className="sr-only" htmlFor="doc-editor">
              Document text
            </label>
            <textarea id="doc-editor" className="textarea editor" value={content} onChange={(e) => setDraft(e.target.value)} spellCheck={!isLatex} />
            <p className="field-hint">
              {isLatex ? "LaTeX source in your résumé template. Press ⌘S to save." : "Markdown: # Name, ## Section, - bullet, **bold**. Press ⌘S to save."}
              {reviewable && " Saving marks the quality review out of date."}
            </p>
          </div>
        )}

        {doc.meta.grounding && doc.meta.grounding.length > 0 && (currentMode === "preview" || currentMode === "reasoning") && (
          <section className="section">
            <div className="section-header">
              <h2 className="section-title">{doc.kind === "answers" ? "Sources for each answer" : "Where each claim comes from"}</h2>
            </div>
            <div className="group">
              {doc.meta.grounding.map((g, i) => (
                <div key={i} className="row">
                  <div className="row-main">
                    <p className="row-title">{g.claim}</p>
                    <p className="row-subtitle">{g.source}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {exportSheet}
      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete this ${KIND_LABELS[doc.kind].toLowerCase()}?`}
        message="This can't be undone."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" style={{ background: "var(--color-red)" }} onClick={() => void remove()}>
              Delete
            </button>
          </>
        }
      />
    </div>
  );
}

function ChangesView({ doc, content }: { doc: Document; content: string }) {
  const parts = useMemo(
    () => diffWords(documentText(doc.meta.parentContent ?? "", { urls: false }), documentText(content, { urls: false })),
    [doc.meta.parentContent, content],
  );
  const changes = doc.meta.changes ?? [];
  return (
    <>
      {changes.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-header">
            <h2 className="section-title">Structure</h2>
          </div>
          <div className="group">
            {changes.map((c, i) => (
              <div key={i} className="row" style={{ alignItems: "flex-start" }}>
                <div className="row-main">
                  <p className="headline">{c.section}</p>
                  <p className="row-title" style={{ marginTop: 2 }}>
                    {c.change}
                  </p>
                  <p className="row-subtitle" style={{ marginTop: 2 }}>
                    {c.reason}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="section-header">
        <h2 className="section-title">Compared with your master CV</h2>
        <span className="legend" aria-hidden="true">
          <span className="added">Added</span>
          <span className="removed">Removed</span>
        </span>
      </div>
      <div className="diff">
        {parts.map((part, i) =>
          part.added ? <ins key={i}>{part.value}</ins> : part.removed ? <del key={i}>{part.value}</del> : <span key={i}>{part.value}</span>,
        )}
      </div>
    </>
  );
}
