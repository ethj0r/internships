import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  tone?: "error";
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<(toast: Omit<ToastItem, "id">) => void>(() => {});
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      const id = nextId++;
      setItems((list) => [...list.slice(-2), { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.action ? 6000 : toast.tone === "error" ? 5000 : 3000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.tone === "error" ? " error" : ""}`} role={t.tone === "error" ? "alert" : "status"}>
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return useMemo(
    () => ({
      show: (message: string, action?: ToastItem["action"]) => push({ message, action }),
      error: (err: unknown) => push({ message: err instanceof Error ? err.message : String(err), tone: "error" }),
    }),
    [push],
  );
}
