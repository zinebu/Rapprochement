import { useMemo, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "./utils";
import type { CurrencyCode, LocalBankAccount } from "./types";

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border-0 shadow-sm ring-1 ring-black/5 ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold tracking-tight text-slate-900">{title}</CardTitle>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function CurrencySummary({ accounts }: { accounts: LocalBankAccount[] }) {
  const byCurrency = useMemo(() => {
    const map: Record<CurrencyCode, number> = { EUR: 0, MAD: 0, USD: 0 };
    accounts.forEach((account) => {
      map[account.currency] += account.currentBalance;
    });
    return map;
  }, [accounts]);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {(["EUR", "MAD", "USD"] as CurrencyCode[]).map((currency) => (
        <div key={currency} className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{currency}</p>
          <p className="mt-2 text-lg font-bold text-slate-900">{formatMoney(byCurrency[currency], currency)}</p>
        </div>
      ))}
    </div>
  );
}
