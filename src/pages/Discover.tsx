import { useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { JobSummary } from "../../shared/types";
import { AddJobSheet } from "../components/AddJobSheet";
import { NotificationsButton } from "../components/AppShell";
import { EmptyState, ErrorState, MatchRing, Segmented, StatusLabel } from "../components/common";
import { Icon, Spinner } from "../components/Icon";
import { JobDetailView } from "../components/JobDetailView";
import { MenuButton } from "../components/Menu";
import { useToast } from "../components/Toast";
import { api, type JobQuery } from "../lib/api";
import { daysUntil, deadlineLabel, isNew, plural, relativeTime, WORKPLACE_LABELS } from "../lib/format";
import { invalidate, useAction, useDebounced, useDocumentTitle, useResource } from "../lib/hooks";

type View = NonNullable<JobQuery["view"]>;
type Sort = NonNullable<JobQuery["sort"]>;

export function Discover() {
  const { jobId } = useParams();
  const selectedId = jobId ? Number(jobId) : null;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search.trim(), 250);

  const view = (params.get("view") as View) || "inbox";
  const sort = (params.get("sort") as Sort) || (view === "inbox" ? "score" : "newest");
  const workplace = params.get("workplace") ?? "";
  const minScore = Number(params.get("minScore") ?? 0);

  const query: JobQuery = { view, sort, q, workplace: workplace || undefined, minScore: minScore || undefined, limit: 200 };
  const key = `jobs:${JSON.stringify(query)}`;
  const { data, error, loading, reload } = useResource(key, () => api.jobs(query));
  const { data: overview } = useResource("overview", api.overview);
  useDocumentTitle("Discover");

  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };
  const listSearch = params.toString() ? `?${params}` : "";
  const jobs = data?.jobs ?? [];

  const [checkNow, checking] = useAction(async () => {
    const run = await api.runDiscovery();
    invalidate("jobs", "overview", "sources", "runs");
    toast.show(run.jobsNew ? `Found ${plural(run.jobsNew, "new internship")}` : `Checked ${plural(run.sourcesChecked, "source")}. Nothing new yet.`);
  }, toast.error);

  const select = (job: JobSummary | undefined) => job && navigate(`/discover/${job.id}${listSearch}`);
  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const index = jobs.findIndex((j) => j.id === selectedId);
    select(jobs[e.key === "ArrowDown" ? Math.min(jobs.length - 1, index + 1) : Math.max(0, index - 1)]);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.job-row[aria-current="true"]')?.focus());
  };

  const afterDismiss = () => {
    const index = jobs.findIndex((j) => j.id === selectedId);
    const next = jobs[index + 1] ?? jobs[index - 1];
    navigate(next && next.id !== selectedId ? `/discover/${next.id}${listSearch}` : `/discover${listSearch}`, { replace: true });
  };

  const filtersActive = Boolean(workplace || minScore);

  return (
    <div className="split" data-detail={selectedId !== null}>
      <section className="split-list" aria-label="Internships">
        <div className="list-tools">
          <div className="hstack">
            <h1 className="title-2" style={{ flex: 1 }}>
              Discover
            </h1>
            <span className="show-mobile">
              <NotificationsButton unread={overview?.unreadNotifications ?? 0} variant="icon" />
            </span>
            <MenuButton
              className={`btn btn-icon ${filtersActive ? "" : "btn-plain"}`}
              label="Sort and filter"
              align="end"
              items={[
                { key: "score", label: "Best Match", checked: sort === "score", onSelect: () => setParam("sort", "score") },
                { key: "newest", label: "Newest", checked: sort === "newest", onSelect: () => setParam("sort", "newest") },
                { key: "deadline", label: "Closing Soon", checked: sort === "deadline", onSelect: () => setParam("sort", "deadline") },
                { key: "any", label: "Any Workplace", checked: !workplace, separatorBefore: true, onSelect: () => setParam("workplace", null) },
                { key: "remote", label: "Remote", checked: workplace === "remote", onSelect: () => setParam("workplace", "remote") },
                { key: "hybrid", label: "Hybrid", checked: workplace === "hybrid", onSelect: () => setParam("workplace", "hybrid") },
                { key: "onsite", label: "On-site", checked: workplace === "onsite", onSelect: () => setParam("workplace", "onsite") },
                { key: "m0", label: "Any Match", checked: !minScore, separatorBefore: true, onSelect: () => setParam("minScore", null) },
                { key: "m50", label: "50% Match or Higher", checked: minScore === 50, onSelect: () => setParam("minScore", "50") },
                { key: "m75", label: "75% Match or Higher", checked: minScore === 75, onSelect: () => setParam("minScore", "75") },
              ]}
            >
              <Icon name="filter" />
            </MenuButton>
            <button type="button" className="btn btn-plain btn-icon" title="Add Internship" aria-label="Add internship" onClick={() => setAdding(true)}>
              <Icon name="plus" />
            </button>
          </div>
          <div className="search">
            <Icon name="search" />
            <input
              className="input"
              type="search"
              placeholder="Search roles, companies, locations"
              aria-label="Search internships"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setParam("q", e.target.value.trim() || null);
              }}
            />
          </div>
          <Segmented<View>
            label="Show"
            value={view}
            onChange={(v) => setParam("view", v === "inbox" ? null : v)}
            options={[
              { value: "inbox", label: "New" },
              { value: "all", label: "All" },
              { value: "tracked", label: "Tracked" },
              { value: "dismissed", label: "Hidden" },
            ]}
          />
        </div>

        <div className="list-scroll" onKeyDown={onListKey}>
          {overview && (!overview.hasMasterCv || !overview.profileComplete) && view === "inbox" && (
            <Link to={overview.hasMasterCv ? "/profile" : "/documents"} className="notice" style={{ margin: "4px 12px 8px", color: "inherit", textDecoration: "none" }}>
              <Icon name="person" />
              <span>
                <strong>{overview.hasMasterCv ? "Finish your profile" : "Add your CV"}</strong>
                <span className="muted" style={{ display: "block" }}>
                  {overview.hasMasterCv ? "Add skills and target roles for accurate match scores." : "Match scores and tailored documents are based on it."}
                </span>
              </span>
            </Link>
          )}

          {!data && loading ? (
            <div className="center-fill">
              <Spinner />
            </div>
          ) : error && !data ? (
            <ErrorState error={error} onRetry={() => void reload()} />
          ) : jobs.length === 0 ? (
            q || filtersActive ? (
              <EmptyState icon="search" title="No matches" message={q ? `Nothing matches “${q}” with these filters.` : "No internships match these filters."} />
            ) : view === "inbox" ? (
              <EmptyState
                icon="tray"
                title="You're all caught up"
                message="Sources are checked every hour. New internships that fit your focus appear here."
                action={
                  <button type="button" className="btn" onClick={() => void checkNow()} disabled={checking}>
                    {checking ? <Spinner /> : <Icon name="refresh" />}
                    Check Sources Now
                  </button>
                }
              />
            ) : (
              <EmptyState icon="tray" title={view === "tracked" ? "Nothing tracked yet" : view === "dismissed" ? "Nothing hidden" : "No internships yet"} />
            )
          ) : (
            <>
              <p className="list-count">{plural(data?.total ?? jobs.length, "internship")}</p>
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} selected={job.id === selectedId} href={`/discover/${job.id}${listSearch}`} showNew={view === "inbox"} />
              ))}
            </>
          )}
        </div>
      </section>

      <section className="split-detail" aria-label="Internship details">
        {selectedId ? (
          <JobDetailView key={selectedId} jobId={selectedId} onBack={() => navigate(`/discover${listSearch}`)} backLabel="Discover" onDismissed={afterDismiss} />
        ) : (
          <div className="center-fill" style={{ flex: 1 }}>
            <EmptyState icon="tray" title="Select an internship" message="See how it matches your profile, then track it or tailor your CV." />
          </div>
        )}
      </section>

      <AddJobSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(id) => {
          setAdding(false);
          navigate(`/jobs/${id}`);
        }}
      />
    </div>
  );
}

