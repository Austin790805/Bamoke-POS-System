import React, { useMemo, useState } from 'react';
import { FileDown, FileSpreadsheet, Calendar } from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  Product,
  Sale,
  StoreConfig,
  formatKES,
  getKenyaDateKey,
} from '../types/pos';
import {
  BusinessReportSummary,
  ReportPeriodType,
  exportBusinessReportPDF,
} from '../utils/pdfReport';

interface ReportsViewProps {
  store: StoreConfig;
  sales: Sale[];
  products: Product[];
  loading: boolean;
}

const REPORT_OPTIONS: { value: ReportPeriodType; label: string; description: string }[] = [
  { value: 'daily', label: 'Daily Report', description: 'Single selected day operations' },
  { value: 'weekly', label: 'Weekly Report (Last 7 Days)', description: 'Rolling 7-day window' },
  { value: 'monthly', label: 'Monthly Report (Last 30 Days)', description: 'Rolling 30-day window' },
  {
    value: 'quarterly',
    label: 'Quarterly Report (Last 4 Months)',
    description: 'Rolling 4-month window',
  },
  {
    value: 'semi_annually',
    label: 'Semi-Annual Report (Last 6 Months)',
    description: 'Rolling 6-month window',
  },
  {
    value: 'annually',
    label: 'Annual Report (Last 12 Months)',
    description: 'Rolling 12-month window',
  },
];

