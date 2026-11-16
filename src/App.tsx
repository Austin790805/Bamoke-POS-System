import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { Menu, Plus, ShoppingCart } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType, testFirestoreConnection } from './firebase';
import {
  AppView,
  DailyReconciliation,
  Product,
  Sale,
  StockLog,
  StoreConfig,
  formatKES,
  getKenyaDateKey,
} from './types/pos';
import { ensureUserAndStore, seedSampleDayTransactions } from './services/posService';
import { AuthGate } from './components/AuthGate';
import { Sidebar } from './components/Sidebar';
import { PosCounterView } from './components/PosCounterView';
import { DailyRevenueView } from './components/DailyRevenueView';
import { InventoryView } from './components/InventoryView';
import { ReconciliationView } from './components/ReconciliationView';
import { SalesLedgerView } from './components/SalesLedgerView';
import { ReportsView } from './components/ReportsView';
import { StoreSettingsModal } from './components/StoreSettingsModal';

class PosErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 space-y-3">
            <h1 className="font-display text-lg font-bold text-slate-900">
              System Error Encountered
            </h1>
            <p className="text-xs text-slate-600 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
            >
              Reload POS Terminal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function PosShell() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [store, setStore] = useState<StoreConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [stockLogs, setStockLogs] = useState<StockLog[]>([]);
  const [reconciliations, setReconciliations] = useState<DailyReconciliation[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [activeView, setActiveView] = useState<AppView>('pos');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    testFirestoreConnection().then((ok) => {
      if (!ok) {
        setConnectionError('Unable to reach Firestore server. Check your network connection.');
      }
    });

    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setStore(null);
        setProducts([]);
        setSales([]);
        setStockLogs([]);
        setReconciliations([]);
        setDataLoading(false);
        setAuthReady(true);
        return;
      }

      setDataLoading(true);
      try {
        const initializedStore = await ensureUserAndStore(nextUser);
        setStore(initializedStore);
      } catch (err) {
        setConnectionError(err instanceof Error ? err.message : 'Failed to initialize store.');
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!authReady || !user || !store) return;

    const uid = user.uid;
    const storeId = store.id;

    const unsubStore = onSnapshot(
      doc(db, 'stores', storeId),
      (snap) => {
        if (snap.exists()) {
          setStore({ id: snap.id, ...(snap.data() as Omit<StoreConfig, 'id'>) });
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `stores/${storeId}`)
    );

    const unsubProducts = onSnapshot(
      query(collection(db, 'stores', storeId, 'products'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Product, 'id'>),
        }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(list);
        setDataLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `stores/${storeId}/products`)
    );

    const unsubSales = onSnapshot(
      query(collection(db, 'stores', storeId, 'sales'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Sale, 'id'>),
        }));
        list.sort(
          (a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())
        );
        setSales(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `stores/${storeId}/sales`)
    );

    const unsubLogs = onSnapshot(
      query(collection(db, 'stores', storeId, 'stockLogs'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StockLog, 'id'>),
        }));
        list.sort(
          (a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())
        );
        setStockLogs(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `stores/${storeId}/stockLogs`)
    );

    const unsubRecs = onSnapshot(
      query(collection(db, 'stores', storeId, 'reconciliations'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DailyReconciliation, 'id'>),
        }));
        list.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
        setReconciliations(list);
      },
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `stores/${storeId}/reconciliations`)
    );

    return () => {
      unsubStore();
      unsubProducts();
      unsubSales();
      unsubLogs();
      unsubRecs();
    };
  }, [authReady, user, store?.id]);

  const todayKey = getKenyaDateKey(new Date());

  const todayRevenue = useMemo(
    () =>
      sales
        .filter((s) => s.status === 'completed' && s.saleDateKey === todayKey)
        .reduce((sum, s) => sum + s.totalAmount, 0),
    [sales, todayKey]
  );

  const lowStockCount = useMemo(
    () => products.filter((p) => p.isActive && p.stockQuantity <= p.reorderLevel).length,
    [products]
  );

  const pendingMpesaCount = useMemo(
    () =>
      sales.filter(
        (s) => s.status === 'completed' && s.mpesaAmount > 0 && s.mpesaStatus === 'pending'
      ).length,
    [sales]
  );

  const openDeniCount = useMemo(
    () =>
      sales.filter((s) => s.status === 'completed' && (s.creditBalance ?? 0) > 0).length,
    [sales]
  );

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm font-medium text-slate-600">Loading Bamoke Hardware POS...</p>
      </div>
    );
  }

  if (!user || !store) {
    return <AuthGate connectionError={connectionError} />;
  }

  const cashierName = user.displayName || user.email?.split('@')[0] || 'Counter Operator';

  const viewTitles: Record<AppView, string> = {
    pos: 'POS Counter',
    dashboard: 'Daily Revenue Dashboard',
    inventory: 'Inventory Management',
    reconciliation: 'Payment Reconciliation',
    sales: 'Sales Ledger',
    reports: 'Business Reports',
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        store={store}
        userDisplayName={cashierName}
        userEmail={user.email || ''}
        lowStockCount={lowStockCount}
        pendingMpesaCount={pendingMpesaCount}
        openDeniCount={openDeniCount}
        onOpenSettings={() => setShowSettingsModal(true)}
        onSignOut={() => signOut(auth)}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: 3 clean zones */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-8 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 rounded-md text-slate-600 hover:bg-slate-100 cursor-pointer"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm whitespace-nowrap truncate">
              <span className="font-semibold text-slate-500 hidden sm:inline">
                BAMOKE HARDWARE POS SYSTEM
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-display font-bold text-slate-900 truncate">
                {viewTitles[activeView]}
              </h1>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-4 text-xs text-slate-500 whitespace-nowrap">
            <span>{store.location}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Today: <strong className="text-slate-900">{formatKES(todayRevenue)}</strong>
            </span>
          </div>

          <div className="shrink-0">
            {activeView === 'inventory' ? (
              <button
                type="button"
                onClick={() => setShowAddProductModal(true)}
                className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Item</span>
              </button>
            ) : activeView !== 'pos' ? (
              <button
                type="button"
                onClick={() => setActiveView('pos')}
                className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>POS Counter</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveView('dashboard')}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                Daily Revenue
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {activeView === 'pos' && (
            <PosCounterView
              store={store}
              ownerId={user.uid}
              cashierName={cashierName}
              products={products}
              sales={sales}
              loading={dataLoading}
            />
          )}

          {activeView === 'dashboard' && (
            <DailyRevenueView
              sales={sales}
              products={products}
              loading={dataLoading}
              onNavigate={setActiveView}
              onSeedSampleData={() =>
                seedSampleDayTransactions(store.id, user.uid, cashierName, products)
              }
            />
          )}

          {activeView === 'inventory' && (
            <InventoryView
              storeId={store.id}
              ownerId={user.uid}
              actorName={cashierName}
              products={products}
              stockLogs={stockLogs}
              loading={dataLoading}
              showAddModal={showAddProductModal}
              onCloseAddModal={() => setShowAddProductModal(false)}
              onOpenAddModal={() => setShowAddProductModal(true)}
            />
          )}

          {activeView === 'reconciliation' && (
            <ReconciliationView
              store={store}
              ownerId={user.uid}
              actorName={cashierName}
              sales={sales}
              reconciliations={reconciliations}
              loading={dataLoading}
            />
          )}

          {activeView === 'sales' && (
            <SalesLedgerView
              store={store}
              ownerId={user.uid}
              actorName={cashierName}
              sales={sales}
              products={products}
              loading={dataLoading}
            />
          )}

          {activeView === 'reports' && (
            <ReportsView
              store={store}
              sales={sales}
              products={products}
              loading={dataLoading}
            />
          )}
        </main>
      </div>

      {showSettingsModal && (
        <StoreSettingsModal store={store} onClose={() => setShowSettingsModal(false)} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <PosErrorBoundary>
      <PosShell />
    </PosErrorBoundary>
  );
}
