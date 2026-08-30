import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-slate-100">
        <Icon className="size-6 text-slate-400" aria-hidden="true" />
      </span>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