function computeDateRange(
  periodType: ReportPeriodType,
  dailyDate: string
): { startDateKey: string; endDateKey: string } {
  if (periodType === 'daily') {
    return { startDateKey: dailyDate, endDateKey: dailyDate };
  }

  const now = new Date();
  const endDateKey = getKenyaDateKey(now);
  const [y, m, d] = endDateKey.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));

  if (periodType === 'weekly') {
    anchor.setUTCDate(anchor.getUTCDate() - 6);
  } else if (periodType === 'monthly') {
    anchor.setUTCDate(anchor.getUTCDate() - 29);
  } else if (periodType === 'quarterly') {
    anchor.setUTCMonth(anchor.getUTCMonth() - 4);
    anchor.setUTCDate(anchor.getUTCDate() + 1);
  } else if (periodType === 'semi_annually') {
    anchor.setUTCMonth(anchor.getUTCMonth() - 6);
    anchor.setUTCDate(anchor.getUTCDate() + 1);
  } else {
    anchor.setUTCMonth(anchor.getUTCMonth() - 12);
    anchor.setUTCDate(anchor.getUTCDate() + 1);
  }

  const startDateKey = anchor.toISOString().slice(0, 10);
  return { startDateKey, endDateKey };
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  store,
  sales,
  products,
  loading,
}) => {
  const todayKey = getKenyaDateKey(new Date());
  const [periodType, setPeriodType] = useState<ReportPeriodType>('daily');
  const [dailyDate, setDailyDate] = useState<string>(todayKey);

  const { startDateKey, endDateKey } = useMemo(
    () => computeDateRange(periodType, dailyDate),
    [periodType, dailyDate]
  );

  const periodSales = useMemo(() => {
    return sales.filter(
      (s) => s.saleDateKey >= startDateKey && s.saleDateKey <= endDateKey
    );
  }, [sales, startDateKey, endDateKey]);

  const reportSummary: BusinessReportSummary = useMemo(() => {
    const completed = periodSales.filter((s) => s.status === 'completed');
    const voided = periodSales.filter((s) => s.status === 'voided');

    let grossSales = 0;
    let totalDiscounts = 0;
    let netRevenue = 0;
    let totalCost = 0;
    let cashCollected = 0;
    let mpesaCollected = 0;
    let mpesaVerified = 0;
    let mpesaPendingCount = 0;
    let creditIssued = 0;
    let creditOutstanding = 0;

    const itemTally = new Map<string, { name: string; qtySold: number; revenueEstimate: number }>();
    const priceByName = new Map(products.map((p) => [p.name, p.sellingPrice]));

    for (const s of completed) {
      const discount = s.discountAmount ?? 0;
      const subtotal = s.subtotalAmount ?? s.totalAmount + discount;
      grossSales += subtotal;
      totalDiscounts += discount;
      netRevenue += s.totalAmount;
      totalCost += s.totalCost;
      cashCollected += s.cashAmount;
      mpesaCollected += s.mpesaAmount;
      creditIssued += s.creditAmount ?? 0;
      creditOutstanding += s.creditBalance ?? 0;

      if (s.mpesaAmount > 0) {
        if (s.mpesaStatus === 'verified') mpesaVerified += s.mpesaAmount;
        if (s.mpesaStatus === 'pending') mpesaPendingCount += 1;
      }

      // Parse itemsSummary ("Name × qty, Name2 × qty2") for fast client-side top-item aggregation
      const parts = s.itemsSummary.split(', ');
      for (const part of parts) {
        const sepIdx = part.lastIndexOf(' × ');
        if (sepIdx > 0) {
          const itemName = part.slice(0, sepIdx).trim();
          const qty = Number(part.slice(sepIdx + 3)) || 0;
          if (qty > 0) {
            const unitPrice = priceByName.get(itemName) ?? 0;
            const prev = itemTally.get(itemName) || {
              name: itemName,
              qtySold: 0,
              revenueEstimate: 0,
            };
            prev.qtySold += qty;
            prev.revenueEstimate += qty * unitPrice;
            itemTally.set(itemName, prev);
          }
        }
      }
    }

    const grossProfit = netRevenue - totalCost;
    const marginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

    const activeProducts = products.filter((p) => p.isActive);
    const totalUnitsInStock = activeProducts.reduce((sum, p) => sum + p.stockQuantity, 0);
    const inventoryCostValue = activeProducts.reduce(
      (sum, p) => sum + p.costPrice * p.stockQuantity,
      0
    );
    const inventoryRetailValue = activeProducts.reduce(
      (sum, p) => sum + p.sellingPrice * p.stockQuantity,
      0
    );
    const lowStockCount = activeProducts.filter(
      (p) => p.stockQuantity > 0 && p.stockQuantity <= p.reorderLevel
    ).length;
    const outOfStockCount = activeProducts.filter((p) => p.stockQuantity <= 0).length;

    const categoryBreakdown = PRODUCT_CATEGORIES.map((category) => {
      const catItems = activeProducts.filter((p) => p.category === category);
      return {
        category,
        skuCount: catItems.length,
        stockUnits: catItems.reduce((s, p) => s + p.stockQuantity, 0),
        costValue: catItems.reduce((s, p) => s + p.costPrice * p.stockQuantity, 0),
        retailValue: catItems.reduce((s, p) => s + p.sellingPrice * p.stockQuantity, 0),
      };
    });

    const topItems = Array.from(itemTally.values()).sort(
      (a, b) => b.revenueEstimate - a.revenueEstimate || b.qtySold - a.qtySold
    );

    const selectedOption = REPORT_OPTIONS.find((o) => o.value === periodType)!;

    return {
      periodType,
      periodLabel: selectedOption.label,
      startDateKey,
      endDateKey,
      completedCount: completed.length,
      voidedCount: voided.length,
      grossSales,
      totalDiscounts,
      netRevenue,
      totalCost,
      grossProfit,
      marginPct,
      cashCollected,
      mpesaCollected,
      mpesaVerified,
      mpesaPendingCount,
      creditIssued,
      creditOutstanding,
      activeSkus: activeProducts.length,
      totalUnitsInStock,
      inventoryCostValue,
      inventoryRetailValue,
      lowStockCount,
      outOfStockCount,
      categoryBreakdown,
      topItems,
    };
  }, [periodSales, products, periodType, startDateKey, endDateKey]);

  const handleDownloadPdf = () => {
    exportBusinessReportPDF(store, reportSummary, periodSales, products);
  };

  return (
    <div className="space-y-6">
      {/* Report Generator Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="report-period-select"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Select Business Report Period
            </label>
            <select
              id="report-period-select"
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as ReportPeriodType)}
              className="min-w-[260px] px-3.5 py-2.5 text-sm font-semibold bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-600 text-slate-900"
            >
              {REPORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {periodType === 'daily' && (
            <div>
              <label
                htmlFor="report-daily-date"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Report Date (EAT)
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="report-daily-date"
                  type="date"
                  value={dailyDate}
                  onChange={(e) => setDailyDate(e.target.value || todayKey)}
                  className="pl-9 pr-3 py-2.5 text-xs font-mono font-semibold bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                />
              </div>
            </div>
          )}

          <div className="pb-1 text-xs text-slate-500">
            <span className="block font-medium text-slate-700">Date Window</span>
            <span className="font-mono tabular-nums">
              {startDateKey === endDateKey
                ? startDateKey
                : `${startDateKey} to ${endDateKey}`}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={loading}
          className="px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <FileDown className="w-4 h-4" />
          <span>Download PDF Report</span>
        </button>
      </div>

      {/* Executive Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Net Sales Revenue</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1.5">
            {formatKES(reportSummary.netRevenue)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Gross {formatKES(reportSummary.grossSales)} · Discounts{' '}
            {formatKES(reportSummary.totalDiscounts)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Gross Profit &amp; Margin</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-emerald-700 mt-1.5">
            {formatKES(reportSummary.grossProfit)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {reportSummary.marginPct.toFixed(1)}% margin · COGS {formatKES(reportSummary.totalCost)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Cash &amp; M-Pesa Collected</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1.5">
            {formatKES(reportSummary.cashCollected + reportSummary.mpesaCollected)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Cash {formatKES(reportSummary.cashCollected)} · Paybill{' '}
            {formatKES(reportSummary.mpesaCollected)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Credit (Deni) Outstanding</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-amber-700 mt-1.5">
            {formatKES(reportSummary.creditOutstanding)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Issued {formatKES(reportSummary.creditIssued)} · {reportSummary.completedCount} sales
          </p>
        </div>
      </div>

      {/* Category Inventory Snapshot & Top Selling Items */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900">
                Inventory Valuation by Category
              </h2>
              <p className="text-xs text-slate-500">
                {reportSummary.activeSkus} active SKUs · Cost{' '}
                {formatKES(reportSummary.inventoryCostValue)} · Retail{' '}
                {formatKES(reportSummary.inventoryRetailValue)}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Category</th>
                  <th className="py-2.5 px-4 font-semibold text-right">SKUs</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Units</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Cost Value</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Retail Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportSummary.categoryBreakdown.map((cat) => (
                  <tr key={cat.category} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{cat.category}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {cat.skuCount}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {cat.stockUnits.toFixed(2).replace(/\.00$/, '')}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {formatKES(cat.costValue)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatKES(cat.retailValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="font-display text-sm font-bold text-slate-900">
              Top Hardware Items in Period
            </h2>
            <p className="text-xs text-slate-500">Ranked by estimated sales volume</p>
          </div>
          {reportSummary.topItems.length === 0 ? (
            <div className="p-8 text-center">
              <FileSpreadsheet className="w-7 h-7 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-700">
                No completed sales in this window
              </p>
              <p className="text-xs text-slate-500 mt-1">
                You can still export this report as a PDF with your current inventory valuation.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Item</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Qty Sold</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Est. Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportSummary.topItems.slice(0, 10).map((item) => (
                    <tr key={item.name} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-medium text-slate-900">{item.name}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                        {item.qtySold.toFixed(2).replace(/\.00$/, '')}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                        {formatKES(item.revenueEstimate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Period Transactions Breakdown */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-slate-900">
            Transactions Included in Report ({periodSales.length})
          </h2>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {reportSummary.completedCount} completed · {reportSummary.voidedCount} voided
          </span>
        </div>
        {periodSales.length === 0 ? (
          <p className="p-8 text-xs text-slate-500 text-center">
            No transactions recorded between {startDateKey} and {endDateKey}.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Receipt</th>
                  <th className="py-2.5 px-4 font-semibold">Date</th>
                  <th className="py-2.5 px-4 font-semibold">Customer</th>
                  <th className="py-2.5 px-4 font-semibold">Payment</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Discount</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Net Total</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Deni Bal.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {periodSales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {s.receiptNumber}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {s.saleDateKey}
                    </td>
                    <td className="py-2.5 px-4 text-slate-900">{s.customerName}</td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="capitalize text-slate-700">
                        {s.paymentMethod.replace('_', ' ')}
                      </span>
                      {s.mpesaCode && (
                        <span className="ml-1.5 font-mono text-emerald-700 font-semibold">
                          ({s.mpesaCode})
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {formatKES(s.discountAmount ?? 0)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                      {s.status === 'voided' ? (
                        <span className="text-red-600">Voided</span>
                      ) : (
                        formatKES(s.totalAmount)
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-amber-700 whitespace-nowrap">
                      {(s.creditBalance ?? 0) > 0 ? formatKES(s.creditBalance ?? 0) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
