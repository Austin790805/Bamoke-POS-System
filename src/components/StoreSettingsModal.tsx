import React, { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { StoreConfig } from '../types/pos';
import { updateStoreSettings } from '../services/posService';

interface StoreSettingsModalProps {
  store: StoreConfig;
  onClose: () => void;
}

export const StoreSettingsModal: React.FC<StoreSettingsModalProps> = ({ store, onClose }) => {
  const [name, setName] = useState(store.name);
  const [paybillNumber, setPaybillNumber] = useState(store.paybillNumber);
  const [accountReference, setAccountReference] = useState(store.accountReference);
  const [location, setLocation] = useState(store.location);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || paybillNumber.trim().length < 4 || !accountReference.trim()) {
      setError('Store name, Paybill business number (4+ chars), and account reference are required.');
      return;
    }
    setSaving(true);
    try {
      await updateStoreSettings(store.id, {
        name,
        paybillNumber,
        accountReference,
        location,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save store settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-slate-900">
            Counter &amp; Paybill Settings
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Store Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                M-Pesa Paybill Business No.
              </label>
              <input
                type="text"
                value={paybillNumber}
                onChange={(e) => setPaybillNumber(e.target.value)}
                maxLength={20}
                required
                className="w-full px-3 py-2 font-mono font-semibold border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Account Reference</label>
              <input
                type="text"
                value={accountReference}
                onChange={(e) => setAccountReference(e.target.value.toUpperCase())}
                maxLength={40}
                required
                className="w-full px-3 py-2 font-mono font-semibold uppercase border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Store Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={120}
              required
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold cursor-pointer disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
