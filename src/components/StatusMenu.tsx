import { useState } from "react";
import { APPLICATION_STATUSES, STATUS_LABELS, type Application, type ApplicationStatus } from "../../shared/types";
import { api } from "../lib/api";
import { invalidate, useAction } from "../lib/hooks";
import { Icon } from "./Icon";
import { MenuButton, type MenuItem } from "./Menu";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

export const SUBMITTED_STATUSES: ApplicationStatus[] = ["applied", "interview", "offer", "rejected"];

export function invalidateTracking(jobId?: number) {
  invalidate("jobs", "applications", "overview", "events", ...(jobId ? [`job:${jobId}`, `kit:`] : []));
}

/** Pop-up button for moving an application through the pipeline. Moving to Applied asks for confirmation. */
export function StatusMenu({
  application,
  company,
  onChanged,
  onUntrack,
  size,
}: {
  application: Pick<Application, "id" | "status">;
  company: string;
  onChanged?: (app: Application) => void;
  onUntrack?: () => void;
  size?: "sm";
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const [update, pending] = useAction(async (status: ApplicationStatus, extra: { confirmSubmitted?: boolean; appliedAt?: string } = {}) => {
    const app = await api.updateApplication(application.id, { status, ...extra });
    invalidateTracking(app.jobId);
    onChanged?.(app);
    toast.show(`Moved to ${STATUS_LABELS[status]}`);
    return app;
  }, toast.error);

  const items: MenuItem[] = APPLICATION_STATUSES.filter((s) => s !== "discovered").map((s) => ({
    key: s,
    label: STATUS_LABELS[s],
    icon: <span className="status-dot" data-status={s} />,
    checked: s === application.status,
    separatorBefore: s === "applied",
    onSelect: () => {
      if (s === application.status) return;
      if (s === "applied" && !SUBMITTED_STATUSES.includes(application.status)) setConfirming(true);
      else void update(s);
    },
  }));
  if (onUntrack) items.push({ key: "untrack", label: "Stop Tracking", destructive: true, separatorBefore: true, onSelect: onUntrack });

  return (
    <>
      <MenuButton items={items} className={`btn${size === "sm" ? " btn-sm" : ""}`} label={`Status: ${STATUS_LABELS[application.status]}`} disabled={pending}>
        <span className="status-dot" data-status={application.status} />
        {STATUS_LABELS[application.status]}
        <Icon name="chevron-updown" width={13} height={13} />
      </MenuButton>
      <ConfirmAppliedSheet
        open={confirming}
        company={company}
        pending={pending}
        onClose={() => setConfirming(false)}
        onConfirm={async (appliedAt) => {
          const app = await update("applied", { confirmSubmitted: true, appliedAt });
          if (app) setConfirming(false);
        }}
      />
    </>
  );
}

export function ConfirmAppliedSheet({
  open,
  company,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  company: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (appliedAt: string) => void;
}) {
  const today = new Date().toLocaleDateString("en-CA");
  const [date, setDate] = useState(today);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Did you submit your application?"
      message={`Confirm once you've submitted it on ${company}'s site. Nothing is sent from this app.`}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Not Yet
          </button>
          <button type="button" className="btn btn-primary" disabled={pending || !date} onClick={() => onConfirm(date)} data-autofocus>
            Mark as Applied
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="applied-date">
          Date submitted
        </label>
        <input id="applied-date" className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </div>
    </Sheet>
  );
}
