import { format } from "date-fns";

/** Format a backend Decimal string for display. Handles negative strings ("-400.00") too. */
export function formatMoney(amount: string, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

/** Format with an explicit +/- sign for income/expense rows. */
export function formatSignedMoney(amount: string, type: "income" | "expense"): string {
  const sign = type === "income" ? "+" : "−";
  return `${sign}${formatMoney(amount)}`;
}

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** Validate a money input string: positive, <=2 decimals. Returns the value or null. */
export function parseMoneyInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!MONEY_PATTERN.test(trimmed)) return null;
  return Number(trimmed) > 0 ? trimmed : null;
}

/**
 * Exact sum of Decimal strings via integer cents — the only client-side math
 * we do, and it avoids float drift. ("sums come from BE" is the rule; this is
 * just for the one derived dashboard tile where BE gives per-row remainders.)
 */
export function sumAmounts(amounts: string[]): string {
  let cents = 0;
  for (const a of amounts) {
    const neg = a.trim().startsWith("-");
    const abs = a.replace("-", "");
    const [whole, frac = ""] = abs.split(".");
    const c = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
    cents += neg ? -c : c;
  }
  return (cents / 100).toFixed(2);
}

/**
 * Format a "YYYY-MM-DD" tx date for display. Parsed from parts directly —
 * never `new Date(str)`, which would read it as UTC and shift days.
 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return format(new Date(y, m - 1, d), "MMM d, yyyy");
}

/** Format a timestamptz (created_at) for display, in the viewer's local zone. */
export function formatTimestamp(iso: string): string {
  return format(new Date(iso), "MMM d, yyyy h:mm a");
}

/** "March 2026" from year + 1-based month, without touching timezones. */
export function monthLabel(year: number, month: number): string {
  return format(new Date(year, month - 1, 1), "MMMM yyyy");
}

/** "Mar '26" — compact axis label. */
export function monthLabelShort(year: number, month: number): string {
  return format(new Date(year, month - 1, 1), "MMM ''yy");
}

/** Today's local date as YYYY-MM-DD (safe default for tx date inputs). */
export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}
