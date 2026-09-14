import { useState } from "react";
import { Link } from "react-router";
import { STATUS_LABELS, type Application, type ApplicationStatus } from "../../shared/types";
import { EmptyState, ErrorState, Loading } from "../components/common";
import { StatusMenu } from "../components/StatusMenu";
import { api } from "../lib/api";
import { deadlineLabel, formatDate, plural } from "../lib/format";
import { useDocumentTitle, useResource } from "../lib/hooks";

const STAGES: ApplicationStatus[] = ["interested", "preparing", "ready", "applied", "interview", "offer", "rejected"];
const ACTIVE: ApplicationStatus[] = ["interested", "preparing", "ready", "applied", "interview"];

export function Pipeline() {
  const { data: apps, error, loading, reload } = useResource("applications", () => api.applications());
  const [filter, setFilter] = useState<ApplicationStatus | null>(null);
  useDocumentTitle("Pipeline");

  if (!apps) return <div className="page">{loading ? <Loading /> : error && <ErrorState error={error} onRetry={() => void reload()} />}</div>;

  const byStage = new Map<ApplicationStatus, Application[]>(STAGES.map((s) => [s, []]));
  for (const app of apps) byStage.get(app.status)?.push(app);
  for (const list of byStage.values()) {
    list.sort((a, b) => {
      const pa = a.priority === "high" ? 0 : 1;
      const pb = b.priority === "high" ? 0 : 1;
      return pa - pb || (a.job.deadline ?? "9999").localeCompare(b.job.deadline ?? "9999");
    });
  }
  const activeCount = apps.filter((a) => ACTIVE.includes(a.status)).length;
  const visible = filter ? [filter] : STAGES;

  return (
    <div className="page">
      <div className="page-inner wide">
        <header className="page-header">
          <div>
            <h1 className="large-title">Pipeline</h1>
            <p className="page-subtitle">{apps.length ? `${plural(activeCount, "active application")}` : "Every internship you track, from interest to offer."}</p>
          </div>
        </header>

        {apps.length === 0 ? (
          <EmptyState
            icon="stack"
            title="No applications yet"
            message="Track internships from Discover to build your pipeline."
            action={
              <Link to="/discover" className="btn btn-primary">
                Go to Discover
              </Link>
            }
          />
        ) : (
          <>
            <div className="summary-strip" role="group" aria-label="Filter by stage">
              {STAGES.map((s) => (
                <button key={s} type="button" className="summary-item" aria-pressed={filter === s} onClick={() => setFilter(filter === s ? null : s)}>
                  <div className="summary-value">{byStage.get(s)!.length}</div>
                  <div className="summary-label status" data-status={s}>
                    <span className="status-dot" />
                    {STATUS_LABELS[s]}
                  </div>
                </button>
              ))}
            </div>

            <div style={{ marginTop: 32 }}>
              {visible.map((stage) => {
                const list = byStage.get(stage)!;
                if (!list.length) {
                  return filter ? <EmptyState key={stage} icon="stack" title={`Nothing in ${STATUS_LABELS[stage]}`} /> : null;
                }
                return (
                  <section key={stage} className="stage" aria-labelledby={`stage-${stage}`}>
                    <h2 id={`stage-${stage}`} className="stage-header" data-status={stage}>
                      <span className="status-dot" />
                      {STATUS_LABELS[stage]}
                      <span className="stage-count">{list.length}</span>
                    </h2>
                    <div className="group">
                      {list.map((app) => (
                        <PipelineRow key={app.id} app={app} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PipelineRow({ app }: { app: Application }) {
  const { job } = app;
  const submitted = ["applied", "interview", "offer", "rejected"].includes(app.status);
  const trailing = submitted
    ? app.appliedAt
      ? `Applied ${formatDate(app.appliedAt)}`
      : ""
    : job.deadline
      ? deadlineLabel(job.deadline)
      : "";
  return (
    <div className="row">
      <Link to={`/jobs/${job.id}`} className="row-main" style={{ color: "inherit", textDecoration: "none" }}>
        <span className="row-title truncate" style={{ display: "block" }}>
          {app.priority === "high" && (
            <span className="priority-mark" aria-label="High priority">
              !!{" "}
            </span>
          )}
          {job.company}
        </span>
        <span className="row-subtitle truncate" style={{ display: "block" }}>
          {job.title}
        </span>
      </Link>
      {trailing && <span className="row-trailing hide-mobile">{trailing}</span>}
      {!submitted && (
        <Link to={`/applications/${app.id}/apply`} className="btn btn-sm btn-plain hide-mobile">
          Apply Kit
        </Link>
      )}
      <StatusMenu application={app} company={job.company} size="sm" />
    </div>
  );
}
