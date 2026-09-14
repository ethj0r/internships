import { useMemo } from "react";
import { useParams } from "react-router";
import { isLatexCv, parseLatexCv } from "../../shared/cv";
import { ErrorState, Loading, Markdown } from "../components/common";
import { CvPreview } from "../components/CvPreview";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { downloadTex, texFilename } from "../lib/cvExport";
import { useDocumentTitle, useResource } from "../lib/hooks";

/** A clean, chrome-free page for printing or saving a document as PDF. */
export function PrintDocument() {
  const id = Number(useParams().docId);
  const { data: doc, error, loading, reload } = useResource(`doc:${id}`, () => api.document(id));
  const cv = useMemo(() => (doc && isLatexCv(doc.content) ? parseLatexCv(doc.content) : null), [doc]);
  useDocumentTitle(doc?.title);

  if (!doc) return loading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => void reload()} /> : null;

  return (
    <div className={`print-page${cv ? " print-cv" : ""}`}>
      {cv && <style>{"@page { size: letter; margin: 0; }"}</style>}
      <div className="print-toolbar">
        <button type="button" className="btn btn-plain" onClick={() => window.close()}>
          Close
        </button>
        {cv && (
          <button type="button" className="btn" onClick={() => downloadTex(doc.content, texFilename(doc.title))}>
            Download .tex
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="printer" />
          Print or Save as PDF
        </button>
      </div>
      {doc.status !== "approved" && doc.kind !== "master_cv" && (
        <div className="notice notice-warning print-toolbar" style={{ justifyContent: "flex-start" }}>
          <Icon name="warning" />
          <span>This is still a draft. Approve it before you send it.</span>
        </div>
      )}
      {cv ? (
        <div className="cv-sheet">
          <CvPreview doc={cv} />
        </div>
      ) : (
        <div className="paper" style={{ margin: "0 auto" }}>
          <Markdown source={doc.content} />
        </div>
      )}
    </div>
  );
}
