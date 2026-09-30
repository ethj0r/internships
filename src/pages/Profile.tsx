import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { documentText } from "../../shared/cv";
import { ROLES } from "../../shared/roles";
import { extractSkills, sameSkill } from "../../shared/skills";
import type { Profile, RemotePreference } from "../../shared/types";
import { ErrorState, Field, Loading, Segmented, TokenInput } from "../components/common";
import { Icon, Spinner } from "../components/Icon";
import { useToast } from "../components/Toast";
import { api, type ProfileInput } from "../lib/api";
import { invalidate, useAction, useDocumentTitle, useResource } from "../lib/hooks";

export function ProfilePage() {
  const { data: profile, error, loading, reload, mutate } = useResource("profile", api.profile);
  useDocumentTitle("Profile");
  if (!profile) return <div className="page">{loading ? <Loading /> : error && <ErrorState error={error} onRetry={() => void reload()} />}</div>;
  return <ProfileForm key={profile.updatedAt} profile={profile} onSaved={mutate} />;
}

function toInput(p: Profile): ProfileInput {
  const { updatedAt: _ignored, ...rest } = p;
  return rest;
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [form, setForm] = useState<ProfileInput>(() => toInput(profile));
  const toast = useToast();
  const { data: cvSkills } = useResource("profile:cv-skills", async () => {
    const masters = await api.documents({ kind: "master_cv" });
    const active = masters.find((d) => d.isActive) ?? masters[0];
    return active ? extractSkills(documentText((await api.document(active.id)).content)) : [];
  });

  const initial = useMemo(() => JSON.stringify(toInput(profile)), [profile]);
  const dirty = JSON.stringify(form) !== initial;
  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const suggestions = (cvSkills ?? []).filter((s) => !form.skills.some((x) => sameSkill(x, s)));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const [save, saving] = useAction(async () => {
    const saved = await api.saveProfile({ ...form, links: form.links.filter((l) => l.url.trim()) });
    onSaved(saved);
    toast.show("Profile saved. Match scores are updating.");
    setTimeout(() => invalidate("jobs", "job:", "overview"), 2500);
  }, toast.error);

  const saveButton = (
    <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
      {saving && <Spinner />}
      Save Changes
    </button>
  );

  return (
    <div className="page">
      <form
        className="page-inner"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <header className="page-header">
          <div>
            <h1 className="large-title">Profile</h1>
            <p className="page-subtitle">Used to score matches and to write your documents.</p>
          </div>
          {saveButton}
        </header>

        <section className="section">
          <div className="section-header">
            <h2 className="section-title">About You</h2>
          </div>
          <div className="group group-padded">
            <div className="fields">
              <Field label="Full name" htmlFor="p-name">
                <input id="p-name" className="input" autoComplete="name" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="p-email">
                <input id="p-email" className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Phone" htmlFor="p-phone">
                <input id="p-phone" className="input" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Location" htmlFor="p-location">
                <input id="p-location" className="input" placeholder="City, Country" value={form.location} onChange={(e) => set("location", e.target.value)} />
              </Field>
              <Field label="Headline" htmlFor="p-headline" className="full" hint="One line, e.g. Computer Science student focused on backend systems">
                <input id="p-headline" className="input" value={form.headline} onChange={(e) => set("headline", e.target.value)} />
              </Field>
              <div className="field full">
                <span className="field-label">Links</span>
                {form.links.map((link, i) => (
                  <div key={i} className="hstack">
                    <input
                      className="input"
                      style={{ maxWidth: 140 }}
                      aria-label="Link label"
                      placeholder="GitHub"
                      value={link.label}
                      onChange={(e) => set("links", form.links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))}
                    />
                    <input
                      className="input"
                      type="url"
                      aria-label="Link URL"
                      placeholder="https://"
                      value={link.url}
                      onChange={(e) => set("links", form.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))}
                    />
                    <button type="button" className="btn btn-plain btn-icon" aria-label="Remove link" onClick={() => set("links", form.links.filter((_, j) => j !== i))}>
                      <Icon name="xmark" />
                    </button>
                  </div>
                ))}
                {form.links.length < 6 && (
                  <button type="button" className="btn btn-plain btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => set("links", [...form.links, { label: "", url: "" }])}>
                    <Icon name="plus" />
                    Add Link
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Education & Eligibility</h2>
          </div>
          <div className="group group-padded">
            <div className="fields">
              <Field label="Education" htmlFor="p-education" className="full" hint="Degree, school and relevant coursework">
                <textarea id="p-education" className="textarea" rows={3} style={{ minHeight: 80 }} value={form.education} onChange={(e) => set("education", e.target.value)} />
              </Field>
              <Field label="Expected graduation" htmlFor="p-grad">
                <input id="p-grad" className="input" type="month" value={form.graduationDate ?? ""} onChange={(e) => set("graduationDate", e.target.value || null)} />
              </Field>
              <Field label="Work authorization" htmlFor="p-auth" hint="e.g. Indonesian citizen. Used for eligibility concerns, never printed on a CV.">
                <input id="p-auth" className="input" value={form.workAuthorization} onChange={(e) => set("workAuthorization", e.target.value)} />
              </Field>
              <Field
                label="Singapore work pass (confirmed only)"
                htmlFor="p-sg-auth"
                hint="Leave empty until a pass is actually approved. When set, Singapore CVs show it in the header and cover letters may mention it; when empty, neither does."
              >
                <input
                  id="p-sg-auth"
                  className="input"
                  placeholder="e.g. Training Employment Pass approved for May–Aug 2027"
                  value={form.sgWorkAuthorization}
                  onChange={(e) => set("sgWorkAuthorization", e.target.value)}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Skills</h2>
          </div>
          <div className="group group-padded" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <TokenInput id="p-skills" value={form.skills} onChange={(v) => set("skills", v)} placeholder="Python, React, SQL…" />
            {suggestions.length > 0 && (
              <div className="hstack wrap" style={{ gap: 6 }}>
                <span className="subhead muted">Found in your CV:</span>
                {suggestions.slice(0, 16).map((s) => (
                  <button key={s} type="button" className="tag" style={{ border: 0, cursor: "pointer" }} onClick={() => set("skills", [...form.skills, s])}>
                    <Icon name="plus" width={11} height={11} />
                    {s}
                  </button>
                ))}
                <button type="button" className="btn btn-plain btn-sm" onClick={() => set("skills", [...form.skills, ...suggestions])}>
                  Add All
                </button>
              </div>
            )}
          </div>
          <p className="section-footer">Skills in your master CV count toward matching even if you don't list them here. Only list skills you can back up.</p>
        </section>

        <section className="section">
          <div className="section-header">
            <h2 className="section-title">What You're Looking For</h2>
          </div>
          <div className="group group-padded" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="field">
              <span className="field-label">Target roles</span>
              <div className="tags" role="group" aria-label="Target roles">
                {ROLES.map((role) => {
                  const on = form.targetRoles.includes(role.key);
                  return (
                    <button
                      key={role.key}
                      type="button"
                      className={`tag${on ? " tag-match" : ""}`}
                      style={{ border: 0, cursor: "pointer", height: 30, padding: "0 12px" }}
                      aria-pressed={on}
                      onClick={() => set("targetRoles", on ? form.targetRoles.filter((r) => r !== role.key) : [...form.targetRoles, role.key])}
                    >
                      {on && <Icon name="check" width={12} height={12} />}
                      {role.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Workplace</span>
              <Segmented<RemotePreference>
                label="Workplace preference"
                value={form.remotePreference}
                onChange={(v) => set("remotePreference", v)}
                options={[
                  { value: "any", label: "Any" },
                  { value: "remote", label: "Remote" },
                  { value: "hybrid", label: "Hybrid" },
                  { value: "onsite", label: "On-site" },
                ]}
              />
            </div>
            <Field label="Preferred locations" htmlFor="p-locations" hint="Cities or countries as they appear in postings, e.g. Jakarta, Bandung, Singapore">
              <TokenInput id="p-locations" value={form.preferredLocations} onChange={(v) => set("preferredLocations", v)} placeholder="Add a location" />
            </Field>
            <div className="fields">
              <Field label="Boost keywords" htmlFor="p-include" hint="Raise matches that mention these">
                <TokenInput id="p-include" value={form.keywordsInclude} onChange={(v) => set("keywordsInclude", v)} placeholder="e.g. distributed systems" />
              </Field>
              <Field label="Exclude keywords" htmlFor="p-exclude" hint="Push matches that mention these to the bottom">
                <TokenInput id="p-exclude" value={form.keywordsExclude} onChange={(v) => set("keywordsExclude", v)} placeholder="e.g. PhD" />
              </Field>
            </div>
            <Field label={`Notify me about matches of ${form.notifyMinScore}% or higher`} htmlFor="p-threshold">
              <input
                id="p-threshold"
                className="range"
                type="range"
                min={40}
                max={95}
                step={5}
                value={form.notifyMinScore}
                onChange={(e) => set("notifyMinScore", Number(e.target.value))}
              />
            </Field>
          </div>
        </section>

        <div className="hstack" style={{ justifyContent: "flex-end", marginTop: 32 }}>
          {saveButton}
        </div>

        <section className="section show-mobile">
          <div className="group">
            <Link to="/sources" className="row inset-icon">
              <span className="row-icon">
                <Icon name="antenna" />
              </span>
              <span className="row-main row-title">Sources</span>
              <Icon name="chevron-right" className="row-chevron" />
            </Link>
            <button
              type="button"
              className="row inset-icon"
              onClick={() => void api.logout().finally(() => window.location.assign("/"))}
            >
              <span className="row-icon">
                <Icon name="signout" />
              </span>
              <span className="row-main row-title">Sign Out</span>
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}
