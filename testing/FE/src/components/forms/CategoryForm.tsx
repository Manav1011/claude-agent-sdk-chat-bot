import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { apiErrorMessage } from "../../api/client";
import type { CategoryType } from "../../api/types";
import { Button } from "../Button";

/** Inline "add category" row. Parent owns the mutation + error surfacing. */
export function CategoryForm({
  defaultType,
  busy,
  onAdd,
}: {
  defaultType: CategoryType;
  busy: boolean;
  onAdd: (name: string, type: CategoryType) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CategoryType>(defaultType);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (trimmed.length > 50) {
      setError("Name must be 50 characters or fewer.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onAdd(trimmed, type);
      setName("");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-2" noValidate>
      <div className="min-w-40 flex-1">
        <label htmlFor={`cat-name-${defaultType}`} className="sr-only">
          New category name
        </label>
        <input
          id={`cat-name-${defaultType}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder="New category name"
          aria-invalid={error ? true : undefined}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600"
        />
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`cat-type-${defaultType}`} className="sr-only">
          Category type
        </label>
        <select
          id={`cat-type-${defaultType}`}
          value={type}
          onChange={(e) => setType(e.target.value as CategoryType)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600"
        >
          <option value="expense">expense</option>
          <option value="income">income</option>
        </select>
      </div>
      <Button type="submit" loading={submitting || busy}>
        <Plus className="size-4" aria-hidden="true" />
        Add
      </Button>
    </form>
  );
}
