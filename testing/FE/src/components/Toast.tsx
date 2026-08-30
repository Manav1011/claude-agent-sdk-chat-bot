import { CheckCircle2, X, XCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  kind: "success" | "error";
  message: string;
  action?: ToastAction;
}

interface ToastApi {
  success: (message: string, action?: ToastAction) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  // Clear pending timers if the provider unmounts.
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  const push = useCallback(
    (kind: "success" | "error", message: string, action?: ToastAction) => {
      const id = nextId++;
      setToasts((prev) => [...prev.slice(-4), { id, kind, message, action }]);
      timers.current.set(id, setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4500));
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, action) => push("success", message, action),
      error: (message) => push("error", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed right-4 bottom-20 z-60 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 sm:bottom-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-white p-3 shadow-lg ${
              t.kind === "success" ? "border-emerald-200" : "border-red-200"
            }`}
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1 text-sm text-slate-700">{t.message}</p>
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 rounded px-2 py-0.5 text-sm font-semibold text-brand-600 hover:bg-brand-50"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
