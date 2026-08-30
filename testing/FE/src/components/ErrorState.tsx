import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "./Button";

export function ErrorState({
  message = "Failed to load data.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-6 text-center">
      <AlertTriangle className="size-6 text-red-600" aria-hidden="true" />
      <p className="text-sm text-red-800">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
