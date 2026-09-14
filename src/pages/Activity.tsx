import { useState } from "react";
import { Link } from "react-router";
import type { AuditEvent } from "../../shared/types";
import { EmptyState, ErrorState, Loading, Segmented } from "../components/common";
import { Spinner } from "../components/Icon";
import { describeJobEvent } from "../components/JobDetailView";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useDocumentTitle, useResource } from "../lib/hooks";

type Filter = "" | "application" | "document" | "job" | "source";

const PAGE = 100;

export function Activity() {
  const [filter, setFilter] = useState<Filter>("application");
  const { data, error, loading, reload } = useResource(`events:${filter}`, () => api.events({ entityType: filter || undefined, limit: PAGE }));
  const [older, setOlder] = useState<{ filter: Filter; items: AuditEvent[]; done: boolean }>({ filter, items: [], done: false });
  const [loadingMore, setLoadingMore] = useState(false);
  useDocumentTitle("Activity");

  const extra = older.filter === filter ? older.items : [];
  const events = [...(data ?? []), ...extra];
  const done = older.filter === filter ? older.done : false;

  const loadMore = async () => {
    const last = events[events.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const next = await api.events({ entityType: filter || undefined, before: last.id, limit: PAGE });
      setOlder({ filter, items: [...extra, ...next], done: next.length < PAGE });
    } finally {
      setLoadingMore(false);
    }
  };

  const days = new Map<string, AuditEvent[]>();
  for (const e of events) {
    const day = new Date(e.createdAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    days.set(day, [...(days.get(day) ?? []), e]);
  }

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="large-title">Activity</h1>
            <p className="page-subtitle">A record of your applications, documents and discoveries.</p>
          </div>
          <Segmented<Filter>
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "application", label: "Applications" },
              { value: "document", label: "Documents" },
              { value: "job", label: "Internships" },
              { value: "", label: "Everything" },
            ]}
          />
        </header>

        {!data ? (
          loading ? <Loading /> : error && <ErrorState error={error} onRetry={() => void reload()} />
        ) : events.length === 0 ? (
          <EmptyState icon="clock" title="No activity yet" message="Tracking internships, generating documents and status changes are recorded here." />
        ) : (
          <>
            {[...days.entries()].map(([day, items]) => (
              <section key={day} className="section">
                <div className="section-header">
                  <h2 className="headline">{day}</h2>
                </div>
                <div className="group">
                  {items.map((e) => {
                    const jobId = typeof e.detail.jobId === "number" ? e.detail.jobId : null;
                    const body = (
                      <>
                        <span className="timeline-dot" data-status={typeof e.detail.to === "string" ? e.detail.to : undefined} style={{ margin: 0, boxShadow: "none" }} />
                        <span className="row-main">
                          <span className="row-title truncate" style={{ display: "block" }}>
                            {describe(e)}
                          </span>
                          {e.label && (
                            <span className="row-subtitle truncate" style={{ display: "block" }}>
                              {e.label}
                            </span>
                          )}
                        </span>
                        <span className="row-trailing">{relativeTime(e.createdAt)}</span>
                      </>
                    );
                    return jobId ? (
                      <Link key={e.id} to={`/jobs/${jobId}`} className="row">
                        {body}
                      </Link>
                    ) : (
                      <div key={e.id} className="row">
                        {body}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {!done && events.length >= PAGE && (
              <div className="hstack" style={{ justifyContent: "center", marginTop: 24 }}>
                <button type="button" className="btn" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore && <Spinner />}
                  Show Older
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function describe(e: AuditEvent): string {
  const d = e.detail;
  switch (`${e.entityType}.${e.action}`) {
    case "source.created":
      return "Source added";
    case "source.failed":
      return `Check failed: ${String(d.message ?? "")}`;
    case "source.enabled":
      return "Source turned on";
    case "source.disabled":
      return "Source turned off";
    case "source.deleted":
      return `Removed ${String(d.name ?? "a source")}`;
    case "profile.updated":
      return "Profile updated";
    case "document.uploaded":
      return "Master CV added";
    case "document.activated":
      return "Master CV version changed";
    default:
      return describeJobEvent(e.entityType, e.action, d);
  }
}
