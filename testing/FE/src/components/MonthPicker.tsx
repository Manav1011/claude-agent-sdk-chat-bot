import { ChevronLeft, ChevronRight } from "lucide-react";

import { monthLabel } from "../lib/format";

export function MonthPicker({
  year,
  month,
  onChange,
}: {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}) {
  const shift = (delta: number) => {
    const index = year * 12 + (month - 1) + delta;
    onChange(Math.floor(index / 12), (index % 12) + 1);
  };

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Select month">
      <button
        onClick={() => shift(-1)}
        aria-label="Previous month"
        className="rounded-md border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      <span aria-live="polite" className="min-w-36 px-2 text-center text-sm font-semibold">
        {monthLabel(year, month)}
      </span>
      <button
        onClick={() => shift(1)}
        aria-label="Next month"
        className="rounded-md border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
