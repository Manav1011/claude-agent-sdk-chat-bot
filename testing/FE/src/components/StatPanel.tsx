import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** One bordered panel holding the 4 stat tiles (not a card-per-tile). */
export function StatPanel({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 lg:grid-cols-4">
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600"
      : tone === "negative"
        ? "text-rose-600"
        : "text-slate-700";
  return (
    <div className="bg-white p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <p className={`mt-1 text-lg font-bold tabular-nums lg:text-xl ${toneClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
