import { forwardRef, type SelectHTMLAttributes } from "react";

import type { Category } from "../api/types";

export interface CategoryPickerProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  categories: Category[];
  /** Include an empty "Uncategorized" option (transactions allow no category). */
  allowUncategorized?: boolean;
  error?: string;
}

export const CategoryPicker = forwardRef<HTMLSelectElement, CategoryPickerProps>(
  function CategoryPicker(
    { label, categories, allowUncategorized = false, error, id, ...rest },
    ref,
  ) {
    const selectId = id ?? "category-picker";
    return (
      <div>
        <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-slate-700">
          {label}
        </label>
        <select
          id={selectId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${selectId}-error` : undefined}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600"
          {...rest}
        >
          {allowUncategorized && <option value="">Uncategorized</option>}
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {error && (
          <p id={`${selectId}-error`} className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);
