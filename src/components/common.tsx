import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, useState, type ReactNode } from "react";
import { STATUS_LABELS, type ApplicationStatus } from "../../shared/types";
import { scoreTier } from "../lib/format";
import { Icon, Spinner, type IconName } from "./Icon";

export function MatchRing({ score, size = "sm" }: { score: number | null; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? 72 : 36;
  const stroke = size === "lg" ? 6 : 3.5;
  const r = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, score ?? 0));
  return (
    <div className={`ring${size === "lg" ? " lg" : ""}`} data-tier={scoreTier(score)} role="img" aria-label={score == null ? "Not scored" : `${score}% match`}>
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`}>
        <circle className="ring-track" cx={dim / 2} cy={dim / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="ring-value"
          cx={dim / 2}
          cy={dim / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <span className="ring-label" aria-hidden="true">
        {score ?? "–"}
      </span>
    </div>
  );
}

export function StatusLabel({ status }: { status: ApplicationStatus }) {
  return (
    <span className="status" data-status={status}>
      <span className="status-dot" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <p className="empty-title">{title}</p>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="center-fill">
      <Spinner label={label} />
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="warning"
      title="Couldn't load this"
      message={error.message}
      action={
        onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        )
      }
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function Markdown({ source, className = "prose" }: { source: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }) as string), [source]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function TokenInput({ value, onChange, placeholder, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const next = [...value];
    for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    onChange(next);
    setDraft("");
  };
  return (
    <div className="token-input" onClick={(e) => e.currentTarget.querySelector("input")?.focus()}>
      {value.map((v) => (
        <span className="tag" key={v}>
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
            <Icon name="xmark" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (draft.trim()) add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}

export function Field({ label, hint, children, className, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field${className ? ` ${className}` : ""}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Warnings({ warnings, title }: { warnings: string[]; title: string }) {
  if (!warnings.length) return null;
  return (
    <div className="notice notice-warning" role="note">
      <Icon name="warning" />
      <div>
        <strong>{title}</strong>
        <ul>
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
