import { formatMoney, formatSignedMoney } from "../lib/format";

/** Renders a backend Decimal string; never re-derives values client-side. */
export function MoneyText({
  amount,
  signed,
  className = "",
}: {
  amount: string;
  /** Color +/- for income/expense rows. */
  signed?: "income" | "expense";
  className?: string;
}) {
  if (signed) {
    const color = signed === "income" ? "text-emerald-600" : "text-rose-600";
    return <span className={`${color} font-medium tabular-nums ${className}`}>{formatSignedMoney(amount, signed)}</span>;
  }
  const negative = amount.trim().startsWith("-");
  return (
    <span className={`tabular-nums ${negative ? "text-rose-600" : ""} ${className}`}>
      {formatMoney(amount)}
    </span>
  );
}
