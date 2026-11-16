import React, { useMemo, useState } from 'react';
import {
  Search,
  CheckCircle2,
  Flag,
  Clock,
  Lock,
  AlertCircle,
} from 'lucide-react';
import {
  DailyReconciliation,
  Sale,
  StoreConfig,
  formatKES,
  formatKenyaDateTime,
  getKenyaDateKey,
} from '../types/pos';
import {
  closeDailyShiftReconciliation,
  updateMpesaStatus,
} from '../services/posService';

interface ReconciliationViewProps {
  store: StoreConfig;
  ownerId: string;
  actorName: string;
  sales: Sale[];
  reconciliations: DailyReconciliation[];
  loading: boolean;
}

type MpesaFilter = 'all' | 'pending' | 'verified' | 'flagged';

export const ReconciliationView: React.FC<ReconciliationViewProps> = ({
  store,
  ownerId,
  actorName,
  sales,
  reconciliations,
  loading,
}) => {
  const todayKey = getKenyaDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);
  const [mpesaFilter, setMpesaFilter] = useState<MpesaFilter>('all');
  const [codeSearch, setCodeSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  // Daily Shift Cash Drawer Close State
  const [countedCashInput, setCountedCashInput] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [closingShift, setClosingShift] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [shiftSuccess, setShiftSuccess] = useState<string | null>(null);

  const dayCompletedSales = useMemo(
    () => sales.filter((s) => s.status === 'completed' && s.saleDateKey === selectedDate),
    [sales, selectedDate]
  );

  const mpesaSales = useMemo(() => {
    const q = codeSearch.trim().toUpperCase();
    return sales.filter((s) => {
      if (s.status !== 'completed' || s.mpesaAmount <= 0) return false;
      if (mpesaFilter !== 'all' && s.mpesaStatus !== mpesaFilter) return false;
      if (!q) return true;
      return (
        s.mpesaCode.includes(q) ||
        s.receiptNumber.toUpperCase().includes(q) ||
        s.customerName.toUpperCase().includes(q)
      );
    });
  }, [sales, mpesaFilter, codeSearch]);

  const shiftMetrics = useMemo(() => {
    let expectedCash = 0;
    let expectedMpesa = 0;
    let verifiedMpesa = 0;
    let pendingMpesaCount = 0;
    let totalRevenue = 0;

    for (const s of dayCompletedSales) {
      expectedCash += s.cashAmount;
      expectedMpesa += s.mpesaAmount;
      totalRevenue += s.totalAmount;
      if (s.mpesaAmount > 0) {
        if (s.mpesaStatus === 'verified') verifiedMpesa += s.mpesaAmount;
        if (s.mpesaStatus === 'pending') pendingMpesaCount += 1;
      }
    }

    return {
      expectedCash: Number(expectedCash.toFixed(2)),
      expectedMpesa: Number(expectedMpesa.toFixed(2)),
      verifiedMpesa: Number(verifiedMpesa.toFixed(2)),
      pendingMpesaCount,
      totalRevenue: Number(totalRevenue.toFixed(2)),
    };
  }, [dayCompletedSales]);

  const existingDayRec = useMemo(
    () => reconciliations.find((r) => r.dateKey === selectedDate),
    [reconciliations, selectedDate]
  );

  const parsedCountedCash =
    countedCashInput === '' ? shiftMetrics.expectedCash : Number(countedCashInput) || 0;
  const cashVariance = Number((parsedCountedCash - shiftMetrics.expectedCash).toFixed(2));

  const handleVerifyMpesa = async (
    sale: Sale,
    status: 'verified' | 'flagged' | 'pending'
  ) => {
    setUpdatingId(sale.id);
    try {
      const note =
        noteInputs[sale.id] !== undefined
          ? noteInputs[sale.id]
          : status === 'verified'
          ? 'Matched Paybill SMS statement'
          : sale.mpesaNote;
      await updateMpesaStatus(store.id, sale.id, status, note);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setShiftError(null);
    setShiftSuccess(null);

    if (existingDayRec?.status === 'closed') {
      setShiftError(`Shift for ${selectedDate} is already closed and locked.`);
      return;
    }

    if (countedCashInput !== '' && (!Number.isFinite(Number(countedCashInput)) || Number(countedCashInput) < 0)) {
      setShiftError('Counted cash in drawer must be a valid non-negative KES amount.');
      return;
    }

    setClosingShift(true);
    try {
      await closeDailyShiftReconciliation(store.id, ownerId, {
        dateKey: selectedDate,
        expectedCash: shiftMetrics.expectedCash,
        countedCash: parsedCountedCash,
        expectedMpesa: shiftMetrics.expectedMpesa,
        verifiedMpesa: shiftMetrics.verifiedMpesa,
        pendingMpesaCount: shiftMetrics.pendingMpesaCount,
        totalRevenue: shiftMetrics.totalRevenue,
        notes: shiftNotes,
        closedBy: actorName,
        existingRec: existingDayRec,
      });
      setShiftSuccess(`Shift reconciliation for ${selectedDate} closed and archived.`);
      setCountedCashInput('');
      setShiftNotes('');
    } catch (err) {
      setShiftError(err instanceof Error ? err.message : 'Unable to close daily shift.');
    } finally {
      setClosingShift(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Grid: M-Pesa Paybill Verification Queue & Daily Shift Drawer Balance */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: M-Pesa Paybill Code Reconciliation */}
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                M-Pesa Paybill Confirmation Reconciliation
              </h2>
              <p className="text-xs text-slate-500">
                Paybill {store.paybillNumber} · Match each 10-character M-Pesa code against your
                Safaricom statement
              </p>
            </div>
          </div>

          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3 bg-slate-50/50">
            <div className="relative flex-1 min-w-[210px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={codeSearch}
                onChange={(e) => setCodeSearch(e.target.value)}
                placeholder="Search 10-char M-Pesa code or receipt..."
                className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'pending', label: 'Pending' },
                  { id: 'verified', label: 'Verified' },
                  { id: 'flagged', label: 'Flagged' },
                ] as { id: MpesaFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMpesaFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                    mpesaFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-5 space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : mpesaSales.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-semibold text-slate-800">
                No M-Pesa Paybill transactions match this filter
              </p>
              <p className="text-xs text-slate-500 mt-1">
                When a checkout uses M-Pesa Paybill or Split payment, its 10-character code appears
                here for verification.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">M-Pesa Code</th>
                    <th className="py-2.5 px-4 font-semibold">Receipt &amp; Time</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Paybill Amt</th>
                    <th className="py-2.5 px-4 font-semibold">Status</th>
                    <th className="py-2.5 px-4 font-semibold">Reconciliation Note</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Verify</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mpesaSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-bold tracking-wider text-slate-900 whitespace-nowrap">
                        {sale.mpesaCode}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <p className="font-mono font-semibold text-slate-800">
                          {sale.receiptNumber}
                        </p>
                        <p className="text-slate-500">{formatKenyaDateTime(sale.createdAt)}</p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                        {formatKES(sale.mpesaAmount)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {sale.mpesaStatus === 'verified' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Verified</span>
                          </span>
                        ) : sale.mpesaStatus === 'flagged' ? (
                          <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                            <Flag className="w-3.5 h-3.5" />
                            <span>Flagged</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Pending</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 min-w-[160px]">
                        <input
                          type="text"
                          value={
                            noteInputs[sale.id] !== undefined
                              ? noteInputs[sale.id]
                              : sale.mpesaNote
                          }
                          onChange={(e) =>
                            setNoteInputs((prev) => ({ ...prev, [sale.id]: e.target.value }))
                          }
                          placeholder="Add SMS match note..."
                          maxLength={240}
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:border-amber-600"
                        />
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {sale.mpesaStatus !== 'verified' && (
                            <button
                              type="button"
                              disabled={updatingId === sale.id}
                              onClick={() => handleVerifyMpesa(sale, 'verified')}
                              className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-50"
                            >
                              Verify
                            </button>
                          )}
                          {sale.mpesaStatus !== 'flagged' && (
                            <button
                              type="button"
                              disabled={updatingId === sale.id}
                              onClick={() => handleVerifyMpesa(sale, 'flagged')}
                              className="px-2.5 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 font-semibold cursor-pointer disabled:opacity-50"
                            >
                              Flag
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Daily Cash Drawer & Shift Close */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Daily Cash &amp; Shift Close
              </h2>
              <p className="text-xs text-slate-500">Balance drawer &amp; lock shift</p>
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setShiftError(null);
                setShiftSuccess(null);
              }}
              className="px-2.5 py-1 text-xs font-mono border border-slate-200 rounded-md bg-white focus:outline-none focus:border-amber-600"
            />
          </div>

          <form onSubmit={handleCloseShift} className="p-5 space-y-4 text-xs">
            <div className="space-y-2 pb-3 border-b border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-600">Total Shift Revenue</span>
                <span className="font-mono tabular-nums font-bold text-slate-900">
                  {formatKES(shiftMetrics.totalRevenue)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Expected Cash in Drawer</span>
                <span className="font-mono tabular-nums font-bold text-slate-900">
                  {formatKES(shiftMetrics.expectedCash)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Expected M-Pesa Paybill</span>
                <span className="font-mono tabular-nums font-semibold text-emerald-700">
                  {formatKES(shiftMetrics.expectedMpesa)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Verified M-Pesa Total</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {formatKES(shiftMetrics.verifiedMpesa)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Unverified M-Pesa Codes</span>
                <span
                  className={`font-mono tabular-nums font-bold ${
                    shiftMetrics.pendingMpesaCount > 0 ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  {shiftMetrics.pendingMpesaCount}
                </span>
              </div>
            </div>

            {existingDayRec?.status === 'closed' ? (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Lock className="w-4 h-4 text-emerald-600" />
                  <span>Shift Closed for {existingDayRec.dateKey}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Counted Cash</span>
                  <span className="font-mono tabular-nums font-bold text-slate-900">
                    {formatKES(existingDayRec.countedCash)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Cash Variance</span>
                  <span
                    className={`font-mono tabular-nums font-bold ${
                      existingDayRec.cashVariance === 0
                        ? 'text-emerald-700'
                        : existingDayRec.cashVariance > 0
                        ? 'text-amber-700'
                        : 'text-red-600'
                    }`}
                  >
                    {existingDayRec.cashVariance >= 0
                      ? `+${formatKES(existingDayRec.cashVariance)}`
                      : formatKES(existingDayRec.cashVariance)}
                  </span>
                </div>
                <p className="text-slate-500 pt-1">Closed by {existingDayRec.closedBy}</p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Physical Cash Counted in Drawer (KES)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={countedCashInput}
                    onChange={(e) => setCountedCashInput(e.target.value)}
                    placeholder={String(shiftMetrics.expectedCash)}
                    className="w-full px-3 py-2 font-mono tabular-nums text-sm font-bold border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  />
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Cash Drawer Variance</span>
                  <span
                    className={`font-mono tabular-nums text-sm font-bold ${
                      cashVariance === 0
                        ? 'text-emerald-700'
                        : cashVariance > 0
                        ? 'text-amber-700'
                        : 'text-red-600'
                    }`}
                  >
                    {cashVariance === 0
                      ? 'Balanced (KES 0)'
                      : cashVariance > 0
                      ? `Over +${formatKES(cashVariance)}`
                      : `Short ${formatKES(cashVariance)}`}
                  </span>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Shift Reconciliation Notes
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={shiftNotes}
                    onChange={(e) => setShiftNotes(e.target.value)}
                    placeholder="Optional notes on drawer variance or pending M-Pesa codes..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  />
                </div>

                {shiftError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-red-800">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{shiftError}</span>
                  </div>
                )}

                {shiftSuccess && (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2 text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{shiftSuccess}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={closingShift}
                  className="w-full py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold cursor-pointer disabled:opacity-60"
                >
                  {closingShift ? 'Closing Shift...' : `Close & Lock Shift (${selectedDate})`}
                </button>
              </>
            )}
          </form>
        </div>
      </div>

      {/* Closed Shift Archive */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="font-display text-sm font-bold text-slate-900">
            Closed Daily Shift Records
          </h2>
        </div>
        {reconciliations.length === 0 ? (
          <p className="p-6 text-xs text-slate-500 text-center">
            No daily shift reconciliations have been closed yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Date (EAT)</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Expected Cash</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Counted Cash</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Variance</th>
                  <th className="py-2.5 px-4 font-semibold text-right">M-Pesa Paybill</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Total Revenue</th>
                  <th className="py-2.5 px-4 font-semibold">Closed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reconciliations.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                      {rec.dateKey}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {formatKES(rec.expectedCash)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatKES(rec.countedCash)}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums font-bold ${
                        rec.cashVariance === 0
                          ? 'text-emerald-700'
                          : rec.cashVariance > 0
                          ? 'text-amber-700'
                          : 'text-red-600'
                      }`}
                    >
                      {rec.cashVariance >= 0
                        ? `+${formatKES(rec.cashVariance)}`
                        : formatKES(rec.cashVariance)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700">
                      {formatKES(rec.expectedMpesa)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatKES(rec.totalRevenue)}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{rec.closedBy}</td>
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
