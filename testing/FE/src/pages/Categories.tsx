import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";

import { createCategory, deleteCategory, listCategories, updateCategory } from "../api/endpoints";
import { apiErrorMessage } from "../api/client";
import type { Category, CategoryType } from "../api/types";
import { Button } from "../components/Button";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { CategoryForm } from "../components/forms/CategoryForm";
import { useToast } from "../components/Toast";
import { queryKeys } from "../lib/queryKeys";

export default function Categories() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const categoriesQ = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: listCategories,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all });

  const createMutation = useMutation({
    mutationFn: ({ name, type }: { name: string; type: CategoryType }) => createCategory(name, type),
    onSuccess: () => {
      toast.success("Category added.");
      invalidate();
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateCategory(id, name),
    onSuccess: () => {
      toast.success("Category renamed.");
      setRenameId(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => {
      toast.success("Category deleted.");
      setConfirmId(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const sections: CategoryType[] = ["expense", "income"];
  const byType = (t: CategoryType): Category[] =>
    (categoriesQ.data ?? []).filter((c) => c.type === t);

  const commitRename = (id: number) => {
    const name = renameValue.trim();
    if (!name || name.length > 50) {
      toast.error("Name must be 1–50 characters.");
      return;
    }
    renameMutation.mutate({ id, name });
  };

  const renderSection = (type: CategoryType) => (
    <section key={type} className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label={`${type} categories`}>
      <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 capitalize">
        {type} categories
      </h2>
      {categoriesQ.isPending && (
        <div className="space-y-2 p-4" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      )}
      {categoriesQ.data && byType(type).length === 0 && (
        <p className="px-4 py-4 text-sm text-slate-500">
          {type === "expense" ? "No expense categories yet." : "No income categories yet."}
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {byType(type).map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            {renameId === c.id ? (
              <div className="flex flex-1 items-center gap-2">
                <label htmlFor={`rename-${c.id}`} className="sr-only">
                  Rename {c.name}
                </label>
                <input
                  id={`rename-${c.id}`}
                  autoFocus
                  value={renameValue}
                  maxLength={50}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(c.id);
                    if (e.key === "Escape") setRenameId(null);
                  }}
                  className="flex-1 rounded-md border border-brand-600 px-2 py-1 text-sm"
                />
                <button
                  onClick={() => commitRename(c.id)}
                  aria-label={`Save name for ${c.name}`}
                  className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                >
                  <Check className="size-4" aria-hidden="true" />
                </button>
                <button
                  onClick={() => setRenameId(null)}
                  aria-label="Cancel rename"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : confirmId === c.id ? (
              <span role="alert" className="flex flex-1 items-center justify-end gap-2 text-sm">
                <span className="mr-auto text-red-700">Delete “{c.name}”?</span>
                <Button variant="danger" onClick={() => deleteMutation.mutate(c.id)} loading={deleteMutation.isPending}>
                  Yes
                </Button>
                <Button variant="secondary" onClick={() => setConfirmId(null)}>No</Button>
              </span>
            ) : (
              <>
                <span className="font-medium">{c.name}</span>
                <span className="flex gap-1">
                  <button
                    onClick={() => { setConfirmId(null); setRenameId(c.id); setRenameValue(c.name); }}
                    aria-label={`Rename ${c.name}`}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => setConfirmId(c.id)}
                    aria-label={`Delete ${c.name}`}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-200 bg-slate-50 p-3">
        <CategoryForm
          defaultType={type}
          busy={createMutation.isPending}
          onAdd={async (name, t) => {
            await createMutation.mutateAsync({ name, type: t });
          }}
        />
      </div>
    </section>
  );

  if (categoriesQ.error) {
    return (
      <>
        <PageHeader title="Categories" />
        <ErrorState onRetry={() => categoriesQ.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Categories" description="Organize transactions and budgets into meaningful groups." />
      <div className="grid gap-6 lg:grid-cols-2">{sections.map(renderSection)}</div>
    </>
  );
}
