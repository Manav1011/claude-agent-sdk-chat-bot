import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, PiggyBank, Scale, TrendingDown, TrendingUp, WalletMinimal } from "lucide-react";

import { getBreakdown, getBudgetStatus, getSummary, getTrends, listTransactions } from "../api/endpoints";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { MoneyText } from "../components/MoneyText";
import { MonthPicker } from "../components/MonthPicker";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { Skeleton } from "../components/Skeleton";
import { StatPanel, StatTile } from "../components/StatPanel";
import { formatDate, monthLabelShort, sumAmounts } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";

const PIE_COLORS = ["#1d4ed8", "#0d9488", "#7c3aed", "#d97706", "#dc2626", "#059669", "#64748b"];

function ChartCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5" aria-label={title}>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {note && <p className="mb-3 text-xs text-slate-400">{note}</p>}
      {!note && <div className="mb-3" />}
      {children}
    </section>
  );
}

export default function Dashboard() {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const { year, month } = ym;

  const summaryQ = useQuery({
    queryKey: queryKeys.reports.summary(year, month),
    queryFn: () => getSummary(year, month),
  });
  const trendsQ = useQuery({
    queryKey: queryKeys.reports.trends(6),
    queryFn: () => getTrends(6),
  });
  const breakdownQ = useQuery({
    queryKey: queryKeys.reports.breakdown(year, month, "expense"),
    queryFn: () => getBreakdown(year, month, "expense"),
  });
  const budgetStatusQ = useQuery({
    queryKey: queryKeys.reports.budgetStatus(year, month),
    queryFn: () => getBudgetStatus(year, month),
  });
  const recentQ = useQuery({
    queryKey: queryKeys.transactions.list({ sort: "created_at", order: "desc", page: 1, page_size: 5 }),
    queryFn: () => listTransactions({ sort: "created_at", order: "desc", page: 1, page_size: 5 }),
  });
  // One unfiltered row to learn whether this account has anything at all.
  const anyTxQ = useQuery({
    queryKey: queryKeys.transactions.list({ page: 1, page_size: 1 }),
    queryFn: () => listTransactions({ page: 1, page_size: 1 }),
  });

  const firstRun = anyTxQ.isSuccess && anyTxQ.data.total === 0;
  if (firstRun) {
    return (
      <>
        <PageHeader title="Dashboard" description={`Overview for ${monthLabelShort(year, month)}`} />
        <EmptyState
          icon={WalletMinimal}
          title="Welcome to Ledgerly"
          description="Add your first transaction to unlock income, expense and budget insights."
        >
          <Link to="/transactions?new=1">
            <Button>Add your first transaction</Button>
          </Link>
        </EmptyState>
      </>
    );
  }

  const trendData = trendsQ.data?.months.map((m) => ({
    label: monthLabelShort(m.year, m.month),
    income: Number(m.income_total),
    expense: Number(m.expense_total),
  }));

  const budgetItems = budgetStatusQ.data ?? [];
  const remainingBudget =
    budgetItems.length > 0 ? sumAmounts(budgetItems.map((b) => b.remaining)) : null;

  const breakdownItems = breakdownQ.data?.items ?? [];
  const topSlices = (() => {
    if (breakdownItems.length <= 6) return breakdownItems.map((i) => ({ ...i, name: i.category_name ?? "Uncategorized" }));
    const top = breakdownItems.slice(0, 6);
    const rest = breakdownItems.slice(6);
    return [
      ...top.map((i) => ({ ...i, name: i.category_name ?? "Uncategorized" })),
      {
        category_id: null,
        category_name: "Other",
        total: sumAmounts(rest.map((r) => r.total)),
        pct_of_total: "0",
        name: "Other",
      },
    ];
  })();

  const budgetHealth = [...budgetItems]
    .sort((a, b) => Number(b.percent_used) - Number(a.percent_used))
    .slice(0, 5);

  return (
    <>
      <PageHeader title="Dashboard" actions={<MonthPicker year={year} month={month} onChange={(y, m) => setYm({ year: y, month: m })} />} />

      {/* Stat tiles — one panel, four tiles */}
      {summaryQ.isPending && <Skeleton className="h-28 w-full" />}
      {summaryQ.error && <ErrorState onRetry={() => summaryQ.refetch()} />}
      {summaryQ.data && (
        <StatPanel>
          <StatTile label="Income" icon={TrendingUp} value={<MoneyText amount={summaryQ.data.income_total} />} tone="positive" />
          <StatTile label="Expenses" icon={TrendingDown} value={<MoneyText amount={summaryQ.data.expense_total} />} />
          <StatTile
            label="Net cash flow"
            icon={Scale}
            value={<MoneyText amount={summaryQ.data.net} />}
            tone={Number(summaryQ.data.net) >= 0 ? "positive" : "negative"}
          />
          <StatTile
            label="Remaining budget"
            icon={PiggyBank}
            value={remainingBudget !== null ? <MoneyText amount={remainingBudget} /> : "—"}
            hint={remainingBudget === null ? "No budgets set" : `${budgetItems.length} budget${budgetItems.length === 1 ? "" : "s"}`}
            tone={remainingBudget !== null && Number(remainingBudget) < 0 ? "negative" : "default"}
          />
        </StatPanel>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Spending trends" note="Income vs expenses, last 6 months">
          {trendsQ.isPending && <Skeleton className="h-56 w-full" />}
          {trendsQ.error && <ErrorState onRetry={() => trendsQ.refetch()} />}
          {trendData && (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#64748b" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#64748b" width={60} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                  <Area type="monotone" dataKey="income" name="Income" stroke="#059669" fill="#05966922" strokeWidth={2} />
                  <Area type="monotone" dataKey="expense" name="Expenses" stroke="#dc2626" fill="#dc262622" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-2 flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-600" aria-hidden="true" /> Income</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-red-600" aria-hidden="true" /> Expenses</span>
          </div>
        </ChartCard>

        <ChartCard title={`Category breakdown — ${monthLabelShort(year, month)}`} note="Where expenses went">
          {breakdownQ.isPending && <Skeleton className="h-56 w-full" />}
          {breakdownQ.error && <ErrorState onRetry={() => breakdownQ.refetch()} />}
          {breakdownQ.data && breakdownItems.length === 0 && (
            <EmptyState title="No expenses this month" description="Add an expense transaction to see the breakdown." />
          )}
          {breakdownQ.data && breakdownItems.length > 0 && (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    {/* Number() here is display-only charting; money math stays on strings. */}
                    <Pie data={topSlices.map((s) => ({ name: s.name, value: Number(s.total) }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2} isAnimationActive={false}>
                      {topSlices.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full space-y-1 text-sm">
                {topSlices.map((s, i) => (
                  <li key={`${s.name}-${i}`} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} aria-hidden="true" />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <MoneyText amount={s.total} className="text-sm" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5" aria-label="Budget health">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Budget health</h2>
          {budgetStatusQ.isPending && <Skeleton className="h-24 w-full" />}
          {budgetStatusQ.error && <ErrorState onRetry={() => budgetStatusQ.refetch()} />}
          {budgetStatusQ.data && budgetHealth.length === 0 && (
            <p className="text-sm text-slate-500">
              No budgets for this month yet.{" "}
              <Link to="/budgets" className="font-medium text-brand-600 hover:underline">Set budgets</Link>
            </p>
          )}
          <ul className="space-y-3">
            {budgetHealth.map((b) => (
              <li key={b.budget_id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{b.category_name}</span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    <MoneyText amount={b.actual} className="text-xs" /> of <MoneyText amount={b.budgeted} className="text-xs" />
                  </span>
                </div>
                <ProgressBar percentUsed={Number(b.percent_used)} />
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5" aria-label="Recent transactions">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Recent transactions</h2>
            <Link to="/transactions" className="text-sm font-medium text-brand-600 hover:underline">View all</Link>
          </div>
          {recentQ.isPending && <Skeleton className="h-24 w-full" />}
          {recentQ.error && <ErrorState onRetry={() => recentQ.refetch()} />}
          {recentQ.data && recentQ.data.items.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
          <ul className="divide-y divide-slate-100">
            {recentQ.data?.items.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                    t.type === "income" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                  }`}
                  aria-hidden="true"
                >
                  {t.type === "income" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.description}</span>
                  <span className="block text-xs text-slate-400">
                    {formatDate(t.date)}
                    {t.category && ` · ${t.category.name}`}
                  </span>
                </span>
                <MoneyText amount={t.amount} signed={t.type} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
