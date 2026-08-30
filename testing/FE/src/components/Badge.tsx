import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import type { CategoryType } from "../api/types";

/** Category chip. Color is never the only signal: icon + text always present. */
export function CategoryChip({ name, type }: { name: string; type?: CategoryType }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      {type === "income" && <ArrowUpRight className="size-3 text-emerald-600" aria-hidden="true" />}
      {type === "expense" && <ArrowDownRight className="size-3 text-rose-600" aria-hidden="true" />}
      {name}
    </span>
  );
}

export function TypeBadge({ type }: { type: CategoryType }) {
  const income = type === "income";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        income ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
      }`}
    >
      {income ? (
        <ArrowUpRight className="size-3" aria-hidden="true" />
      ) : (
        <ArrowDownRight className="size-3" aria-hidden="true" />
      )}
      {type}
    </span>
  );
}
