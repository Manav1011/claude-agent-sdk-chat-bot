import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const shownStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const shownEnd = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3"
    >
      <p className="text-sm text-slate-500">
        Showing <span className="font-medium text-slate-700">{shownStart}</span>–
        <span className="font-medium text-slate-700">{shownEnd}</span> of{" "}
        <span className="font-medium text-slate-700">{total}</span>
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="size-4" aria-hidden="true" /> Prev
        </button>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
        >
          Next <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
