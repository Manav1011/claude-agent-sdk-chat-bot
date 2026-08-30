import type { CategoryType, TransactionListParams } from "../api/types";

/** Centralized TanStack Query key factory. List keys carry their filter params. */
export const queryKeys = {
  me: ["me"] as const,

  categories: {
    all: ["categories"] as const,
  },

  transactions: {
    all: ["transactions"] as const,
    list: (params: TransactionListParams) => ["transactions", "list", params] as const,
  },

  budgets: {
    all: ["budgets"] as const,
    list: (year: number, month: number) => ["budgets", "list", year, month] as const,
  },

  reports: {
    summary: (year: number, month: number) => ["reports", "summary", year, month] as const,
    breakdown: (year: number, month: number, type: CategoryType) =>
      ["reports", "breakdown", year, month, type] as const,
    budgetStatus: (year: number, month: number) => ["reports", "budget-status", year, month] as const,
    trends: (months: number) => ["reports", "trends", months] as const,
  },
};
