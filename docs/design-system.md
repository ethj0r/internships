# Design system

The interface follows Apple's Human Interface Guidelines: clarity, deference to content, and depth used only to
show hierarchy. No Apple-specific design skill was available in the build environment, so the system is built
directly from the published HIG conventions for macOS and iOS productivity apps (Mail, Reminders, Settings).

Tokens live in [`src/styles/tokens.css`](../src/styles/tokens.css); components in [`src/styles/app.css`](../src/styles/app.css).

## Principles

- **Content first.** Job details, match reasons and your documents carry the screen. Chrome recedes.
- **One memorable element.** The match ring, a thin Activity-style ring, is the only strong visual motif.
- **Deliberate actions.** Important changes use native-feeling patterns instead of more buttons: a pop-up button for status, a confirmation sheet before Applied, an explicit Approve for documents.
- **Restraint.** One accent color. Status colors appear only as small dots. Materials (translucency) only on navigation chrome.

## Typography

System font stack (`-apple-system`, SF Pro), negative tracking at larger sizes.

| Style | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Large title | 30 / 34 | Semibold | Page titles |
| Title 1 | 24 / 29 | Semibold | Job and document titles |
| Title 2 | 20 / 25 | Semibold | Section titles, sheet titles |
| Headline | 15 / 20 | Semibold | Row titles, labels with emphasis |
| Body | 15 / 22 | Regular | Default text, descriptions |
| Callout | 14 / 20 | Regular | Controls, secondary rows |
| Subhead | 13 / 18 | Regular | Row subtitles, metadata |
| Caption | 12 / 16 | Regular | Timestamps, footnotes |

Sentence case everywhere except button labels, which use title case like macOS. No all-caps labels.

## Color

Semantic tokens with light and dark values (automatic via `prefers-color-scheme`).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-bg` | `#f5f5f7` | `#161617` | Window background |
| `--color-surface` | `#ffffff` | `#1d1d1f` | Grouped content, lists |
| `--color-label` | `#1d1d1f` | `#f5f5f7` | Primary text |
| `--color-label-secondary` | `#6e6e73` | `#a1a1a6` | Secondary text (4.5:1+) |
| `--color-accent` | `#0071e3` | `#2997ff` | Links, primary buttons, selection |
| `--color-separator` | 13% gray | 55% gray | Hairlines |

Status dots: Interested blue, Preparing orange, Ready yellow, Applied teal, Interview indigo, Offer green, Rejected gray.
Match ring: 75+ green, 50–74 orange, under 50 gray.

## Spacing, radius, depth

- 4pt grid: 4, 8, 12, 16, 20, 24, 32, 44, 64.
- Radius by hierarchy: controls 8, grouped content 12, floating surfaces (sheets, popovers) 16, capsules for tags and toasts.
- Shadows: hairline for grouped content, soft for menus and popovers, deep for sheets. Nothing else casts a shadow.

## Components

| Component | Pattern |
| --- | --- |
| Navigation | Translucent sidebar on desktop; tab bar on mobile (≤760px). |
| Split view | Discover uses a Mail-style list and detail; on mobile the detail pushes over the list. |
| Buttons | Gray fill (default), accent fill (primary, one per view), plain (text), icon-only with tooltip. Pressed state scales to 97%. |
| Inputs | Hairline border, accent focus ring. Token inputs for skills, locations and keywords. Segmented controls for small exclusive choices. Switches for on/off. |
| Grouped lists | Settings-style inset rows with hairline separators, used for sources, documents, pipeline, checklist. |
| Menus | Pop-up buttons with checkmarks and keyboard navigation; translucent material. |
| Sheets | Centered on desktop, bottom sheet on mobile. Focus-trapped, Escape to dismiss. Used for confirmations and short forms. |
| Status | Colored dot + label. |
| Notices | Tinted, rounded, with an icon: neutral, warning (fabrication checks), error. |
| Loading | 8-spoke activity indicator; indeterminate progress bar for AI generation with a plain explanation of what's happening. |
| Empty states | Line icon, title, one sentence on what to do, and the action. |
| Errors | Say what went wrong and how to fix it. Toast for failed actions; inline for form fields; full state with Try Again for failed loads. |
| Toasts | Inverse capsule at the bottom, with Undo where reversible. |

## Motion

Only in response to actions: menus and sheets appear, checkmarks pop, switches slide, the match ring fills.
Durations 120–360ms with standard easing. Everything is disabled under `prefers-reduced-motion`.

## Accessibility

Visible focus rings, labelled icon buttons, ARIA roles on menus, switches, checklists and dialogs, 4.5:1 text contrast,
full keyboard support (arrow keys in the job list and menus, ⌘S in the document editor).
