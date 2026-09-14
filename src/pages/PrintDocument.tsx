import { useParams } from "react-router";
import { ErrorState, Loading, Markdown } from "../components/common";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { useDocumentTitle, useResource } from "../lib/hooks";

/** A clean, chrome-free page for printing or saving a document as PDF. */
export function PrintDocument() {
  const id = Number(useParams().docId);
  const { data: doc, error, loading, reload } = useResource(`doc:${id}`, () => api.document(id));
  useDocumentTitle(doc?.title);

  if (!doc) return loading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => void reload()} /> : null;

  return (
    <div className="print-page">
      <div className="print-toolbar">
        <button type="button" className="btn btn-plain" onClick={() => window.close()}>
          Close
        </button>
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
      <div className="paper" style={{ margin: "0 auto" }}>
        <Markdown source={doc.content} />
      </div>
    </div>
  );
}
