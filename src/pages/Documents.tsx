import { useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { DocumentKind, DocumentSummary } from "../../shared/types";
import { EmptyState, ErrorState, Loading } from "../components/common";
import { Icon, Spinner } from "../components/Icon";
import { MenuButton } from "../components/Menu";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { KIND_LABELS, relativeTime } from "../lib/format";
import { invalidate, useAction, useDocumentTitle, useResource } from "../lib/hooks";

const ACCEPT = ".tex,.pdf,.docx,.odt,.md,.markdown,.txt,.html";
const GENERATED: DocumentKind[] = ["tailored_cv", "cover_letter", "answers"];

export function Documents() {
  const { data: docs, error, loading, reload } = useResource("documents:all", () => api.documents());
  const toast = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const [dragging, setDragging] = useState(false);
  useDocumentTitle("Documents");

  const [upload, uploading] = useAction(async (file: File) => {
    const doc = await api.uploadMasterCv(file);
    invalidate("documents", "overview", "jobs", "job:");
    toast.show("CV added. Check the extracted text.");
    navigate(`/documents/${doc.id}`);
  }, toast.error);

  const [activate] = useAction(async (id: number) => {
    await api.updateDocument(id, { isActive: true });
    invalidate("documents", "overview", "jobs", "job:");
    toast.show("Master CV updated");
  }, toast.error);

  const [remove] = useAction(async (doc: DocumentSummary) => {
    await api.deleteDocument(doc.id);
    invalidate("documents", "overview", "job:", "kit:");
    toast.show(`${KIND_LABELS[doc.kind]} deleted`);
  }, toast.error);

  if (!docs) return <div className="page">{loading ? <Loading /> : error && <ErrorState error={error} onRetry={() => void reload()} />}</div>;

  const masters = docs.filter((d) => d.kind === "master_cv");
  const active = masters.find((d) => d.isActive) ?? masters[0];
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void upload(file);
  };

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="large-title">Documents</h1>
            <p className="page-subtitle">Your master CV, and everything tailored from it.</p>
          </div>
        </header>

        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />

        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Master CV</h2>
          </div>
          {uploading ? (
            <div className="group group-padded" role="status">
              <div className="progress" />
              <p className="subhead muted" style={{ marginTop: 10 }}>
                Reading your CV…
              </p>
            </div>
          ) : active ? (
            <div className="group">
              {masters.map((doc) => (
                <div key={doc.id} className="row inset-icon">
                  <span className="row-icon">
                    <Icon name="doc" />
                  </span>
                  <Link to={`/documents/${doc.id}`} className="row-main" style={{ color: "inherit", textDecoration: "none" }}>
                    <span className="row-title truncate" style={{ display: "block" }}>
                      {doc.title}
                    </span>
                    <span className="row-subtitle">
                      {doc.id === active.id ? "In use" : "Previous version"}, updated {relativeTime(doc.updatedAt).toLowerCase()}
                    </span>
                  </Link>
                  <MenuButton
                    className="btn btn-plain btn-icon"
                    label="Actions"
                    align="end"
                    items={[
                      { key: "open", label: "Open", onSelect: () => navigate(`/documents/${doc.id}`) },
                      ...(doc.id !== active.id ? [{ key: "use", label: "Use This Version", onSelect: () => void activate(doc.id) }] : []),
                      { key: "delete", label: "Delete", destructive: true, separatorBefore: true, onSelect: () => void remove(doc) },
                    ]}
                  >
                    <Icon name="ellipsis" />
                  </MenuButton>
                </div>
              ))}
              <Link to="/knowledge" className="row inset-icon">
                <span className="row-icon">
                  <Icon name="book" />
                </span>
                <span className="row-main">
                  <span className="row-title" style={{ display: "block" }}>
                    Career Knowledge
                  </span>
                  <span className="row-subtitle">Add the context behind your CV entries that applications can draw on</span>
                </span>
                <Icon name="chevron-right" className="row-chevron" />
              </Link>
              <div className="row wrap" style={{ gap: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" />
                  Upload New Version
                </button>
                <button type="button" className="btn btn-sm btn-plain" onClick={() => setPasting(true)}>
                  Paste Text
                </button>
              </div>
            </div>
          ) : (
            <div
              className="group group-padded"
              style={{ textAlign: "center", boxShadow: dragging ? "0 0 0 2px var(--color-accent)" : undefined }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <EmptyState
                icon="upload"
                title="Add your master CV"
                message="Upload your résumé's LaTeX source (.tex) so tailored CVs keep your template, or a PDF, DOCX or Markdown file. You can also drop it here."
                action={
                  <div className="hstack" style={{ justifyContent: "center", marginTop: 12 }}>
                    <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                      Choose File
                    </button>
                    <button type="button" className="btn btn-plain" onClick={() => setPasting(true)}>
                      Paste Text
                    </button>
                  </div>
                }
              />
            </div>
          )}
          <p className="section-footer">
            Tailored CVs are rendered with your LaTeX résumé template, so a .tex master gives exact results. Your CV is stored in your private database and only sent
            to the AI model when you generate or analyze something.
          </p>
        </section>

        {GENERATED.map((kind) => {
          const list = docs.filter((d) => d.kind === kind);
          if (!list.length) return null;
          return (
            <section key={kind} className="section">
              <div className="section-header">
                <h2 className="section-title">{KIND_LABELS[kind]}s</h2>
              </div>
              <div className="group">
                {list.map((doc) => (
                  <Link key={doc.id} to={`/documents/${doc.id}`} className="row">
                    <span className="row-main">
                      <span className="row-title truncate" style={{ display: "block" }}>
                        {doc.job ? doc.job.company : doc.title}
                      </span>
                      <span className="row-subtitle truncate" style={{ display: "block" }}>
                        {doc.job?.title ?? doc.title}
                      </span>
                    </span>
                    <span className="row-trailing">
                      <span style={{ color: doc.status === "approved" ? "var(--color-green)" : undefined }}>{doc.status === "approved" ? "Approved" : "Draft"}</span>
                      <span className="hide-mobile">{relativeTime(doc.updatedAt)}</span>
                      <Icon name="chevron-right" className="row-chevron" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        {!docs.some((d) => GENERATED.includes(d.kind)) && active && (
          <section className="section">
            <p className="muted" style={{ textAlign: "center" }}>
              Tailored CVs, cover letters and answers appear here once you create them from an internship.
            </p>
          </section>
        )}
      </div>

      <PasteCvSheet
        open={pasting}
        onClose={() => setPasting(false)}
        onSaved={(id) => {
          setPasting(false);
          invalidate("documents", "overview", "jobs", "job:");
          navigate(`/documents/${id}`);
        }}
      />
    </div>
  );
}

function PasteCvSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: number) => void }) {
  const [content, setContent] = useState("");
  const toast = useToast();
  const [save, pending] = useAction(async () => {
    const doc = await api.createMasterCv(content);
    setContent("");
    onSaved(doc.id);
  }, toast.error);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Paste your CV"
      message="Paste your résumé's LaTeX source to keep its template exactly. Plain text and Markdown also work."
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!content.trim() || pending} onClick={() => void save()}>
            {pending && <Spinner />}
            Save CV
          </button>
        </>
      }
    >
      <textarea className="textarea" rows={16} aria-label="CV text" value={content} onChange={(e) => setContent(e.target.value)} data-autofocus style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} />
    </Sheet>
  );
}
