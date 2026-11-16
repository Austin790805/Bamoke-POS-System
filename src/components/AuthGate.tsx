import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { Hammer, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import { auth, googleProvider } from '../firebase';

interface AuthGateProps {
  connectionError: string | null;
}

export const AuthGate: React.FC<AuthGateProps> = ({ connectionError }) => {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in with Google.';
      setError(message);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-6 py-12">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-12">
        <div className="md:col-span-7 p-8 md:p-10 flex flex-col justify-between bg-slate-900 text-slate-100">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-lg bg-amber-600 flex items-center justify-center text-white">
                <Hammer className="w-5 h-5" />
              </div>
              <span className="font-display text-lg font-bold tracking-tight text-white">
                BAMOKE HARDWARE
              </span>
            </div>

            <h1 className="font-display text-3xl font-bold tracking-tight text-white leading-tight text-balance mb-4">
              Single-Counter Point of Sale &amp; M-Pesa Reconciliation
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed max-w-md">
              Built for Kenyan hardware retail counters. Search building materials manually, track
              live stock levels, record 10-character M-Pesa Paybill confirmation codes, and balance
              daily cash drawers.
            </p>
          </div>

          <div className="mt-10 pt-6 border-t border-slate-800 grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="font-semibold text-amber-400">Counter POS</p>
              <p className="text-slate-400 mt-1">Manual item search &amp; instant KES billing</p>
            </div>
            <div>
              <p className="font-semibold text-amber-400">Live Inventory</p>
              <p className="text-slate-400 mt-1">Auto-deduct stock &amp; low-stock alerts</p>
            </div>
            <div>
              <p className="font-semibold text-amber-400">Paybill Audit</p>
              <p className="text-slate-400 mt-1">10-char M-Pesa code verification</p>
            </div>
          </div>
        </div>

        <div className="md:col-span-5 p-8 md:p-10 flex flex-col justify-center bg-white">
          <div className="mb-6">
            <h2 className="font-display text-xl font-bold text-slate-900">
              Sign in to Counter Terminal
            </h2>
            <p className="text-sm text-slate-500 mt-1.5">
              Authenticate with your Google account to open your store workspace and sync inventory.
            </p>
          </div>

          {(connectionError || error) && (
            <div className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{connectionError || error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full py-3 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
          >
            <span>{signingIn ? 'Connecting to terminal...' : 'Sign in with Google'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <div className="mt-6 pt-5 border-t border-slate-100 flex items-start gap-2.5 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              All inventory counts, counter sales, and M-Pesa Paybill reconciliations are saved
              persistently per store account.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