function JobRow({ job, selected, href, showNew }: { job: JobSummary; selected: boolean; href: string; showNew: boolean }) {
  const workplace = WORKPLACE_LABELS[job.workplace];
  const place = [job.location, workplace && !job.location.toLowerCase().includes(workplace.toLowerCase()) ? workplace : ""].filter(Boolean).join(", ");
  const closingSoon = job.deadline && daysUntil(job.deadline) >= 0 && daysUntil(job.deadline) <= 14;
  return (
    <Link to={href} className="job-row" aria-current={selected ? "true" : undefined}>
      <MatchRing score={job.matchScore} />
      <div style={{ minWidth: 0 }}>
        <div className="job-row-company truncate">{job.company}</div>
        <div className="job-row-title truncate">{job.title}</div>
        {place && <div className="job-row-meta truncate">{place}</div>}
      </div>
      <div className="job-row-aside">
        <span>{relativeTime(job.firstSeenAt)}</span>
        {job.application ? (
          <StatusLabel status={job.application.status} />
        ) : closingSoon ? (
          <span style={{ color: "var(--color-orange)" }}>{deadlineLabel(job.deadline)}</span>
        ) : (
          showNew && isNew(job.firstSeenAt) && <span className="new-dot" aria-label="New" />
        )}
      </div>
    </Link>
  );
}
