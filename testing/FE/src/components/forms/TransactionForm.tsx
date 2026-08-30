import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { Category, TransactionCreate, TransactionType } from "../../api/types";
import { Button } from "../Button";
import { CategoryPicker } from "../CategoryPicker";
import { parseMoneyInput, todayISO } from "../../lib/format";

const schema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((s) => parseMoneyInput(s) !== null, "Positive number with at most 2 decimals"),
  category_id: z.string(),
  description: z.string().trim().min(1, "Description is required").max(255, "Too long (255 max)"),
  notes: z.string().max(2000, "Too long (2000 max)").optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
    .refine((s) => !Number.isNaN(Date.parse(s)), "Pick a valid date"),
});

type FormValues = z.infer<typeof schema>;

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-red-600">
      {message}
    </p>
  );
}

export function TransactionForm({
  categories,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  categories: Category[];
  /** Existing transaction for edit mode. */
  initial?: TransactionCreate;
  onSubmit: (payload: TransactionCreate) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: initial?.type ?? "expense",
      amount: initial?.amount ?? "",
      category_id: initial?.category_id != null ? String(initial.category_id) : "",
      description: initial?.description ?? "",
      notes: initial?.notes ?? "",
      date: initial?.date ?? todayISO(),
    },
  });

  // Re-seed the form when a different transaction is passed in (edit).
  useEffect(() => {
    if (initial) {
      reset({
        type: initial.type,
        amount: initial.amount,
        category_id: initial.category_id != null ? String(initial.category_id) : "",
        description: initial.description,
        notes: initial.notes ?? "",
        date: initial.date,
      });
    }
  }, [initial, reset]);

  const type = watch("type");
  const options = categories.filter((c) => c.type === type);

  const submit = handleSubmit((values) => {
    onSubmit({
      type: values.type,
      amount: values.amount.trim(),
      category_id: values.category_id === "" ? null : Number(values.category_id),
      description: values.description.trim(),
      notes: values.notes?.trim() ? values.notes.trim() : null,
      date: values.date,
    });
  });

  const switchType = (t: TransactionType) => {
    // Category choices change with type; clear an incompatible pick.
    if (t !== type) reset({ ...watch(), type: t, category_id: "" });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Type</legend>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Transaction type">
          {(["expense", "income"] as const).map((t) => (
            <label
              key={t}
              className={`cursor-pointer rounded-md border px-3 py-2 text-center text-sm font-medium capitalize ${
                type === t
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                value={t}
                {...register("type")}
                onChange={() => switchType(t)}
                className="sr-only"
                checked={type === t}
              />
              {t}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="tx-amount" className="mb-1 block text-sm font-medium text-slate-700">
          Amount
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
            $
          </span>
          <input
            id="tx-amount"
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={errors.amount ? "tx-amount-error" : undefined}
            className={`${inputClass} pl-7`}
            {...register("amount")}
          />
        </div>
        <FieldError id="tx-amount-error" message={errors.amount?.message} />
      </div>

      <CategoryPicker
        label="Category"
        id="tx-category"
        categories={options}
        allowUncategorized
        error={errors.category_id?.message}
        {...register("category_id")}
      />

      <div>
        <label htmlFor="tx-description" className="mb-1 block text-sm font-medium text-slate-700">
          Description
        </label>
        <input
          id="tx-description"
          maxLength={255}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? "tx-description-error" : undefined}
          className={inputClass}
          {...register("description")}
        />
        <FieldError id="tx-description-error" message={errors.description?.message} />
      </div>

      <div>
        <label htmlFor="tx-notes" className="mb-1 block text-sm font-medium text-slate-700">
          Notes <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea id="tx-notes" rows={2} className={inputClass} {...register("notes")} />
        <FieldError id="tx-notes-error" message={errors.notes?.message} />
      </div>

      <div>
        <label htmlFor="tx-date" className="mb-1 block text-sm font-medium text-slate-700">
          Date
        </label>
        <input
          id="tx-date"
          type="date"
          aria-invalid={errors.date ? true : undefined}
          aria-describedby={errors.date ? "tx-date-error" : undefined}
          className={inputClass}
          {...register("date")}
        />
        <FieldError id="tx-date-error" message={errors.date?.message} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {initial ? "Save changes" : "Add transaction"}
        </Button>
      </div>
    </form>
  );
}
