import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { invalidate } from "../lib/hooks";
import { Field, Segmented } from "./common";
import { Icon, Spinner } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

const EMPTY = { company: "", title: "", location: "", url: "", deadline: "", description: "" };

/** Adds a posting found elsewhere, by link or by hand. */
export function AddJobSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (jobId: number) => void }) {
  const [mode, setMode] = useState<"link" | "details">("link");
  const [url, setUrl] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) {
      setMode("link");
      setUrl("");
      setForm(EMPTY);
      setError(null);
    }
  }, [open]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result =
        mode === "link"
          ? await api.importJobUrl(url)
          : await api.importJobManual({ ...form, deadline: form.deadline || null, url: form.url || undefined });
      invalidate("jobs", "overview");
      toast.show(result.created ? "Internship added" : "You already have this internship");
      onAdded(result.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (mode === "link" && err instanceof ApiError && err.status === 422) {
        // The page couldn't be read; continue by hand with the link kept.
        setMode("details");
        setForm((f) => ({ ...f, url }));
      }
      setError(message);
    } finally {
      setPending(false);
    }
  };

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const canSubmit = mode === "link" ? /^https?:\/\/\S+/i.test(url.trim()) : Boolean(form.company.trim() && form.title.trim());

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Add an internship"
      message="For roles you found on LinkedIn, Handshake, a company site or anywhere else."
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!canSubmit || pending} onClick={() => void submit()}>
            {pending && <Spinner />}
            Add Internship
          </button>
        </>
      }
    >
      <Segmented
        label="Add by"
        value={mode}
        onChange={setMode}
        options={[
          { value: "link", label: "From a Link" },
          { value: "details", label: "Enter Details" },
        ]}
      />
      {error && (
        <div className="notice notice-warning" role="alert">
          <Icon name="warning" />
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={(e) => void submit(e)}>
        {mode === "link" ? (
          <Field label="Posting URL" htmlFor="job-url" hint="Works with Greenhouse, Lever and Ashby links, and most company career pages.">
            <input id="job-url" className="input" type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} data-autofocus />
          </Field>
        ) : (
          <div className="fields">
            <Field label="Company" htmlFor="job-company">
              <input id="job-company" className="input" value={form.company} onChange={set("company")} data-autofocus />
            </Field>
            <Field label="Position" htmlFor="job-title">
              <input id="job-title" className="input" value={form.title} onChange={set("title")} />
            </Field>
            <Field label="Location" htmlFor="job-location">
              <input id="job-location" className="input" placeholder="City, or Remote" value={form.location} onChange={set("location")} />
            </Field>
            <Field label="Deadline" htmlFor="job-deadline">
              <input id="job-deadline" className="input" type="date" value={form.deadline} onChange={set("deadline")} />
            </Field>
            <Field label="Posting URL" htmlFor="job-link" className="full">
              <input id="job-link" className="input" type="url" placeholder="https://" value={form.url} onChange={set("url")} />
            </Field>
            <Field label="Description" htmlFor="job-description" className="full" hint="Paste the full posting. Matching and tailoring use it.">
              <textarea id="job-description" className="textarea" rows={7} value={form.description} onChange={set("description")} />
            </Field>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
