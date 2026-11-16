import React from 'react';
import {
  ShoppingCart,
  BarChart3,
  Boxes,
  CheckSquare,
  ReceiptText,
  FileBarChart2,
  Settings,
  LogOut,
  Hammer,
  X,
} from 'lucide-react';
import { AppView, StoreConfig } from '../types/pos';

interface SidebarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  store: StoreConfig;
  userDisplayName: string;
  userEmail: string;
  lowStockCount: number;
  pendingMpesaCount: number;
  openDeniCount: number;
  onOpenSettings: () => void;
  onSignOut: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onSelectView,
  store,
  userDisplayName,
  userEmail,
  lowStockCount,
  pendingMpesaCount,
  openDeniCount,
  onOpenSettings,
  onSignOut,
  mobileOpen,
  onCloseMobile,
}) => {
  const navItems: {
    id: AppView;
    label: string;
    icon: React.ReactNode;
    counter?: number;
    counterTone?: 'amber' | 'neutral';
  }[] = [
    { id: 'pos', label: 'POS Counter', icon: <ShoppingCart className="w-4 h-4 shrink-0" /> },
    { id: 'dashboard', label: 'Daily Revenue', icon: <BarChart3 className="w-4 h-4 shrink-0" /> },
    {
      id: 'inventory',
      label: 'Inventory',
      icon: <Boxes className="w-4 h-4 shrink-0" />,
      counter: lowStockCount > 0 ? lowStockCount : undefined,
      counterTone: 'amber',
    },
    {
      id: 'reconciliation',
      label: 'Reconciliation',
      icon: <CheckSquare className="w-4 h-4 shrink-0" />,
      counter: pendingMpesaCount > 0 ? pendingMpesaCount : undefined,
      counterTone: 'amber',
    },
    {
      id: 'sales',
      label: 'Sales Ledger',
      icon: <ReceiptText className="w-4 h-4 shrink-0" />,
      counter: openDeniCount > 0 ? openDeniCount : undefined,
      counterTone: 'amber',
    },
    { id: 'reports', label: 'Reports', icon: <FileBarChart2 className="w-4 h-4 shrink-0" /> },
  ];

  const handleNav = (id: AppView) => {
    onSelectView(id);
    onCloseMobile();
  };

  const content = (
    <aside className="w-[248px] h-full bg-slate-900 text-slate-200 flex flex-col justify-between border-r border-slate-800 select-none">
      <div>
        <div className="h-14 px-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-amber-600 flex items-center justify-center text-white shrink-0">
              <Hammer className="w-4 h-4" />
            </div>
            <span className="font-display font-bold text-sm tracking-tight text-white whitespace-nowrap truncate">
              BAMOKE HARDWARE
            </span>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="px-3 py-4 space-y-1" aria-label="Main navigation">
          {navItems.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.counter !== undefined && (
                  <span
                    className={`font-mono tabular-nums text-xs font-semibold px-1.5 py-0.5 rounded ${
                      active
                        ? 'bg-amber-700 text-white'
                        : 'bg-slate-800 text-amber-400'
                    }`}
                  >
                    {item.counter}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mx-3 mt-4 p-3.5 rounded-lg bg-slate-800/70 border border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300">M-Pesa Paybill</span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-xs text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Business No.</span>
              <span className="font-mono tabular-nums font-semibold text-white">
                {store.paybillNumber}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Account</span>
              <span className="font-mono font-semibold text-slate-200 truncate max-w-[110px]">
                {store.accountReference}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-slate-800">
        <div className="px-2 py-2 mb-1">
          <p className="text-xs font-semibold text-white truncate">{userDisplayName}</p>
          <p className="text-xs text-slate-400 truncate">{userEmail}</p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block h-screen sticky top-0 shrink-0">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
};
