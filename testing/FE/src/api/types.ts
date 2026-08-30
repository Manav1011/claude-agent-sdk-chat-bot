// TS mirrors of the backend Pydantic schemas (testing/BE/app/schemas).
// Decimal fields serialize as JSON strings (e.g. "45.67"), never numbers.

export type CategoryType = "income" | "expense";
export type TransactionType = "income" | "expense";

export interface User {
  id: number;
  email: string;
  is_active: boolean;
  created_at: string;
}

export interface Token {
  access_token: string;
  token_type: string;
}

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  created_at: string;
}

export interface CategoryMini {
  id: number;
  name: string;
  type: CategoryType;
}

export interface Transaction {
  id: number;
  amount: string;
  type: TransactionType;
  category_id: number | null;
  category: CategoryMini | null;
  description: string;
  notes: string | null;
  /** YYYY-MM-DD */
  date: string;
  created_at: string;
  updated_at: string;
}

export interface TransactionCreate {
  amount: string;
  type: TransactionType;
  category_id?: number | null;
  description: string;
  notes?: string | null;
  /** YYYY-MM-DD */
  date: string;
}

export type TransactionUpdate = Partial<TransactionCreate>;

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface TransactionListParams {
  category_id?: number;
  type?: TransactionType;
  date_from?: string;
  date_to?: string;
  q?: string;
  sort?: "date" | "amount" | "created_at";
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface Budget {
  id: number;
  category_id: number;
  category_name: string | null;
  year: number;
  month: number;
  amount: string;
  created_at: string;
  updated_at: string;
}

export interface BudgetCreate {
  category_id: number;
  year: number;
  month: number;
  amount: string;
}

export interface Summary {
  income_total: string;
  expense_total: string;
  net: string;
  transaction_count: number;
}

export interface BreakdownItem {
  category_id: number | null;
  category_name: string | null;
  total: string;
  pct_of_total: string;
}

export interface Breakdown {
  year: number;
  month: number;
  type: CategoryType;
  items: BreakdownItem[];
}

export interface BudgetStatusItem {
  budget_id: number;
  category_name: string;
  month: string;
  budgeted: string;
  actual: string;
  remaining: string;
  percent_used: string;
}

export interface TrendMonth {
  year: number;
  month: number;
  income_total: string;
  expense_total: string;
  net: string;
}

export interface Trends {
  months: TrendMonth[];
}

/** Backend error envelope: {"error":{"code","message","details"}} */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}
