import { api } from "./client";
import type {
  Budget,
  BudgetCreate,
  BudgetStatusItem,
  Category,
  CategoryType,
  Summary,
  Breakdown,
  Page,
  Token,
  Trends,
  Transaction,
  TransactionCreate,
  TransactionListParams,
  TransactionUpdate,
  User,
} from "./types";

// ---- auth ----

export async function register(email: string, password: string): Promise<User> {
  const { data } = await api.post<User>("/auth/register", { email, password });
  return data;
}

export async function login(email: string, password: string): Promise<Token> {
  const form = new URLSearchParams({ username: email, password });
  const { data } = await api.post<Token>("/auth/login", form);
  return data;
}

export async function me(): Promise<User> {
  const { data } = await api.get<User>("/auth/me");
  return data;
}

// ---- categories ----

export async function listCategories(): Promise<Category[]> {
  const { data } = await api.get<Category[]>("/categories");
  return data;
}

export async function createCategory(name: string, type: CategoryType): Promise<Category> {
  const { data } = await api.post<Category>("/categories", { name, type });
  return data;
}

export async function updateCategory(id: number, name: string): Promise<Category> {
  const { data } = await api.put<Category>(`/categories/${id}`, { name });
  return data;
}

export async function deleteCategory(id: number): Promise<void> {
  await api.delete(`/categories/${id}`);
}

// ---- transactions ----

export async function listTransactions(params: TransactionListParams): Promise<Page<Transaction>> {
  const { data } = await api.get<Page<Transaction>>("/transactions", { params });
  return data;
}

export async function createTransaction(payload: TransactionCreate): Promise<Transaction> {
  const { data } = await api.post<Transaction>("/transactions", payload);
  return data;
}

export async function updateTransaction(id: number, payload: TransactionUpdate): Promise<Transaction> {
  const { data } = await api.put<Transaction>(`/transactions/${id}`, payload);
  return data;
}

export async function deleteTransaction(id: number): Promise<void> {
  await api.delete(`/transactions/${id}`);
}

// ---- budgets ----

export async function listBudgets(year: number, month: number): Promise<Budget[]> {
  const { data } = await api.get<Budget[]>("/budgets", { params: { year, month } });
  return data;
}

export async function createBudget(payload: BudgetCreate): Promise<Budget> {
  const { data } = await api.post<Budget>("/budgets", payload);
  return data;
}

export async function updateBudget(id: number, amount: string): Promise<Budget> {
  const { data } = await api.put<Budget>(`/budgets/${id}`, { amount });
  return data;
}

export async function deleteBudget(id: number): Promise<void> {
  await api.delete(`/budgets/${id}`);
}

// ---- reports ----

export async function getSummary(year: number, month: number): Promise<Summary> {
  const { data } = await api.get<Summary>("/reports/summary", { params: { year, month } });
  return data;
}

export async function getBreakdown(
  year: number,
  month: number,
  type: CategoryType = "expense",
): Promise<Breakdown> {
  const { data } = await api.get<Breakdown>("/reports/breakdown", { params: { year, month, type } });
  return data;
}

export async function getBudgetStatus(year: number, month: number): Promise<BudgetStatusItem[]> {
  const { data } = await api.get<BudgetStatusItem[]>("/reports/budget-status", {
    params: { year, month },
  });
  return data;
}

export async function getTrends(months: number): Promise<Trends> {
  const { data } = await api.get<Trends>("/reports/trends", { params: { months } });
  return data;
}
