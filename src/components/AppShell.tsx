import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useNavigate } from "react-router";
import type { Notification } from "../../shared/types";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { invalidate, useResource } from "../lib/hooks";
import { AppMark, Icon, Spinner, type IconName } from "./Icon";

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: "/discover", label: "Discover", icon: "tray" },
  { to: "/pipeline", label: "Pipeline", icon: "stack" },
  { to: "/documents", label: "Documents", icon: "doc" },
  { to: "/activity", label: "Activity", icon: "clock" },
  { to: "/profile", label: "Profile", icon: "person" },
  { to: "/knowledge", label: "Knowledge", icon: "book" },
  { to: "/sources", label: "Sources", icon: "antenna" },
];

export function AppShell({ onSignOut }: { onSignOut: () => void }) {
  const { data: overview } = useResource("overview", api.overview);
  const counts = overview?.counts;
  const badge = (to: string) => {
    if (!counts) return null;
    if (to === "/discover") return counts.discovered || null;
    if (to === "/pipeline") return counts.interested + counts.preparing + counts.ready + counts.applied + counts.interview || null;
    return null;
  };

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <AppMark className="brand-mark" />
          Sietch
        </div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className="nav-item">
            <Icon name={item.icon} />
            {item.label}
            {badge(item.to) != null && <span className="nav-count">{badge(item.to)}</span>}
          </NavLink>
        ))}
        <div className="sidebar-footer">
          <NotificationsButton unread={overview?.unreadNotifications ?? 0} variant="nav" />
          <button type="button" className="nav-item" onClick={onSignOut}>
            <Icon name="signout" />
            Sign Out
          </button>
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main">
        {NAV.slice(0, 5).map((item) => (
          <NavLink key={item.to} to={item.to} className="tab">
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function NotificationsButton({ unread, variant }: { unread: number; variant: "nav" | "icon" }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data, loading, reload } = useResource<Notification[]>(open ? "notifications" : null, api.notifications);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current!.getBoundingClientRect();
    setStyle(
      variant === "nav"
        ? { left: rect.right + 8, bottom: Math.max(8, window.innerHeight - rect.bottom) }
        : { top: rect.bottom + 6, left: Math.max(8, rect.right - 360) },
    );
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, variant]);

  const markRead = async (ids?: number[]) => {
    await api.markNotificationsRead(ids).catch(() => undefined);
    invalidate("overview");
    void reload();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={variant === "nav" ? "nav-item" : "btn btn-icon btn-plain"}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" />
        {variant === "nav" && "Notifications"}
        {variant === "nav" && unread > 0 && <span className="nav-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open &&
        createPortal(
          <div ref={panelRef} className="popover" style={style} role="dialog" aria-label="Notifications">
            <div className="bar" style={{ background: "transparent", backdropFilter: "none" }}>
              <span className="bar-title">Notifications</span>
              <span className="spacer" />
              {data?.some((n) => !n.readAt) && (
                <button type="button" className="btn btn-plain btn-sm" onClick={() => void markRead()}>
                  Mark All as Read
                </button>
              )}
            </div>
            {!data && loading ? (
              <div className="center-fill" style={{ minHeight: 120 }}>
                <Spinner />
              </div>
            ) : !data?.length ? (
              <p className="muted" style={{ padding: "32px 16px", textAlign: "center" }}>
                You're all caught up. New matches and upcoming deadlines appear here.
              </p>
            ) : (
              data.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="notification"
                  data-read={Boolean(n.readAt)}
                  onClick={() => {
                    if (!n.readAt) void markRead([n.id]);
                    setOpen(false);
                    navigate(n.jobId ? `/jobs/${n.jobId}` : "/sources");
                  }}
                >
                  <span className="new-dot" />
                  <span>
                    <span className="headline" style={{ display: "block" }}>
                      {n.title}
                    </span>
                    <span className="subhead muted" style={{ display: "block" }}>
                      {n.body}
                    </span>
                    <span className="caption muted">{relativeTime(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
