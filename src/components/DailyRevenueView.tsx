import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  AlertTriangle,
  Banknote,
  Smartphone,
  TrendingUp,
  Database,
} from 'lucide-react';
import {
  AppView,
  Product,
  Sale,
  formatKES,
  formatKenyaTimeOnly,
  getKenyaDateKey,
} from '../types/pos';

interface DailyRevenueViewProps {
  sales: Sale[];
  products: Product[];
  loading: boolean;
  onNavigate: (view: AppView) => void;
  onSeedSampleData: () => Promise<void>;
}

type PeriodMode = 'today' | 'yesterday' | 'last7' | 'month' | 'custom';

const MONTH_OPTIONS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export const DailyRevenueView: React.FC<DailyRevenueViewProps> = ({
  sales,
  products,
  loading,
  onNavigate,
  onSeedSampleData,
}) => {
  const todayKey = getKenyaDateKey(new Date());
  const yesterdayKey = getKenyaDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const [currentYear, currentMonth] = todayKey.split('-');

  const [periodMode, setPeriodMode] = useState<PeriodMode>('today');
  const [customDate, setCustomDate] = useState<string>(todayKey);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);
  const [selectedYear, setSelectedYear] = useState<string>(currentYear);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [seeding, setSeeding] = useState(false);

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    const curYr = Number(currentYear);
    for (let y = curYr; y >= curYr - 5; y--) {
      years.add(String(y));
    }
    for (const s of sales) {
      if (s.saleDateKey && s.saleDateKey.length >= 4) {
        years.add(s.saleDateKey.slice(0, 4));
      }
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [sales, currentYear]);

  const last7Keys = useMemo(() => {
    const keys = new Set<string>();
    for (let i = 0; i < 7; i++) {
      keys.add(getKenyaDateKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
    }
    return keys;
  }, []);

  const selectedMonthPrefix = `${selectedYear}-${selectedMonth}`;

  const periodSales = useMemo(() => {
    return sales.filter((sale) => {
      if (sale.status !== 'completed') return false;
      if (periodMode === 'today') return sale.saleDateKey === todayKey;
      if (periodMode === 'yesterday') return sale.saleDateKey === yesterdayKey;
      if (periodMode === 'last7') return last7Keys.has(sale.saleDateKey);
      if (periodMode === 'month') return sale.saleDateKey.startsWith(selectedMonthPrefix);
      return sale.saleDateKey === customDate;
    });
  }, [sales, periodMode, todayKey, yesterdayKey, last7Keys, selectedMonthPrefix, customDate]);

  const metrics = useMemo(() => {
    let totalRevenue = 0;
    let totalCost = 0;
    let cashTotal = 0;
    let mpesaTotal = 0;
    let creditOutstanding = 0;
    let totalDiscounts = 0;
    let verifiedMpesaTotal = 0;
    let pendingMpesaCount = 0;

    for (const s of periodSales) {
      totalRevenue += s.totalAmount;
      totalCost += s.totalCost;
      cashTotal += s.cashAmount;
      mpesaTotal += s.mpesaAmount;
      creditOutstanding += s.creditBalance ?? 0;
      totalDiscounts += s.discountAmount ?? 0;
      if (s.mpesaAmount > 0) {
        if (s.mpesaStatus === 'verified') verifiedMpesaTotal += s.mpesaAmount;
        if (s.mpesaStatus === 'pending') pendingMpesaCount += 1;
      }
    }

    const grossProfit = totalRevenue - totalCost;
    const marginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const avgBasket = periodSales.length > 0 ? totalRevenue / periodSales.length : 0;

    return {
      totalRevenue,
      totalCost,
      grossProfit,
      marginPct,
      cashTotal,
      mpesaTotal,
      creditOutstanding,
      totalDiscounts,
      verifiedMpesaTotal,
      pendingMpesaCount,
      txCount: periodSales.length,
      avgBasket,
    };
  }, [periodSales]);

  const inventoryStats = useMemo(() => {
    const active = products.filter((p) => p.isActive);
    const lowStock = active.filter((p) => p.stockQuantity > 0 && p.stockQuantity <= p.reorderLevel);
    const outOfStock = active.filter((p) => p.stockQuantity <= 0);
    const costValuation = active.reduce((sum, p) => sum + p.costPrice * p.stockQuantity, 0);
    return { lowStock, outOfStock, costValuation };
  }, [products]);

  const hourlyBuckets = useMemo(() => {
    const hours = Array.from({ length: 13 }, (_, idx) => idx + 7); // 7 AM - 7 PM EAT
    const map = new Map<number, { hour: number; cash: number; mpesa: number; count: number }>(
      hours.map((h) => [h, { hour: h, cash: 0, mpesa: 0, count: 0 }])
    );

    for (const sale of periodSales) {
      if (!sale.createdAt) continue;
      const d = sale.createdAt.toDate();
      const hourStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Nairobi',
        hour: '2-digit',
        hour12: false,
      }).format(d);
      const h = Math.min(19, Math.max(7, parseInt(hourStr, 10) || 12));
      const bucket = map.get(h);
      if (bucket) {
        bucket.cash += sale.cashAmount;
        bucket.mpesa += sale.mpesaAmount;
        bucket.count += 1;
      }
    }

    return Array.from(map.values());
  }, [periodSales]);

  const maxBucketTotal = useMemo(() => {
    return Math.max(1000, ...hourlyBuckets.map((b) => b.cash + b.mpesa));
  }, [hourlyBuckets]);

  const cashPct =
    metrics.totalRevenue > 0 ? Math.round((metrics.cashTotal / metrics.totalRevenue) * 100) : 0;
  const mpesaPct = metrics.totalRevenue > 0 ? 100 - cashPct : 0;

  const handleLoadSample = async () => {
    setSeeding(true);
    try {
      await onSeedSampleData();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Period Selector Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            [
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: 'last7', label: 'Last 7 Days' },
              { id: 'month', label: 'Month' },
              { id: 'custom', label: 'Pick Date' },
            ] as { id: PeriodMode; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPeriodMode(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                periodMode === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {periodMode === 'month' && (
            <div className="flex items-center gap-2">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Select month"
                className="px-2.5 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-slate-50 text-slate-900 focus:outline-none focus:border-amber-600 cursor-pointer"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                aria-label="Select year"
                className="px-2.5 py-1.5 text-xs font-mono font-semibold border border-slate-200 rounded-lg bg-slate-50 text-slate-900 focus:outline-none focus:border-amber-600 cursor-pointer"
              >
                {yearOptions.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>
          )}

          {periodMode === 'custom' && (
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:border-amber-600"
            />
          )}

          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {periodMode === 'today'
              ? `EAT Date: ${todayKey}`
              : periodMode === 'yesterday'
              ? `EAT Date: ${yesterdayKey}`
              : periodMode === 'last7'
              ? 'Rolling 7 Days (EAT)'
              : periodMode === 'month'
              ? `${MONTH_OPTIONS.find((m) => m.value === selectedMonth)?.label} ${selectedYear} (EAT)`
              : `EAT Date: ${customDate}`}
          </span>
        </div>
      </div>

      {/* Primary 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Revenue</span>
            <TrendingUp className="w-4 h-4 text-amber-600" />
          </div>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-2">
            {formatKES(metrics.totalRevenue)}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {metrics.txCount} {metrics.txCount === 1 ? 'sale' : 'sales'} · Avg{' '}
            {formatKES(metrics.avgBasket)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Cash Drawer Sales</span>
            <Banknote className="w-4 h-4 text-slate-700" />
          </div>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-2">
            {formatKES(metrics.cashTotal)}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {cashPct}% of period revenue
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>M-Pesa Paybill Sales</span>
            <Smartphone className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="font-mono tabular-nums text-2xl font-bold text-emerald-700 mt-2">
            {formatKES(metrics.mpesaTotal)}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {formatKES(metrics.verifiedMpesaTotal)} verified · {metrics.pendingMpesaCount} pending
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Est. Gross Profit</span>
            <span className="font-mono tabular-nums text-xs font-semibold text-emerald-700">
              {metrics.marginPct.toFixed(1)}%
            </span>
          </div>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-2">
            {formatKES(metrics.grossProfit)}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            COGS {formatKES(metrics.totalCost)}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
          <div className="h-48 bg-slate-100 rounded animate-pulse" />
        </div>
      ) : periodSales.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <h3 className="font-display text-base font-bold text-slate-900">
            No sales recorded for this period yet
          </h3>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            Complete a checkout at the POS Counter to see live KES revenue, Cash vs M-Pesa Paybill
            charts, and profit margins update automatically.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('pos')}
              className="px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>Open POS Counter</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            {sales.length === 0 && (
              <button
                type="button"
                onClick={handleLoadSample}
                disabled={seeding}
                className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Database className="w-3.5 h-3.5" />
                <span>{seeding ? 'Loading Sample Data...' : 'Load Sample Shift Data'}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Hourly Revenue Chart */}
          <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Counter Sales Flow (7 AM – 7 PM EAT)
                </h2>
                <p className="text-xs text-slate-500">
                  Hourly breakdown comparing Cash vs M-Pesa Paybill collections
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-slate-700">
                  <span className="w-2.5 h-2.5 rounded-xs bg-slate-800 inline-block" />
                  Cash ({cashPct}%)
                </span>
                <span className="flex items-center gap-1.5 text-slate-700">
                  <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                  M-Pesa Paybill ({mpesaPct}%)
                </span>
              </div>
            </div>

            <div className="relative h-56 flex items-end gap-2 pt-6 pb-6 border-b border-slate-200">
              {hourlyBuckets.map((bucket) => {
                const total = bucket.cash + bucket.mpesa;
                const totalHeightPct = Math.max(
                  total > 0 ? 6 : 0,
                  Math.round((total / maxBucketTotal) * 100)
                );
                const mpesaHeightPct =
                  total > 0 ? Math.round((bucket.mpesa / total) * totalHeightPct) : 0;
                const cashHeightPct = totalHeightPct - mpesaHeightPct;
                const hourLabel =
                  bucket.hour === 12
                    ? '12p'
                    : bucket.hour > 12
                    ? `${bucket.hour - 12}p`
                    : `${bucket.hour}a`;

                return (
                  <div
                    key={bucket.hour}
                    onMouseEnter={() => setHoveredHour(bucket.hour)}
                    onMouseLeave={() => setHoveredHour(null)}
                    className="flex-1 h-full flex flex-col justify-end items-center relative group cursor-pointer"
                  >
                    {hoveredHour === bucket.hour && total > 0 && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full z-20 bg-slate-900 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap pointer-events-none shadow-md">
                        <p className="font-semibold">
                          {hourLabel} · {bucket.count} {bucket.count === 1 ? 'sale' : 'sales'}
                        </p>
                        <p className="font-mono tabular-nums text-slate-300">
                          Cash: {formatKES(bucket.cash)}
                        </p>
                        <p className="font-mono tabular-nums text-emerald-400">
                          M-Pesa: {formatKES(bucket.mpesa)}
                        </p>
                      </div>
                    )}

                    <div className="w-full max-w-[32px] h-full flex flex-col justify-end gap-0.5">
                      {mpesaHeightPct > 0 && (
                        <div
                          style={{ height: `${mpesaHeightPct}%` }}
                          className="w-full bg-emerald-600 rounded-t-sm transition-all"
                        />
                      )}
                      {cashHeightPct > 0 && (
                        <div
                          style={{ height: `${cashHeightPct}%` }}
                          className={`w-full bg-slate-800 ${
                            mpesaHeightPct === 0 ? 'rounded-t-sm' : ''
                          } transition-all`}
                        />
                      )}
                      {total === 0 && (
                        <div className="w-full h-1 bg-slate-100 rounded-sm" />
                      )}
                    </div>

                    <span className="absolute -bottom-5 text-[11px] font-mono text-slate-500">
                      {hourLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payment Mix & Recent Sales */}
          <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Payment Mix &amp; Stock Watch
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Live counter split and inventory alerts
              </p>

              <div className="mt-4">
                <div className="h-3 w-full rounded-md overflow-hidden bg-slate-100 flex">
                  <div
                    style={{ width: `${cashPct}%` }}
                    className="bg-slate-800 h-full transition-all"
                  />
                  <div
                    style={{ width: `${mpesaPct}%` }}
                    className="bg-emerald-600 h-full transition-all"
                  />
                </div>
                <div className="flex justify-between text-xs mt-2 font-mono tabular-nums">
                  <span className="text-slate-700 font-semibold">
                    Cash {formatKES(metrics.cashTotal)}
                  </span>
                  <span className="text-emerald-700 font-semibold">
                    M-Pesa {formatKES(metrics.mpesaTotal)}
                  </span>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-200 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Credit (Deni) Unpaid</span>
                  <span className="font-mono tabular-nums font-bold text-amber-700">
                    {formatKES(metrics.creditOutstanding)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Discounts Offered</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {formatKES(metrics.totalDiscounts)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Inventory Valuation (Cost)</span>
                  <span className="font-mono tabular-nums font-bold text-slate-900">
                    {formatKES(inventoryStats.costValuation)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Low Stock Items</span>
                  <span className="font-mono tabular-nums font-bold text-amber-700">
                    {inventoryStats.lowStock.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Out of Stock Items</span>
                  <span className="font-mono tabular-nums font-bold text-red-600">
                    {inventoryStats.outOfStock.length}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-semibold text-amber-700 hover:text-amber-800 cursor-pointer"
              >
                Export PDF Reports →
              </button>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
              >
                Manage Stock →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Grid: Recent Sales & Low Stock Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-slate-900">
              Latest Transactions in Period
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="text-xs font-semibold text-amber-700 hover:text-amber-800 cursor-pointer"
            >
              View full ledger →
            </button>
          </div>
          {periodSales.length === 0 ? (
            <p className="p-6 text-xs text-slate-500 text-center">
              No completed transactions in the selected period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Receipt</th>
                    <th className="py-2.5 px-4 font-semibold">Time</th>
                    <th className="py-2.5 px-4 font-semibold">Method / M-Pesa Code</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {periodSales.slice(0, 8).map((sale) => (
                    <tr key={sale.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                        {sale.receiptNumber}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500">
                        {formatKenyaTimeOnly(sale.createdAt)}
                      </td>
                      <td className="py-2.5 px-4">
                        {sale.paymentMethod === 'cash' ? (
                          <span className="text-slate-700 font-medium">Cash</span>
                        ) : sale.paymentMethod === 'credit' ? (
                          <span className="text-amber-700 font-semibold">
                            Credit (Deni){sale.mpesaCode ? ` · ${sale.mpesaCode}` : ''}
                          </span>
                        ) : (
                          <span className="font-mono font-semibold text-emerald-700">
                            Paybill · {sale.mpesaCode}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                        {formatKES(sale.totalAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <h2 className="font-display text-sm font-bold text-slate-900">
                Reorder Attention
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-semibold text-amber-700 hover:text-amber-800 cursor-pointer"
            >
              Restock items →
            </button>
          </div>
          {inventoryStats.lowStock.length === 0 && inventoryStats.outOfStock.length === 0 ? (
            <p className="p-6 text-xs text-slate-500 text-center">
              All active hardware items are above their reorder levels.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {[...inventoryStats.outOfStock, ...inventoryStats.lowStock]
                .slice(0, 8)
                .map((item) => (
                  <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{item.name}</p>
                      <p className="text-xs text-slate-500 font-mono">
                        {item.sku} · Reorder at {item.reorderLevel}
                      </p>
                    </div>
                    <span
                      className={`font-mono tabular-nums text-xs font-bold shrink-0 ${
                        item.stockQuantity <= 0 ? 'text-red-600' : 'text-amber-700'
                      }`}
                    >
                      {item.stockQuantity} {item.unit}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
