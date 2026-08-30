import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { apiErrorMessage } from "../../api/client";
import type { Category } from "../../api/types";
import { parseMoneyInput } from "../../lib/format";
import { Button } from "../Button";

/** Inline "add budget" row at the bottom of the budgets list. */
export function BudgetForm({
  categories,
  busy,
  onAdd,
}: {
  /** Expense categories without a budget for the selected month. */
  categories: Category[];
  busy: boolean;
  onAdd: (categoryId: number, amount: string) => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!categoryId) {
      setError("Pick a category.");
      return;
    }
    const money = parseMoneyInput(amount);
    if (!money) {
      setError("Enter a positive amount with at most 2 decimals.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onAdd(Number(categoryId), money);
      setCategoryId("");
      setAmount("");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-2 px-4 py-3" noValidate>
      <div className="min-w-40 flex-1">
        <label htmlFor="budget-category" className="sr-only">
          Budget category
        </label>
        <select
          id="budget-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600"
        >
          <option value="">Category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="w-32">
        <label htmlFor="budget-amount" className="sr-only">
          Budget amount
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
            $
          </span>
          <input
            id="budget-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="w-full rounded-md border border-slate-300 py-2 pr-3 pl-7 text-sm focus:border-brand-600"
          />
        </div>
      </div>
      <Button type="submit" loading={submitting || busy}>
        <Plus className="size-4" aria-hidden="true" />
        Add budget
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
