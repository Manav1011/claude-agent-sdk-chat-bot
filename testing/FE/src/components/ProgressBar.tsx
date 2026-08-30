/** Budget usage bar. Tiers: green <80%, amber 80-100%, red >100% (+ label). */
export function ProgressBar({ percentUsed }: { percentUsed: number }) {
  const over = percentUsed > 100;
  const warn = percentUsed >= 80 && percentUsed <= 100;
  const barColor = over ? "bg-red-500" : warn ? "bg-amber-500" : "bg-emerald-500";
  const width = Math.min(100, Math.max(0, percentUsed));

  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuenow={Math.round(percentUsed)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Budget used: ${Math.round(percentUsed)} percent`}
        className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-slate-200"
      >
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${width}%` }} />
      </div>
      <span
        className={`w-24 shrink-0 text-right text-xs font-medium tabular-nums ${
          over ? "text-red-600" : warn ? "text-amber-600" : "text-slate-500"
        }`}
      >
        {over ? `Over by ${Math.round(percentUsed - 100)}%` : `${Math.round(percentUsed)}% used`}
      </span>
    </div>
  );
}
