import React, { useMemo, useState } from 'react';
import {
  Search,
  Eye,
  X,
  AlertCircle,
  Ban,
  Printer,
  CheckCircle2,
} from 'lucide-react';
import {
  MPESA_CODE_REGEX,
  PaymentMethod,
  Product,
  Sale,
  SaleLineItem,
  StoreConfig,
  formatKES,
  formatKenyaDateTime,
} from '../types/pos';
import {
  fetchSaleLineItems,
  recordCreditRepayment,
  round2,
  voidSaleTransaction,
} from '../services/posService';

interface SalesLedgerViewProps {
  store: StoreConfig;
  ownerId: string;
  actorName: string;
  sales: Sale[];
  products: Product[];
  loading: boolean;
}

export const SalesLedgerView: React.FC<SalesLedgerViewProps> = ({
  store,
  ownerId,
  actorName,
  sales,
  products,
  loading,
}) => {
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod | 'open_deni'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'voided'>('all');

  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [lineItems, setLineItems] = useState<SaleLineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const [voidReason, setVoidReason] = useState('');
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  // Credit (Deni) Repayment Form State
  const [showRepayForm, setShowRepayForm] = useState(false);
  const [repayAmount, setRepayAmount] = useState('');
  const [repayMethod, setRepayMethod] = useState<'cash' | 'mpesa_paybill'>('cash');
  const [repayMpesaCode, setRepayMpesaCode] = useState('');
  const [repaying, setRepaying] = useState(false);
  const [repayError, setRepayError] = useState<string | null>(null);

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((sale) => {
      if (methodFilter === 'open_deni') {
        if (!(sale.status === 'completed' && (sale.creditBalance ?? 0) > 0)) return false;
      } else if (methodFilter !== 'all' && sale.paymentMethod !== methodFilter) {
        return false;
      }
      if (statusFilter !== 'all' && sale.status !== statusFilter) return false;
      if (!q) return true;
      return (
        sale.receiptNumber.toLowerCase().includes(q) ||
        sale.mpesaCode.toLowerCase().includes(q) ||
        sale.customerName.toLowerCase().includes(q) ||
        (sale.customerPhone || '').toLowerCase().includes(q) ||
        sale.itemsSummary.toLowerCase().includes(q)
      );
    });
  }, [sales, search, methodFilter, statusFilter]);

  const openSaleDetail = async (sale: Sale) => {
    setSelectedSale(sale);
    setShowVoidForm(false);
    setShowRepayForm(false);
    setVoidReason('');
    setVoidError(null);
    setRepayError(null);
    setRepayAmount(sale.creditBalance ? String(sale.creditBalance) : '');
    setRepayMethod('cash');
    setRepayMpesaCode('');
    setLoadingItems(true);
    try {
      const items = await fetchSaleLineItems(store.id, ownerId, sale.id);
      setLineItems(items);
    } catch {
      setLineItems([]);
    } finally {
      setLoadingItems(false);
    }
  };

  const handleVoidSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSale) return;
    setVoidError(null);
    if (!voidReason.trim()) {
      setVoidError('Enter a clear reason for voiding this sale.');
      return;
    }
    setVoiding(true);
    try {
      await voidSaleTransaction(store.id, ownerId, selectedSale, products, voidReason, actorName);
      setSelectedSale({
        ...selectedSale,
        status: 'voided',
        voidReason: voidReason.trim(),
      });
      setShowVoidForm(false);
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'Unable to void transaction.');
    } finally {
      setVoiding(false);
    }
  };

  const handleRecordRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSale) return;
    setRepayError(null);

    const amt = Number(repayAmount);
    const currentBal = selectedSale.creditBalance ?? 0;
    if (!Number.isFinite(amt) || amt <= 0 || amt > currentBal + 0.01) {
      setRepayError(`Enter a valid repayment between KES 1 and ${formatKES(currentBal)}.`);
      return;
    }

    const cleanCode = repayMpesaCode.trim().toUpperCase();
    if (repayMethod === 'mpesa_paybill' && !MPESA_CODE_REGEX.test(cleanCode)) {
      setRepayError('Enter a valid 10-character M-Pesa confirmation code.');
      return;
    }

    setRepaying(true);
    try {
      await recordCreditRepayment(store.id, selectedSale, amt, repayMethod, cleanCode, sales);
      const nextBal = Math.max(0, round2(currentBal - amt));
      setSelectedSale({
        ...selectedSale,
        cashAmount:
          repayMethod === 'cash' ? round2(selectedSale.cashAmount + amt) : selectedSale.cashAmount,
        mpesaAmount:
          repayMethod === 'mpesa_paybill'
            ? round2(selectedSale.mpesaAmount + amt)
            : selectedSale.mpesaAmount,
        mpesaCode: repayMethod === 'mpesa_paybill' ? cleanCode : selectedSale.mpesaCode,
        mpesaStatus: repayMethod === 'mpesa_paybill' ? 'pending' : selectedSale.mpesaStatus,
        creditBalance: nextBal,
        creditStatus: nextBal <= 0.01 ? 'settled' : 'partial',
      });
      setShowRepayForm(false);
      setRepayMpesaCode('');
    } catch (err) {
      setRepayError(err instanceof Error ? err.message : 'Unable to record Deni repayment.');
    } finally {
      setRepaying(false);
    }
  };

  const liveSelectedSale = useMemo(() => {
    if (!selectedSale) return null;
    return sales.find((s) => s.id === selectedSale.id) || selectedSale;
  }, [sales, selectedSale]);

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[230px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by receipt #, M-Pesa code, customer, phone, or item..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
          />
        </div>

        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value as 'all' | PaymentMethod | 'open_deni')}
          className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
          aria-label="Filter by payment method"
        >
          <option value="all">All Payment Methods</option>
          <option value="open_deni">Open Credit (Deni) Only</option>
          <option value="cash">Cash Only</option>
          <option value="mpesa_paybill">M-Pesa Paybill</option>
          <option value="split">Split Payment</option>
          <option value="credit">All Credit (Deni) Sales</option>
        </select>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'completed', label: 'Completed' },
              { id: 'voided', label: 'Voided' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-slate-800">No sales found</p>
            <p className="text-xs text-slate-500 mt-1">
              Transactions completed at the POS Counter appear here in real time.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">Receipt #</th>
                  <th className="py-3 px-4 font-semibold">Date &amp; Time (EAT)</th>
                  <th className="py-3 px-4 font-semibold">Customer &amp; Items</th>
                  <th className="py-3 px-4 font-semibold">Payment / M-Pesa / Deni</th>
                  <th className="py-3 px-4 font-semibold text-right">Net Total</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSales.map((sale) => {
                  const deniBal = sale.creditBalance ?? 0;
                  const discount = sale.discountAmount ?? 0;
                  return (
                    <tr key={sale.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {sale.receiptNumber}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {formatKenyaDateTime(sale.createdAt)}
                      </td>
                      <td className="py-3 px-4 max-w-[280px]">
                        <p className="font-semibold text-slate-900 truncate">
                          {sale.customerName}
                          {sale.customerPhone ? ` · ${sale.customerPhone}` : ''}
                        </p>
                        <p className="text-slate-500 truncate">{sale.itemsSummary}</p>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {sale.paymentMethod === 'cash' ? (
                          <span className="text-slate-700 font-medium">Cash</span>
                        ) : sale.paymentMethod === 'mpesa_paybill' ? (
                          <div>
                            <span className="font-mono font-bold text-emerald-700">
                              {sale.mpesaCode}
                            </span>
                            <span className="block text-[11px] text-slate-500 capitalize">
                              Paybill · {sale.mpesaStatus}
                            </span>
                          </div>
                        ) : sale.paymentMethod === 'split' ? (
                          <div>
                            <span className="font-mono font-bold text-slate-800">
                              Split · {sale.mpesaCode}
                            </span>
                            <span className="block text-[11px] text-slate-500 capitalize">
                              M-Pesa {sale.mpesaStatus}
                            </span>
                          </div>
                        ) : (
                          <div>
                            <span
                              className={`font-semibold ${
                                deniBal > 0 ? 'text-amber-700' : 'text-emerald-700'
                              }`}
                            >
                              {deniBal > 0
                                ? `Deni Bal: ${formatKES(deniBal)}`
                                : 'Deni Settled'}
                            </span>
                            {sale.mpesaCode && (
                              <span className="block font-mono text-[11px] text-slate-500">
                                M-Pesa: {sale.mpesaCode}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span className="font-mono tabular-nums font-bold text-slate-900">
                          {formatKES(sale.totalAmount)}
                        </span>
                        {discount > 0 && (
                          <span className="block font-mono tabular-nums text-[11px] text-emerald-700">
                            Disc: -{formatKES(discount)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {sale.status === 'voided' ? (
                          <span className="text-red-600 font-semibold">Voided</span>
                        ) : deniBal > 0 ? (
                          <span className="text-amber-700 font-semibold">Credit Open</span>
                        ) : (
                          <span className="text-emerald-700 font-medium">Completed</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openSaleDetail(sale)}
                          className="px-2.5 py-1.5 rounded-md border border-slate-200 hover:border-slate-400 text-slate-700 font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{deniBal > 0 && sale.status === 'completed' ? 'Manage' : 'View'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sale Detail & Deni Repayment Modal */}
      {liveSelectedSale && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Transaction {liveSelectedSale.receiptNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {formatKenyaDateTime(liveSelectedSale.createdAt)} · Cashier:{' '}
                  {liveSelectedSale.cashierName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSale(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close transaction detail"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div id="counter-slip-printable" className="p-5 space-y-4 text-xs overflow-y-auto">
              <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                <div>
                  <p className="font-semibold text-slate-900">
                    {liveSelectedSale.customerName}
                    {liveSelectedSale.customerPhone ? ` · ${liveSelectedSale.customerPhone}` : ''}
                  </p>
                  <p className="text-slate-500">
                    {store.name} · {store.location}
                  </p>
                </div>
                <span
                  className={`font-semibold ${
                    liveSelectedSale.status === 'voided'
                      ? 'text-red-600'
                      : (liveSelectedSale.creditBalance ?? 0) > 0
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                  }`}
                >
                  {liveSelectedSale.status === 'voided'
                    ? 'Voided Sale'
                    : (liveSelectedSale.creditBalance ?? 0) > 0
                    ? 'Credit (Deni) Open'
                    : 'Completed'}
                </span>
              </div>

              {liveSelectedSale.status === 'voided' && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800">
                  <strong>Void Reason:</strong> {liveSelectedSale.voidReason}
                </div>
              )}

              <div>
                <h4 className="font-semibold text-slate-700 mb-2">Purchased Items</h4>
                {loadingItems ? (
                  <div className="h-16 bg-slate-100 rounded animate-pulse" />
                ) : lineItems.length === 0 ? (
                  <p className="text-slate-600">{liveSelectedSale.itemsSummary}</p>
                ) : (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {lineItems.map((item) => (
                      <div key={item.id} className="px-3 py-2 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          <p className="font-mono text-slate-500">
                            {item.sku} · {item.quantity} {item.unit} × {formatKES(item.unitPrice)}
                          </p>
                        </div>
                        <span className="font-mono tabular-nums font-bold text-slate-900">
                          {formatKES(item.lineTotal)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                {(liveSelectedSale.discountAmount ?? 0) > 0 && (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal</span>
                      <span className="font-mono tabular-nums">
                        {formatKES(
                          liveSelectedSale.subtotalAmount ??
                            liveSelectedSale.totalAmount + (liveSelectedSale.discountAmount ?? 0)
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount Offered</span>
                      <span className="font-mono tabular-nums">
                        - {formatKES(liveSelectedSale.discountAmount ?? 0)}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-bold text-sm text-slate-900">
                  <span>Net Total</span>
                  <span className="font-mono tabular-nums">
                    {formatKES(liveSelectedSale.totalAmount)}
                  </span>
                </div>
                {liveSelectedSale.cashAmount > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Cash Paid</span>
                    <span className="font-mono tabular-nums">
                      {formatKES(liveSelectedSale.cashAmount)}
                    </span>
                  </div>
                )}
                {liveSelectedSale.mpesaAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>
                      M-Pesa Paybill ({liveSelectedSale.mpesaCode}) · {liveSelectedSale.mpesaStatus}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatKES(liveSelectedSale.mpesaAmount)}
                    </span>
                  </div>
                )}
                {(liveSelectedSale.creditBalance ?? 0) > 0 && (
                  <div className="flex justify-between text-amber-700 font-bold pt-1 border-t border-slate-200">
                    <span>Remaining Deni Balance</span>
                    <span className="font-mono tabular-nums">
                      {formatKES(liveSelectedSale.creditBalance ?? 0)}
                    </span>
                  </div>
                )}
                {liveSelectedSale.creditStatus === 'settled' && (
                  <div className="flex justify-between text-emerald-700 font-semibold pt-1 border-t border-slate-200">
                    <span>Credit (Deni) Status</span>
                    <span>Settled in Full</span>
                  </div>
                )}
              </div>

              {/* Record Deni Repayment Form */}
              {showRepayForm &&
                liveSelectedSale.status === 'completed' &&
                (liveSelectedSale.creditBalance ?? 0) > 0 && (
                  <form
                    onSubmit={handleRecordRepayment}
                    className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200 space-y-3"
                  >
                    <p className="font-semibold text-amber-950">Record Credit (Deni) Repayment</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          Amount Paid (KES)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={liveSelectedSale.creditBalance}
                          step="any"
                          value={repayAmount}
                          onChange={(e) => setRepayAmount(e.target.value)}
                          required
                          className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-white border border-amber-300 rounded-lg focus:outline-none focus:border-amber-600"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Method</label>
                        <select
                          value={repayMethod}
                          onChange={(e) =>
                            setRepayMethod(e.target.value as 'cash' | 'mpesa_paybill')
                          }
                          className="w-full px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg focus:outline-none focus:border-amber-600"
                        >
                          <option value="cash">Cash</option>
                          <option value="mpesa_paybill">M-Pesa Paybill</option>
                        </select>
                      </div>
                    </div>

                    {repayMethod === 'mpesa_paybill' && (
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          10-Char M-Pesa Confirmation Code
                        </label>
                        <input
                          type="text"
                          maxLength={10}
                          value={repayMpesaCode}
                          onChange={(e) =>
                            setRepayMpesaCode(
                              e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                            )
                          }
                          placeholder="e.g. UBK7H92M1P"
                          required
                          className="w-full px-3 py-1.5 font-mono font-bold uppercase tracking-widest bg-white border border-emerald-300 rounded-lg focus:outline-none focus:border-emerald-600"
                        />
                      </div>
                    )}

                    {repayError && (
                      <div className="flex items-start gap-1.5 text-red-700">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{repayError}</span>
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRepayForm(false)}
                        className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={repaying}
                        className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-60"
                      >
                        {repaying ? 'Saving...' : 'Confirm Repayment'}
                      </button>
                    </div>
                  </form>
                )}

              {showVoidForm && liveSelectedSale.status === 'completed' && (
                <form
                  onSubmit={handleVoidSale}
                  className="p-3.5 rounded-lg bg-red-50/70 border border-red-200 space-y-3"
                >
                  <label className="block font-semibold text-red-900">
                    Void Sale &amp; Restore Stock Reason
                  </label>
                  <input
                    type="text"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="e.g. Customer returned unopened bags at counter"
                    maxLength={240}
                    required
                    className="w-full px-3 py-2 bg-white border border-red-300 rounded-lg focus:outline-none focus:border-red-600"
                  />
                  {voidError && (
                    <div className="flex items-start gap-1.5 text-red-700">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{voidError}</span>
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowVoidForm(false)}
                      className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 font-semibold cursor-pointer"
                    >
                      Keep Sale
                    </button>
                    <button
                      type="submit"
                      disabled={voiding}
                      className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer disabled:opacity-60"
                    >
                      {voiding ? 'Voiding...' : 'Confirm Void & Restore Stock'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {liveSelectedSale.status === 'completed' &&
                  (liveSelectedSale.creditBalance ?? 0) > 0 &&
                  !showRepayForm && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowRepayForm(true);
                        setShowVoidForm(false);
                      }}
                      className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Record Deni Payment</span>
                    </button>
                  )}
                {liveSelectedSale.status === 'completed' && !showVoidForm && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowVoidForm(true);
                      setShowRepayForm(false);
                    }}
                    className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Void</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Slip</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSale(null)}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
