import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  checked?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled])';

/** A pop-up button: the macOS pattern for picking one of several states. */
export function MenuButton({
  items,
  children,
  className = "btn",
  align = "start",
  label,
  disabled,
}: {
  items: MenuItem[];
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = align === "end" ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
    setPosition({ top, left });
    menu.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();

    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menu.contains(target) && !button.contains(target)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        button.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, align]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const nodes = [...(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (index + 1) % nodes.length : (index - 1 + nodes.length) % nodes.length;
    nodes[next]?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => {
          setPosition(null);
          setOpen((o) => !o);
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            style={position ?? { top: -9999, left: -9999 }}
            onKeyDown={onMenuKey}
          >
            {items.map((item) => (
              <Fragment key={item.key}>
                {item.separatorBefore && <div className="menu-separator" role="separator" />}
                <button
                  type="button"
                  role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
                  aria-checked={item.checked}
                  className={`menu-item${item.destructive ? " destructive" : ""}`}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.checked !== undefined && <Icon name="check" className="menu-check" />}
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
