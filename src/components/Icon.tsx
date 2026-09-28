import type { ReactNode, SVGProps } from "react";

// A small SF Symbols–style line icon set (24pt grid, 1.6 stroke).
const PATHS: Record<string, ReactNode> = {
  tray: (
    <>
      <path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5" />
      <path d="M4 13.5 6.2 5.6A2 2 0 0 1 8.1 4h7.8a2 2 0 0 1 1.9 1.6L20 13.5h-4.4a1 1 0 0 0-.9.6l-.5 1.2a1 1 0 0 1-.9.6h-2.6a1 1 0 0 1-.9-.6l-.5-1.2a1 1 0 0 0-.9-.6Z" />
    </>
  ),
  stack: (
    <>
      <rect x="4" y="4" width="16" height="6.5" rx="2" />
      <rect x="4" y="13.5" width="16" height="6.5" rx="2" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c.9-3.7 3.9-5.5 7.5-5.5s6.6 1.8 7.5 5.5" />
    </>
  ),
  antenna: (
    <>
      <circle cx="12" cy="12" r="1.8" />
      <path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.7 5.7a8.9 8.9 0 0 0 0 12.6M18.3 5.7a8.9 8.9 0 0 1 0 12.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15Z" />
      <path d="M10 20.5a2.1 2.1 0 0 0 4 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  "chevron-left": <path d="m14.5 5-7 7 7 7" />,
  "chevron-right": <path d="m9.5 5 7 7-7 7" />,
  "chevron-down": <path d="m6 9.5 6 6 6-6" />,
  "chevron-updown": <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  filter: <path d="M4 7h16M7 12h10M10 17h4" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  xmark: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  bookmark: <path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-4-6 4V4.5a1 1 0 0 1 1-1Z" />,
  "eye-slash": (
    <>
      <path d="M3.5 3.5l17 17" />
      <path d="M10.4 5.1A9.7 9.7 0 0 1 12 5c5 0 8.6 4.6 9.6 7-.5 1.1-1.5 2.6-2.9 3.9M6.7 6.7C4.6 8 3 10.3 2.4 12c1 2.4 4.6 7 9.6 7 1.6 0 3.1-.5 4.4-1.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 11.5a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4v5h-5" />
    </>
  ),
  trash: <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 12.1A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.9L17.5 7M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />,
  upload: (
    <>
      <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
      <path d="M5 12.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5" />
    </>
  ),
  printer: (
    <>
      <path d="M7 9V3.5h10V9" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  compose: (
    <>
      <path d="M11 4.5H6.5a2 2 0 0 0-2 2V17.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
      <path d="M17.8 3.7a1.9 1.9 0 0 1 2.7 2.7l-8 8-3.5.8.8-3.5Z" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1-1" />
    </>
  ),
  ellipsis: (
    <>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  signout: <path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 16.5 5.5 12 10 7.5M5.5 12H16" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15.5" rx="2.5" />
      <path d="M4 10h16M8.5 3v4M15.5 3v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  paperplane: <path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4Z" />,
  checklist: <path d="M4 6.5 5.5 8 8 5M4 12.5 5.5 14 8 11M4 18.5 5.5 20 8 17M11.5 6.5H20M11.5 12.5H20M11.5 18.5H20" />,
  book: <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14.5H7.5A2.5 2.5 0 0 0 5 20M5 5.5V20M5 20a1 1 0 0 0 1 1h13v-3.5M9 7.5h6" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <svg className="spinner" viewBox="0 0 24 24" role="status" aria-label={label}>
      {Array.from({ length: 8 }, (_, i) => (
        <line
          key={i}
          x1="12"
          y1="3"
          x2="12"
          y2="7"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity={0.2 + (i / 8) * 0.8}
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}

export function AppMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 72 72" aria-hidden="true">
      <rect width="72" height="72" rx="16" fill="#0071e3" />
      <path
        d="M22 30a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4Z M30 26v-2.5a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3V26 M22 36h28"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
