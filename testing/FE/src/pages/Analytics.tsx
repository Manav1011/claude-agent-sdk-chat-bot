import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getBreakdown, getSummary, getTrends } from "../api/endpoints";
import { ErrorState } from "../components/ErrorState";
import { MoneyText } from "../components/MoneyText";
import { MonthPicker } from "../components/MonthPicker";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { monthLabelShort } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";

const PERIODS = [3, 6, 12] as const;

export default function Analytics() {
  const now = new Date();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(6);
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const { year, month } = ym;

  // Trends feed both charts (GET /reports/trends?months=N).
  const trendsQ = useQuery({
    queryKey: queryKeys.reports.trends(period),
    queryFn: () => getTrends(period),
  });
  // Selected-month breakdown table (GET /reports/breakdown) + count (GET /reports/summary).
  const breakdownQ = useQuery({
    queryKey: queryKeys.reports.breakdown(year, month, "expense"),
    queryFn: () => getBreakdown(year, month, "expense"),
  });
  const summaryQ = useQuery({
    queryKey: queryKeys.reports.summary(year, month),
    queryFn: () => getSummary(year, month),
  });

  const data = trendsQ.data?.months.map((m) => ({
    label: monthLabelShort(m.year, m.month),
    income: Number(m.income_total),
    expense: Number(m.expense_total),
    net: Number(m.net),
  }));

  const moneyTick = (v: number) => `$${v}`;

  return (
    <>
      <PageHeader
        title="Analytics"
        actions={
          <div role="group" aria-label="Analysis period" className="flex overflow-hidden rounded-md border border-slate-300">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={`px-3 py-1.5 text-sm font-medium ${
                  period === p ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {p} mo
              </button>
            ))}
          </div>
        }
      />

      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5" aria-label="Income versus expenses">
        <h2 className="text-sm font-semibold text-slate-800">Income vs expenses</h2>
        <p className="mb-3 text-xs text-slate-400">
          Last {period} months, per calendar month
        </p>
        {trendsQ.isPending && <Skeleton className="h-64 w-full" />}
        {trendsQ.error && <ErrorState onRetry={() => trendsQ.refetch()} />}
        {data && (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 12 }} stroke="#64748b" width={60} tickFormatter={moneyTick} />
                <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Legend />
                <Bar dataKey="income" name="Income" fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="Expenses" fill="#dc2626" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-5" aria-label="Net cash flow">
        <h2 className="text-sm font-semibold text-slate-800">Net cash flow</h2>
        <p className="mb-3 text-xs text-slate-400">
          Income minus expenses per month — same trends feed as above
        </p>
        {trendsQ.isPending && <Skeleton className="h-56 w-full" />}
        {trendsQ.error && <ErrorState onRetry={() => trendsQ.refetch()} />}
        {data && (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 12 }} stroke="#64748b" width={60} tickFormatter={moneyTick} />
                <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Line type="monotone" dataKey="net" name="Net" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Category breakdown table">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Expense breakdown by category</h2>
            <p className="text-xs text-slate-400">Per category, uncategorized transactions included</p>
          </div>
          <MonthPicker year={year} month={month} onChange={(y, m) => setYm({ year: y, month: m })} />
        </div>
        {breakdownQ.isPending && <div className="space-y-2 px-4 pb-4" aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>}
        {breakdownQ.error && <div className="px-4 pb-4"><ErrorState onRetry={() => breakdownQ.refetch()} /></div>}
        {breakdownQ.data && breakdownQ.data.items.length === 0 && (
          <p className="px-4 pb-4 text-sm text-slate-500">No expenses recorded this month.</p>
        )}
        {breakdownQ.data && breakdownQ.data.items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 sm:px-5">Category</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Amount</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Share</th>
                    <th scope="col" className="w-1/3 px-4 py-2.5">Distribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {breakdownQ.data.items.map((item, i) => (
                    <tr key={`${item.category_id ?? "none"}-${i}`}>
                      <td className="px-4 py-2.5 font-medium sm:px-5">
                        {item.category_name ?? "Uncategorized"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <MoneyText amount={item.total} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                        {Number(item.pct_of_total).toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 sm:px-5">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-brand-600"
                            style={{ width: `${Math.min(100, Number(item.pct_of_total))}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summaryQ.data && (
              <p className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
                {summaryQ.data.transaction_count} transaction{summaryQ.data.transaction_count === 1 ? "" : "s"} in this month.
                Category-level counts aren't exposed by the API; shares are of the month&apos;s expense total.
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
