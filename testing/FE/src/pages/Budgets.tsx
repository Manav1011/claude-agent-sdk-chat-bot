import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import {
  createBudget,
  deleteBudget,
  getBudgetStatus,
  listBudgets,
  listCategories,
  updateBudget,
} from "../api/endpoints";
import { apiErrorMessage } from "../api/client";
import type { BudgetStatusItem } from "../api/types";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { MoneyText } from "../components/MoneyText";
import { MonthPicker } from "../components/MonthPicker";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { Skeleton } from "../components/Skeleton";
import { BudgetForm } from "../components/forms/BudgetForm";
import { useToast } from "../components/Toast";
import { parseMoneyInput } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";

export default function Budgets() {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const { year, month } = ym;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const budgetsQ = useQuery({
    queryKey: queryKeys.budgets.list(year, month),
    queryFn: () => listBudgets(year, month),
  });
  const statusQ = useQuery({
    queryKey: queryKeys.reports.budgetStatus(year, month),
    queryFn: () => getBudgetStatus(year, month),
  });
  const categoriesQ = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: listCategories,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
  };

  const createMutation = useMutation({
    mutationFn: ({ categoryId, amount }: { categoryId: number; amount: string }) =>
      createBudget({ category_id: categoryId, year, month, amount }),
    onSuccess: () => {
      toast.success("Budget created.");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, amount }: { id: number; amount: string }) => updateBudget(id, amount),
    onSuccess: () => {
      toast.success("Budget updated.");
      setEditingId(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBudget(id),
    onSuccess: () => {
      toast.success("Budget deleted.");
      setConfirmId(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const usedCategoryIds = new Set((budgetsQ.data ?? []).map((b) => b.category_id));
  const addableCategories = (categoriesQ.data ?? []).filter(
    (c) => c.type === "expense" && !usedCategoryIds.has(c.id),
  );

  const statusItems: BudgetStatusItem[] = statusQ.data ?? [];

  const startEdit = (item: BudgetStatusItem) => {
    setConfirmId(null);
    setEditingId(item.budget_id);
    setEditValue(item.budgeted);
  };

  const commitEdit = (budgetId: number) => {
    const money = parseMoneyInput(editValue);
    if (!money) {
      toast.error("Enter a positive amount with at most 2 decimals.");
      return;
    }
    updateMutation.mutate({ id: budgetId, amount: money });
  };

  return (
    <>
      <PageHeader
        title="Budgets"
        actions={<MonthPicker year={year} month={month} onChange={(y, m) => setYm({ year: y, month: m })} />}
      />

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {(budgetsQ.isPending || statusQ.isPending) && (
          <div className="space-y-3 p-4" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        )}
        {(budgetsQ.error || statusQ.error) && (
          <div className="p-4"><ErrorState onRetry={() => { budgetsQ.refetch(); statusQ.refetch(); }} /></div>
        )}
        {statusQ.data && statusItems.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={Plus}
              title="No budgets this month"
              description="Set a spending limit per expense category and track it as transactions come in."
            />
          </div>
        )}
        {statusItems.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {statusItems.map((b) => (
              <li key={b.budget_id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{b.category_name}</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      Budgeted{" "}
                      {editingId === b.budget_id ? (
                        <span className="inline-flex items-center gap-1">
                          <label htmlFor={`budget-edit-${b.budget_id}`} className="sr-only">
                            New amount for {b.category_name}
                          </label>
                          <input
                            id={`budget-edit-${b.budget_id}`}
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(b.budget_id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            inputMode="decimal"
                            className="w-24 rounded-md border border-brand-600 px-2 py-0.5 text-sm"
                          />
                          <button
                            onClick={() => commitEdit(b.budget_id)}
                            aria-label="Save new amount"
                            className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50"
                          >
                            <Check className="size-4" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel editing"
                            className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
                          >
                            <X className="size-4" aria-hidden="true" />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => startEdit(b)}
                          className="font-medium text-slate-700 underline decoration-dotted underline-offset-2 hover:text-brand-600"
                          aria-label={`Edit budget for ${b.category_name}`}
                        >
                          <MoneyText amount={b.budgeted} className="text-xs" />
                        </button>
                      )}{" "}
                      · Spent <MoneyText amount={b.actual} className="text-xs" /> · Remaining{" "}
                      <MoneyText amount={b.remaining} className="text-xs" />
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {confirmId === b.budget_id ? (
                      <span role="alert" className="flex items-center gap-2 text-sm">
                        <span className="text-red-700">Delete?</span>
                        <Button variant="danger" onClick={() => deleteMutation.mutate(b.budget_id)} loading={deleteMutation.isPending}>
                          Yes
                        </Button>
                        <Button variant="secondary" onClick={() => setConfirmId(null)}>No</Button>
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(b)}
                          aria-label={`Edit budget for ${b.category_name}`}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setConfirmId(b.budget_id); }}
                          aria-label={`Delete budget for ${b.category_name}`}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-2 max-w-xl">
                  <ProgressBar percentUsed={Number(b.percent_used)} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {addableCategories.length > 0 && budgetsQ.data && (
          <div className="border-t border-slate-200 bg-slate-50">
            <BudgetForm
              categories={addableCategories}
              busy={createMutation.isPending}
              onAdd={async (categoryId, amount) => {
                await createMutation.mutateAsync({ categoryId, amount });
              }}
            />
          </div>
        )}
        {addableCategories.length === 0 && statusItems.length > 0 && (
          <p className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            Every expense category already has a budget this month.
          </p>
        )}
      </div>
    </>
  );
}
