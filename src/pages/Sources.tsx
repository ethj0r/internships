import { useState, type FormEvent } from "react";
import type { Source, SourceKind } from "../../shared/types";
import { ErrorState, Field, Loading, Switch } from "../components/common";
import { RefreshCard } from "../components/Eligibility";
import { Icon, Spinner } from "../components/Icon";
import { MenuButton } from "../components/Menu";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { plural, relativeTime, SOURCE_LABELS } from "../lib/format";
import { invalidate, useAction, useDocumentTitle, useResource } from "../lib/hooks";

type AddableKind = Exclude<SourceKind, "manual">;

const PLACEHOLDERS: Record<AddableKind, string> = {
  greenhouse: "Board name or URL, e.g. xendit",
  lever: "Company name or URL, e.g. animocabrands",
  ashby: "Board name or URL, e.g. coinhako",
  smartrecruiters: "Company ID or URL, e.g. Grab",
  workable: "Account or URL, e.g. mercari",
  catapa: "Company or URL, e.g. gdplabs",
  themuse: "Category, e.g. Software Engineering",
  himalayas: "Country, e.g. Singapore",
};

const JOB_BOARDS: SourceKind[] = ["themuse", "himalayas"];

export function Sources() {
  const { data: sources, error, loading, reload } = useResource("sources", api.sources);
  const { data: runs } = useResource("runs", api.discoveryRuns);
  const toast = useToast();
  const [runningId, setRunningId] = useState<number | "all" | null>(null);
  useDocumentTitle("Sources");

  const run = async (id: number | "all") => {
    setRunningId(id);
    try {
      const result = id === "all" ? await api.runDiscovery() : await api.runSource(id);
      invalidate("sources", "runs", "jobs", "overview");
      const errors = result.errors.length ? ` ${plural(result.errors.length, "source")} failed.` : "";
      toast.show(`Checked ${plural(result.sourcesChecked, "source")}, found ${plural(result.jobsNew, "new internship")}.${errors}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setRunningId(null);
    }
  };

  const [update] = useAction(async (source: Source, patch: { enabled: boolean }) => {
    await api.updateSource(source.id, patch);
    invalidate("sources");
  }, toast.error);

  const [remove] = useAction(async (source: Source) => {
    await api.deleteSource(source.id);
    invalidate("sources");
    toast.show(`Removed ${source.name}`);
  }, toast.error);

  if (!sources) return <div className="page">{loading ? <Loading /> : error && <ErrorState error={error} onRetry={() => void reload()} />}</div>;

  const visible = sources.filter((s) => s.kind !== "manual");
  const enabled = visible.filter((s) => s.enabled).length;
  const groups: { title: string; items: Source[] }[] = [
    { title: "Company Career Boards", items: visible.filter((s) => !JOB_BOARDS.includes(s.kind)) },
    { title: "Job Boards", items: visible.filter((s) => JOB_BOARDS.includes(s.kind)) },
  ];

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="large-title">Sources</h1>
            <p className="page-subtitle">{plural(enabled, "source")}, each checked once every 3 days.</p>
          </div>
          <button type="button" className="btn" onClick={() => void run("all")} disabled={runningId !== null}>
            {runningId === "all" ? <Spinner /> : <Icon name="refresh" />}
            Check Now
          </button>
        </header>

        <RefreshCard />

        <AddSourceForm />

        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <section key={group.title} className="section">
                <div className="section-header">
                  <h2 className="section-title">{group.title}</h2>
                </div>
                <div className="group">
                  {group.items.map((source) => (
                    <div key={source.id} className="row">
                      <Switch checked={source.enabled} label={`Check ${source.name}`} onChange={(v) => void update(source, { enabled: v })} />
                      <div className="row-main">
                        <p className="row-title truncate" style={{ color: source.enabled ? undefined : "var(--color-label-secondary)" }}>
                          {source.name}
                        </p>
                        <p className="row-subtitle truncate" style={source.lastStatus === "error" ? { color: "var(--color-red)" } : undefined}>
                          {source.lastStatus === "error"
                            ? `Last check failed: ${source.lastError}`
                            : `${SOURCE_LABELS[source.kind]}, ${plural(source.jobCount, "open internship")}${source.lastRunAt ? `, checked ${relativeTime(source.lastRunAt).toLowerCase()}` : ", not checked yet"}`}
                        </p>
                      </div>
                      {runningId === source.id && <Spinner />}
                      <MenuButton
                        className="btn btn-plain btn-icon"
                        label={`${source.name} actions`}
                        align="end"
                        disabled={runningId !== null}
                        items={[
                          { key: "run", label: "Check Now", onSelect: () => void run(source.id) },
                          { key: "remove", label: "Remove Source", destructive: true, separatorBefore: true, onSelect: () => void remove(source) },
                        ]}
                      >
                        <Icon name="ellipsis" />
                      </MenuButton>
                    </div>
                  ))}
                </div>
              </section>
            ),
        )}
        <p className="section-footer" style={{ marginTop: 12 }}>
          Sources read each platform's public job feed. LinkedIn, JobStreet, Glints, Kalibrr and Indeed don't offer one and don't allow automated collection. Add
          roles from those sites with the + button in Discover.
        </p>

        {runs && runs.length > 0 && (
          <section className="section">
            <div className="section-header">
              <h2 className="section-title">Recent Checks</h2>
            </div>
            <div className="group">
              {runs.slice(0, 8).map((r) => (
                <div key={r.id} className="row">
                  <div className="row-main">
                    <p className="row-title">{r.trigger === "cron" ? "Scheduled check" : "Manual check"}</p>
                    <p className="row-subtitle">{relativeTime(r.startedAt)}</p>
                  </div>
                  <span className="row-trailing">
                    {plural(r.sourcesChecked, "source")}, {r.jobsNew} new
                    {r.errors.length > 0 && <span style={{ color: "var(--color-orange)" }}>, {r.errors.length} failed</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function AddSourceForm() {
  const [kind, setKind] = useState<AddableKind>("greenhouse");
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [add, pending] = useAction(
    async () => {
      setError(null);
      const source = await api.addSource(kind, identifier);
      invalidate("sources");
      setIdentifier("");
      toast.show(`Added ${source.name}. It'll be checked in the next run.`);
    },
    (err) => setError(err.message),
  );

  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">Add a Source</h2>
      </div>
      <form
        className="group group-padded"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (identifier.trim()) void add();
        }}
      >
        <div className="hstack wrap" style={{ alignItems: "flex-end", gap: 12 }}>
          <Field label="Platform" htmlFor="source-kind">
            <select id="source-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as AddableKind)} style={{ minWidth: 150 }}>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="smartrecruiters">SmartRecruiters</option>
              <option value="workable">Workable</option>
              <option value="catapa">CATAPA</option>
              <option value="themuse">The Muse</option>
              <option value="himalayas">Himalayas (remote)</option>
            </select>
          </Field>
          <Field label={kind === "themuse" ? "Category" : kind === "himalayas" ? "Country" : "Company board"} htmlFor="source-id" className="spacer">
            <input id="source-id" className="input" placeholder={PLACEHOLDERS[kind]} value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary" disabled={!identifier.trim() || pending}>
            {pending && <Spinner />}
            Add
          </button>
        </div>
        {error && (
          <p className="inline-error" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </form>
      <p className="section-footer">
        Find a company's board name in its careers page links, like boards.greenhouse.io/xendit, jobs.smartrecruiters.com/Grab or career.catapa.com/gdplabs. Himalayas
        lists remote internships open to the country you enter.
      </p>
    </section>
  );
}
