import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Filter,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createTransaction,
  deleteTransaction,
  listCategories,
  listTransactions,
  updateTransaction,
} from "../api/endpoints";
import { apiErrorMessage } from "../api/client";
import type { Transaction, TransactionCreate, TransactionListParams } from "../api/types";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { MoneyText } from "../components/MoneyText";
import { Pagination } from "../components/Pagination";
import { PageHeader } from "../components/PageHeader";
import { Sheet } from "../components/Sheet";
import { Skeleton } from "../components/Skeleton";
import { TransactionForm } from "../components/forms/TransactionForm";
import { CategoryChip } from "../components/Badge";
import { formatDate } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";
import { useToast } from "../components/Toast";

const PAGE_SIZE = 20;

interface Filters {
  q: string;
  type: "" | "income" | "expense";
  categoryId: string;
  dateFrom: string;
  dateTo: string;
}

const emptyFilters: Filters = { q: "", type: "", categoryId: "", dateFrom: "", dateTo: "" };

export default function Transactions() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<"date" | "amount">("date");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(searchParams.get("new") === "1");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Debounced search -> q param, and reset paging on any filter change.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => clearTimeout(t);
  }, [filters.q]);
  useEffect(() => setPage(1), [debouncedQ, filters.type, filters.categoryId, filters.dateFrom, filters.dateTo]);

  // Consume ?new=1 from the dashboard first-run CTA.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setSheetOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const params = useMemo<TransactionListParams>(() => {
    const p: TransactionListParams = { sort, order, page, page_size: PAGE_SIZE };
    if (debouncedQ) p.q = debouncedQ;
    if (filters.type) p.type = filters.type;
    if (filters.categoryId) p.category_id = Number(filters.categoryId);
    if (filters.dateFrom) p.date_from = filters.dateFrom;
    if (filters.dateTo) p.date_to = filters.dateTo;
    return p;
  }, [debouncedQ, filters.type, filters.categoryId, filters.dateFrom, filters.dateTo, sort, order, page]);

  const listQ = useQuery({
    queryKey: queryKeys.transactions.list(params),
    queryFn: () => listTransactions(params),
  });
  const categoriesQ = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: listCategories,
  });

  const filtersActive =
    filters.q !== "" || filters.type !== "" || filters.categoryId !== "" || filters.dateFrom !== "" || filters.dateTo !== "";

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: { id?: number; body: TransactionCreate }) =>
      payload.id ? updateTransaction(payload.id, payload.body) : createTransaction(payload.body),
    onSuccess: (_tx, variables) => {
      if (variables.id) {
        toast.success("Transaction updated.");
      } else {
        toast.success("Transaction added.");
      }
      setSheetOpen(false);
      setEditing(null);
      invalidateData();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTransaction(id),
    onSuccess: (_data, id) => {
      const removed = listQ.data?.items.find((t) => t.id === id);
      invalidateData();
      toast.success("Transaction deleted.", {
        label: "Undo",
        onClick: () => {
          if (!removed) return;
          const { id: _id, created_at: _c, updated_at: _u, category: _cat, ...body } = removed;
          createTransaction(body)
            .then(() => invalidateData())
            .catch((err) => toast.error(apiErrorMessage(err, "Could not undo the delete.")));
        },
      });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const toggleSort = (column: "date" | "amount") => {
    if (sort === column) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSort(column);
      setOrder("desc");
    }
    setPage(1);
  };

  const openAdd = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setDebouncedQ("");
  };

  const sortIcon = (column: "date" | "amount") =>
    sort !== column ? (
      <ArrowUpDown className="size-3.5" aria-hidden="true" />
    ) : order === "desc" ? (
      <ArrowDown className="size-3.5" aria-hidden="true" />
    ) : (
      <ArrowUp className="size-3.5" aria-hidden="true" />
    );

  const ariaSort = (column: "date" | "amount"): "ascending" | "descending" | "none" =>
    sort === column ? (order === "asc" ? "ascending" : "descending") : "none";

  const selectClass =
    "rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-brand-600";

  return (
    <>
      <PageHeader
        title="Transactions"
        actions={
          <Button onClick={openAdd}>
            <Plus className="size-4" aria-hidden="true" />
            Add transaction
          </Button>
        }
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <div className="relative min-w-44 flex-1">
          <label htmlFor="tx-search" className="sr-only">Search transactions</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            id="tx-search"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Search description or notes…"
            className="w-full rounded-md border border-slate-300 py-2 pr-3 pl-9 text-sm focus:border-brand-600"
          />
        </div>
        <div>
          <label htmlFor="tx-filter-type" className="sr-only">Filter by type</label>
          <select
            id="tx-filter-type"
            value={filters.type}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as Filters["type"] }))}
            className={selectClass}
          >
            <option value="">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </div>
        <div>
          <label htmlFor="tx-filter-category" className="sr-only">Filter by category</label>
          <select
            id="tx-filter-category"
            value={filters.categoryId}
            onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
            className={selectClass}
          >
            <option value="">All categories</option>
            {categoriesQ.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tx-filter-from" className="sr-only">From date</label>
          <input
            id="tx-filter-from"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className={selectClass}
          />
        </div>
        <div>
          <label htmlFor="tx-filter-to" className="sr-only">To date</label>
          <input
            id="tx-filter-to"
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className={selectClass}
          />
        </div>
        {filtersActive && (
          <Button variant="ghost" onClick={clearFilters}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Clear filters
          </Button>
        )}
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {listQ.isPending && (
          <div className="space-y-3 p-4" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}
        {listQ.error && <div className="p-4"><ErrorState onRetry={() => listQ.refetch()} /></div>}
        {listQ.data && listQ.data.items.length === 0 && filtersActive && (
          <div className="p-4">
            <EmptyState
              icon={Filter}
              title="No transactions match these filters"
              description="Try widening your search or clearing the filters."
            >
              <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
            </EmptyState>
          </div>
        )}
        {listQ.data && listQ.data.items.length === 0 && !filtersActive && (
          <div className="p-4">
            <EmptyState
              title="No transactions yet"
              description="Track your first income or expense to start seeing insights."
            >
              <Button onClick={openAdd}>
                <Plus className="size-4" aria-hidden="true" />
                Add transaction
              </Button>
            </EmptyState>
          </div>
        )}
        {listQ.data && listQ.data.items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Description</th>
                    <th scope="col" className="px-4 py-2.5">Category</th>
                    <th scope="col" className="px-4 py-2.5" aria-sort={ariaSort("date")}>
                      <button onClick={() => toggleSort("date")} className="inline-flex items-center gap-1 hover:text-slate-800">
                        Date {sortIcon("date")}
                      </button>
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right" aria-sort={ariaSort("amount")}>
                      <button onClick={() => toggleSort("amount")} className="inline-flex items-center gap-1 hover:text-slate-800">
                        Amount {sortIcon("amount")}
                      </button>
                    </th>
                    <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {listQ.data.items.map((t) =>
                    confirmDeleteId === t.id ? (
                      <tr key={t.id} className="bg-red-50">
                        <td colSpan={5} className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-3" role="alert">
                            <span className="text-sm font-medium text-red-800">Delete this transaction?</span>
                            <Button variant="danger" onClick={() => { setConfirmDeleteId(null); deleteMutation.mutate(t.id); }}>
                              Yes, delete
                            </Button>
                            <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>No, keep it</Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={t.id} className="group">
                        <td className="max-w-64 px-4 py-2.5">
                          <span className="block truncate font-medium">{t.description}</span>
                          {t.notes && <span className="block truncate text-xs text-slate-400">{t.notes}</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {t.category ? (
                            <CategoryChip name={t.category.name} type={t.category.type} />
                          ) : (
                            <span className="text-xs text-slate-400">Uncategorized</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{formatDate(t.date)}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <MoneyText amount={t.amount} signed={t.type} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => { setEditing(t); setSheetOpen(true); }}
                              aria-label={`Edit ${t.description}`}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(t.id)}
                              aria-label={`Delete ${t.description}`}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />
          </>
        )}
      </div>

      {sheetOpen && (
        <Sheet title={editing ? "Edit transaction" : "Add transaction"} onClose={() => { setSheetOpen(false); setEditing(null); }}>
          <TransactionForm
            categories={categoriesQ.data ?? []}
            initial={
              editing
                ? {
                    type: editing.type,
                    amount: editing.amount,
                    category_id: editing.category_id,
                    description: editing.description,
                    notes: editing.notes,
                    date: editing.date,
                  }
                : undefined
            }
            submitting={saveMutation.isPending}
            onCancel={() => { setSheetOpen(false); setEditing(null); }}
            onSubmit={(body) => saveMutation.mutate(editing ? { id: editing.id, body } : { body })}
          />
        </Sheet>
      )}
    </>
  );
}
