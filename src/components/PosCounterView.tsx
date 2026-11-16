import React, { useMemo, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Banknote,
  Smartphone,
  Split,
  BookOpenCheck,
  CheckCircle2,
  AlertCircle,
  Printer,
  X,
  PackageOpen,
} from 'lucide-react';
import {
  CartItem,
  MPESA_CODE_REGEX,
  PaymentMethod,
  PRODUCT_CATEGORIES,
  Product,
  Sale,
  StoreConfig,
  formatKES,
} from '../types/pos';
import { completeCheckout, round2 } from '../services/posService';

interface PosCounterViewProps {
  store: StoreConfig;
  ownerId: string;
  cashierName: string;
  products: Product[];
  sales: Sale[];
  loading: boolean;
}

interface CompletedReceipt {
  saleId: string;
  receiptNumber: string;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  changeDue: number;
  mpesaCode: string;
  paymentMethod: PaymentMethod;
  customerName: string;
  customerPhone: string;
  cashAmount: number;
  mpesaAmount: number;
  creditAmount: number;
  items: { name: string; unit: string; quantity: number; unitPrice: number; lineTotal: number }[];
  timestamp: string;
}

export const PosCounterView: React.FC<PosCounterViewProps> = ({
  store,
  ownerId,
  cashierName,
  products,
  sales,
  loading,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [discountMode, setDiscountMode] = useState<'kes' | 'pct'>('kes');
  const [discountInput, setDiscountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountTendered, setAmountTendered] = useState<string>('');
  const [splitCashAmount, setSplitCashAmount] = useState<string>('');
  const [creditDepositMethod, setCreditDepositMethod] = useState<'none' | 'cash' | 'mpesa_paybill'>(
    'none'
  );
  const [creditDepositInput, setCreditDepositInput] = useState<string>('');
  const [mpesaCode, setMpesaCode] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [completedReceipt, setCompletedReceipt] = useState<CompletedReceipt | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeProducts = useMemo(() => products.filter((p) => p.isActive), [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeProducts.filter((p) => {
      const matchesCat = selectedCategory === 'ALL' || p.category === selectedCategory;
      if (!matchesCat) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [activeProducts, searchQuery, selectedCategory]);

  const cartMap = useMemo(() => new Map(cart.map((c) => [c.product.id, c.quantity])), [cart]);

  const subtotalAmount = useMemo(
    () =>
      round2(cart.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0)),
    [cart]
  );

  const rawDiscountNum = Math.max(0, Number(discountInput) || 0);
  const discountAmount = useMemo(() => {
    if (subtotalAmount <= 0 || rawDiscountNum <= 0) return 0;
    const computed =
      discountMode === 'pct'
        ? round2((subtotalAmount * Math.min(99.9, rawDiscountNum)) / 100)
        : round2(rawDiscountNum);
    return Math.min(computed, Math.max(0, round2(subtotalAmount - 1)));
  }, [subtotalAmount, rawDiscountNum, discountMode]);

  const totalAmount = useMemo(
    () => Math.max(0, round2(subtotalAmount - discountAmount)),
    [subtotalAmount, discountAmount]
  );

  const totalItemsCount = useMemo(
    () => round2(cart.reduce((sum, item) => sum + item.quantity, 0)),
    [cart]
  );

  const parsedSplitCash = useMemo(() => {
    const n = Number(splitCashAmount);
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  }, [splitCashAmount]);

  const computedSplitMpesa = useMemo(() => {
    return Math.max(0, round2(totalAmount - parsedSplitCash));
  }, [totalAmount, parsedSplitCash]);

  const parsedCreditDeposit = useMemo(() => {
    if (paymentMethod !== 'credit' || creditDepositMethod === 'none') return 0;
    const n = Number(creditDepositInput);
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  }, [paymentMethod, creditDepositMethod, creditDepositInput]);

  const creditBalanceDue = useMemo(() => {
    return Math.max(0, round2(totalAmount - parsedCreditDeposit));
  }, [totalAmount, parsedCreditDeposit]);

  const cashPortionDue =
    paymentMethod === 'cash'
      ? totalAmount
      : paymentMethod === 'split'
      ? parsedSplitCash
      : paymentMethod === 'credit' && creditDepositMethod === 'cash'
      ? parsedCreditDeposit
      : 0;

  const parsedTendered = Number(amountTendered) || 0;
  const changeDue =
    cashPortionDue > 0 && parsedTendered >= cashPortionDue
      ? round2(parsedTendered - cashPortionDue)
      : 0;

  const cleanMpesaCode = mpesaCode.trim().toUpperCase();
  const isMpesaCodeValid = MPESA_CODE_REGEX.test(cleanMpesaCode);

  const addToCart = (product: Product) => {
    setCheckoutError(null);
    if (product.stockQuantity <= 0) return;

    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        const nextQty = round2(existing.quantity + (existing.quantity < 1 ? 0.25 : 1));
        if (existing.quantity >= product.stockQuantity) {
          setCheckoutError(
            `Maximum available stock reached for ${product.name} (${product.stockQuantity} ${product.unit}).`
          );
          return prev;
        }
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: Math.min(nextQty, product.stockQuantity) }
            : item
        );
      }
      const initialQty = Math.min(1, product.stockQuantity);
      return [...prev, { product, quantity: initialQty }];
    });
  };

  const updateCartQty = (productId: string, nextQty: number) => {
    setCheckoutError(null);
    if (!Number.isFinite(nextQty)) return;
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((item) => item.product.id !== productId));
      return;
    }
    const cleanQty = round2(nextQty);
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item;
        const clamped = Math.min(cleanQty, item.product.stockQuantity);
        if (cleanQty > item.product.stockQuantity) {
          setCheckoutError(
            `Only ${item.product.stockQuantity} ${item.product.unit} of ${item.product.name} in stock.`
          );
        }
        return { ...item, quantity: clamped };
      })
    );
  };

  const removeFromCart = (productId: string) => {
    setCheckoutError(null);
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setDiscountInput('');
    setAmountTendered('');
    setSplitCashAmount('');
    setCreditDepositMethod('none');
    setCreditDepositInput('');
    setMpesaCode('');
    setCheckoutError(null);
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError(null);

    if (cart.length === 0) {
      setCheckoutError('Add at least one hardware item to the order.');
      return;
    }

    if (rawDiscountNum > 0 && discountAmount >= subtotalAmount) {
      setCheckoutError('Discount cannot equal or exceed the subtotal.');
      return;
    }

    if (paymentMethod === 'cash') {
      const tendered = amountTendered === '' ? totalAmount : Number(amountTendered);
      if (!Number.isFinite(tendered) || tendered < totalAmount) {
        setCheckoutError(
          `Cash tendered (${formatKES(tendered || 0)}) is less than net total due (${formatKES(
            totalAmount
          )}).`
        );
        return;
      }
    }

    if (paymentMethod === 'mpesa_paybill' && !isMpesaCodeValid) {
      setCheckoutError(
        'Enter the exact 10-character M-Pesa confirmation code (letters and numbers, e.g. UBK7H92M1P).'
      );
      return;
    }

    if (paymentMethod === 'split') {
      if (parsedSplitCash <= 0 || computedSplitMpesa <= 0) {
        setCheckoutError(
          'Split checkout requires positive amounts for both Cash and M-Pesa Paybill.'
        );
        return;
      }
      if (!isMpesaCodeValid) {
        setCheckoutError(
          'Enter the exact 10-character M-Pesa confirmation code for the Paybill portion.'
        );
        return;
      }
      const tendered = amountTendered === '' ? parsedSplitCash : Number(amountTendered);
      if (!Number.isFinite(tendered) || tendered < parsedSplitCash) {
        setCheckoutError('Cash tendered cannot be less than the cash portion.');
        return;
      }
    }

    if (paymentMethod === 'credit') {
      if (!customerName.trim()) {
        setCheckoutError('Enter the Customer or Contractor Name to record a Credit (Deni) sale.');
        return;
      }
      if (creditDepositMethod !== 'none' && parsedCreditDeposit <= 0) {
        setCheckoutError('Enter a positive deposit amount or select No Deposit.');
        return;
      }
      if (parsedCreditDeposit >= totalAmount) {
        setCheckoutError(
          'Deposit covers the full amount. Use Cash or M-Pesa Paybill instead of Credit (Deni).'
        );
        return;
      }
      if (creditDepositMethod === 'mpesa_paybill' && !isMpesaCodeValid) {
        setCheckoutError(
          'Enter the exact 10-character M-Pesa confirmation code for the Paybill deposit.'
        );
        return;
      }
      if (creditDepositMethod === 'cash') {
        const tendered = amountTendered === '' ? parsedCreditDeposit : Number(amountTendered);
        if (!Number.isFinite(tendered) || tendered < parsedCreditDeposit) {
          setCheckoutError('Cash tendered cannot be less than the cash deposit.');
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const tenderedValue =
        paymentMethod === 'cash'
          ? amountTendered === ''
            ? totalAmount
            : Number(amountTendered)
          : paymentMethod === 'split'
          ? amountTendered === ''
            ? parsedSplitCash
            : Number(amountTendered)
          : paymentMethod === 'credit' && creditDepositMethod === 'cash'
          ? amountTendered === ''
            ? parsedCreditDeposit
            : Number(amountTendered)
          : totalAmount;

      const snapshotItems = cart.map((c) => ({
        name: c.product.name,
        unit: c.product.unit,
        quantity: c.quantity,
        unitPrice: c.product.sellingPrice,
        lineTotal: round2(c.product.sellingPrice * c.quantity),
      }));

      const result = await completeCheckout({
        storeId: store.id,
        ownerId,
        cashierName,
        customerName,
        customerPhone,
        cart,
        discountAmount,
        paymentMethod,
        cashAmount:
          paymentMethod === 'cash'
            ? totalAmount
            : paymentMethod === 'split'
            ? parsedSplitCash
            : paymentMethod === 'credit' && creditDepositMethod === 'cash'
            ? parsedCreditDeposit
            : 0,
        mpesaAmount:
          paymentMethod === 'mpesa_paybill'
            ? totalAmount
            : paymentMethod === 'split'
            ? computedSplitMpesa
            : paymentMethod === 'credit' && creditDepositMethod === 'mpesa_paybill'
            ? parsedCreditDeposit
            : 0,
        mpesaCode: cleanMpesaCode,
        amountTendered: tenderedValue,
        creditDepositMethod,
        creditDepositAmount: parsedCreditDeposit,
        existingSales: sales,
      });

      setCompletedReceipt({
        ...result,
        customerName: customerName.trim() || 'Walk-in Customer',
        customerPhone: customerPhone.trim(),
        items: snapshotItems,
        timestamp: new Intl.DateTimeFormat('en-KE', {
          timeZone: 'Africa/Nairobi',
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date()),
      });

      clearCart();
      searchInputRef.current?.focus();
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Column: Manual Item Search & Catalog */}
      <div className="xl:col-span-7 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Manual item search by product name, SKU, or category..."
              className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-600 text-slate-900 placeholder:text-slate-400"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              All Items ({activeProducts.length})
            </button>
            {PRODUCT_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setSelectedCategory(category)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedCategory === category
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-slate-900">Hardware Catalog</h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {filteredProducts.length} items shown
            </span>
          </div>

          {loading ? (
            <div className="p-4 space-y-2.5">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-10 text-center">
              <PackageOpen className="w-8 h-8 text-slate-300 mx-auto mb-2.5" />
              <p className="text-sm font-semibold text-slate-800">No matching hardware items</p>
              <p className="text-xs text-slate-500 mt-1">
                Try searching a different item name, SKU, or clear the category filter.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
              {filteredProducts.map((product) => {
                const inCartQty = cartMap.get(product.id) || 0;
                const isOut = product.stockQuantity <= 0;
                const isLow = !isOut && product.stockQuantity <= product.reorderLevel;

                return (
                  <div
                    key={product.id}
                    className={`px-4 py-3 flex items-center justify-between gap-4 transition-colors ${
                      isOut ? 'bg-slate-50/70 opacity-65' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {product.name}
                        </p>
                        {inCartQty > 0 && (
                          <span className="font-mono tabular-nums text-xs font-semibold text-amber-700">
                            ({inCartQty} in order)
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                        <span className="font-mono">{product.sku}</span>
                        <span aria-hidden="true">·</span>
                        <span>{product.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>Per {product.unit}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-medium tabular-nums ${
                            isOut
                              ? 'text-red-600'
                              : isLow
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {isOut
                            ? 'Out of stock'
                            : isLow
                            ? `Low stock: ${product.stockQuantity}`
                            : `${product.stockQuantity} in stock`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="font-mono tabular-nums text-sm font-bold text-slate-900">
                          {formatKES(product.sellingPrice)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addToCart(product)}
                        disabled={isOut || inCartQty >= product.stockQuantity}
                        className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0 flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Counter Checkout, Discount, Fractional Qty & Credit (Deni) */}
      <div className="xl:col-span-5 xl:sticky xl:top-20">
        <form
          onSubmit={handleCheckout}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Current Sale</h2>
              <p className="text-xs text-slate-500 tabular-nums">
                {totalItemsCount} {totalItemsCount === 1 ? 'unit' : 'units'} · {cart.length}{' '}
                {cart.length === 1 ? 'line' : 'lines'}
              </p>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                className="text-xs font-medium text-red-600 hover:text-red-700 cursor-pointer whitespace-nowrap"
              >
                Clear order
              </button>
            )}
          </div>

          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="pos-customer-name"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Customer Name {paymentMethod === 'credit' ? '(Required)' : '(Optional)'}
                </label>
                <input
                  id="pos-customer-name"
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  maxLength={120}
                  placeholder={paymentMethod === 'credit' ? 'Enter debtor name' : 'Walk-in Customer'}
                  required={paymentMethod === 'credit'}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-600"
                />
              </div>
              <div>
                <label
                  htmlFor="pos-customer-phone"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Phone No. (Optional)
                </label>
                <input
                  id="pos-customer-phone"
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  maxLength={30}
                  placeholder="07XX XXX XXX"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-600"
                />
              </div>
            </div>

            {/* Cart Items with Fractional Quantities (0.25, 0.5, 0.75, etc.) */}
            <div className="border-t border-b border-slate-200 py-3">
              {cart.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  Select items from the hardware catalog on the left to start billing.
                </p>
              ) : (
                <div className="space-y-3.5 max-h-[250px] overflow-y-auto pr-1">
                  {cart.map((item) => (
                    <div key={item.product.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 truncate text-xs">
                            {item.product.name}
                          </p>
                          <p className="font-mono tabular-nums text-[11px] text-slate-500">
                            {formatKES(item.product.sellingPrice)} / {item.product.unit}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              updateCartQty(
                                item.product.id,
                                round2(item.quantity - (item.quantity <= 1 ? 0.25 : 1))
                              )
                            }
                            className="w-7 h-7 rounded-md border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 cursor-pointer"
                            aria-label={`Decrease ${item.product.name} quantity`}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min={0.01}
                            max={item.product.stockQuantity}
                            step="any"
                            value={item.quantity}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '') return;
                              const parsed = Number(val);
                              if (Number.isFinite(parsed) && parsed > 0) {
                                updateCartQty(item.product.id, parsed);
                              }
                            }}
                            className="w-14 text-center font-mono tabular-nums text-xs font-semibold border border-slate-200 rounded-md py-1 focus:outline-none focus:border-amber-600"
                            aria-label={`${item.product.name} quantity`}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateCartQty(
                                item.product.id,
                                round2(item.quantity + (item.quantity < 1 ? 0.25 : 1))
                              )
                            }
                            disabled={item.quantity >= item.product.stockQuantity}
                            className="w-7 h-7 rounded-md border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                            aria-label={`Increase ${item.product.name} quantity`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="w-20 text-right shrink-0">
                          <p className="font-mono tabular-nums text-xs font-bold text-slate-900">
                            {formatKES(round2(item.product.sellingPrice * item.quantity))}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product.id)}
                          className="p-1 text-slate-400 hover:text-red-600 cursor-pointer shrink-0"
                          aria-label={`Remove ${item.product.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Quick fractional unit buttons */}
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-slate-400">Qty presets:</span>
                        {[
                          { val: 0.25, label: '0.25 (¼)' },
                          { val: 0.5, label: '0.5 (½)' },
                          { val: 0.75, label: '0.75 (¾)' },
                          { val: 1, label: '1' },
                        ].map((preset) => (
                          <button
                            key={preset.val}
                            type="button"
                            disabled={preset.val > item.product.stockQuantity}
                            onClick={() => updateCartQty(item.product.id, preset.val)}
                            className={`px-1.5 py-0.5 rounded border font-mono cursor-pointer disabled:opacity-40 ${
                              Math.abs(item.quantity - preset.val) < 0.001
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Discount Row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="pos-discount-input"
                  className="text-xs font-semibold text-slate-700 whitespace-nowrap"
                >
                  Discount
                </label>
                <div className="inline-flex p-0.5 bg-slate-100 rounded-md text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDiscountMode('kes')}
                    className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                      discountMode === 'kes'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    KES
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountMode('pct')}
                    className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                      discountMode === 'pct'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    %
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="pos-discount-input"
                  type="number"
                  min={0}
                  step="any"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  placeholder="0"
                  disabled={cart.length === 0}
                  className="w-28 text-right px-2.5 py-1.5 font-mono tabular-nums text-xs font-semibold border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600 disabled:bg-slate-50"
                />
              </div>
            </div>

            {/* Totals Breakdown */}
            <div className="space-y-1 pt-1">
              {discountAmount > 0 && (
                <>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums">{formatKES(subtotalAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-emerald-700 font-medium">
                    <span>Discount Offered</span>
                    <span className="font-mono tabular-nums">- {formatKES(discountAmount)}</span>
                  </div>
                </>
              )}
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-sm font-semibold text-slate-700">Net Total Due</span>
                <span className="font-mono tabular-nums text-2xl font-bold text-slate-900">
                  {formatKES(totalAmount)}
                </span>
              </div>
            </div>

            {/* Payment Method Selector (includes Credit / Deni) */}
            <div>
              <span className="block text-xs font-semibold text-slate-700 mb-2">
                Payment Method
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod('cash');
                    setCheckoutError(null);
                  }}
                  className={`py-2 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                    paymentMethod === 'cash'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Banknote className="w-3.5 h-3.5 shrink-0" />
                  <span>Cash</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod('mpesa_paybill');
                    setCheckoutError(null);
                  }}
                  className={`py-2 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                    paymentMethod === 'mpesa_paybill'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  <span>Paybill</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod('split');
                    setCheckoutError(null);
                  }}
                  className={`py-2 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                    paymentMethod === 'split'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Split className="w-3.5 h-3.5 shrink-0" />
                  <span>Split</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod('credit');
                    setCheckoutError(null);
                  }}
                  className={`py-2 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                    paymentMethod === 'credit'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BookOpenCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Credit (Deni)</span>
                </button>
              </div>
            </div>

            {/* Cash */}
            {paymentMethod === 'cash' && (
              <div className="space-y-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div>
                  <label
                    htmlFor="cash-tendered"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Cash Tendered (KES)
                  </label>
                  <input
                    id="cash-tendered"
                    type="number"
                    min={0}
                    step="any"
                    value={amountTendered}
                    onChange={(e) => setAmountTendered(e.target.value)}
                    placeholder={totalAmount > 0 ? String(totalAmount) : '0'}
                    className="w-full px-3 py-2 font-mono tabular-nums text-sm font-semibold bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  />
                </div>
                {totalAmount > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAmountTendered(String(totalAmount))}
                      className="px-2.5 py-1 rounded bg-white border border-slate-200 text-xs font-mono font-medium text-slate-700 hover:border-slate-400 cursor-pointer"
                    >
                      Exact
                    </button>
                    {[500, 1000, 2000, 5000, 10000].map((note) => (
                      <button
                        key={note}
                        type="button"
                        onClick={() => setAmountTendered(String(note))}
                        className="px-2.5 py-1 rounded bg-white border border-slate-200 text-xs font-mono font-medium text-slate-700 hover:border-slate-400 cursor-pointer"
                      >
                        {note.toLocaleString()}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-slate-200 text-xs">
                  <span className="font-medium text-slate-600">Change Due</span>
                  <span className="font-mono tabular-nums text-sm font-bold text-slate-900">
                    {formatKES(changeDue)}
                  </span>
                </div>
              </div>
            )}

            {/* M-Pesa Paybill */}
            {paymentMethod === 'mpesa_paybill' && (
              <div className="space-y-3 p-3.5 rounded-lg bg-emerald-50/60 border border-emerald-200">
                <div className="flex items-center justify-between text-xs text-emerald-900">
                  <span>
                    Paybill: <strong className="font-mono">{store.paybillNumber}</strong>
                  </span>
                  <span>
                    Account: <strong className="font-mono">{store.accountReference}</strong>
                  </span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="mpesa-code-input"
                      className="text-xs font-semibold text-slate-800"
                    >
                      M-Pesa Confirmation Code (10 chars)
                    </label>
                    <span
                      className={`font-mono tabular-nums text-xs font-semibold ${
                        isMpesaCodeValid ? 'text-emerald-700' : 'text-slate-500'
                      }`}
                    >
                      {cleanMpesaCode.length}/10
                    </span>
                  </div>
                  <input
                    id="mpesa-code-input"
                    type="text"
                    maxLength={10}
                    value={mpesaCode}
                    onChange={(e) =>
                      setMpesaCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="e.g. UBK7H92M1P"
                    className="w-full px-3 py-2.5 font-mono text-sm font-bold tracking-widest uppercase bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600"
                    required
                  />
                  <p className="text-xs text-slate-600 mt-1.5">
                    Customer sends {formatKES(totalAmount)} to Paybill {store.paybillNumber}. Enter
                    the 10-character M-Pesa SMS confirmation code manually.
                  </p>
                </div>
              </div>
            )}

            {/* Split */}
            {paymentMethod === 'split' && (
              <div className="space-y-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="split-cash"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Cash Portion (KES)
                    </label>
                    <input
                      id="split-cash"
                      type="number"
                      min={1}
                      max={Math.max(1, totalAmount - 1)}
                      step="any"
                      value={splitCashAmount}
                      onChange={(e) => setSplitCashAmount(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 font-mono tabular-nums text-sm font-semibold bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                    />
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-slate-700 mb-1">
                      Paybill Portion
                    </span>
                    <div className="px-3 py-2 font-mono tabular-nums text-sm font-bold bg-slate-100 border border-slate-200 rounded-lg text-emerald-700">
                      {formatKES(computedSplitMpesa)}
                    </div>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="split-cash-tendered"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Cash Tendered (KES)
                  </label>
                  <input
                    id="split-cash-tendered"
                    type="number"
                    min={0}
                    step="any"
                    value={amountTendered}
                    onChange={(e) => setAmountTendered(e.target.value)}
                    placeholder={parsedSplitCash > 0 ? String(parsedSplitCash) : '0'}
                    className="w-full px-3 py-2 font-mono tabular-nums text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="split-mpesa-code"
                      className="text-xs font-semibold text-slate-800"
                    >
                      M-Pesa Confirmation Code (10 chars)
                    </label>
                    <span
                      className={`font-mono tabular-nums text-xs font-semibold ${
                        isMpesaCodeValid ? 'text-emerald-700' : 'text-slate-500'
                      }`}
                    >
                      {cleanMpesaCode.length}/10
                    </span>
                  </div>
                  <input
                    id="split-mpesa-code"
                    type="text"
                    maxLength={10}
                    value={mpesaCode}
                    onChange={(e) =>
                      setMpesaCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="e.g. UBK7H92M1P"
                    className="w-full px-3 py-2 font-mono text-sm font-bold tracking-widest uppercase bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-600"
                    required
                  />
                </div>
              </div>
            )}

            {/* Credit (Deni) */}
            {paymentMethod === 'credit' && (
              <div className="space-y-3 p-3.5 rounded-lg bg-amber-50/70 border border-amber-200">
                <div>
                  <span className="block text-xs font-semibold text-amber-950 mb-1.5">
                    Upfront Deposit Paid Today
                  </span>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-white border border-amber-200 rounded-lg text-xs">
                    {(
                      [
                        { id: 'none', label: 'KES 0 (Full Deni)' },
                        { id: 'cash', label: 'Cash Deposit' },
                        { id: 'mpesa_paybill', label: 'M-Pesa Deposit' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setCreditDepositMethod(opt.id);
                          if (opt.id === 'none') setCreditDepositInput('');
                        }}
                        className={`py-1.5 px-2 rounded font-semibold cursor-pointer ${
                          creditDepositMethod === opt.id
                            ? 'bg-amber-600 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {creditDepositMethod !== 'none' && (
                  <div className="space-y-2.5">
                    <div>
                      <label
                        htmlFor="credit-deposit-amount"
                        className="block text-xs font-semibold text-slate-800 mb-1"
                      >
                        Deposit Amount Paid Now (KES)
                      </label>
                      <input
                        id="credit-deposit-amount"
                        type="number"
                        min={1}
                        max={Math.max(1, totalAmount - 1)}
                        step="any"
                        value={creditDepositInput}
                        onChange={(e) => setCreditDepositInput(e.target.value)}
                        placeholder="0"
                        className="w-full px-3 py-2 font-mono tabular-nums text-sm font-semibold bg-white border border-amber-300 rounded-lg focus:outline-none focus:border-amber-600"
                        required
                      />
                    </div>

                    {creditDepositMethod === 'cash' && (
                      <div>
                        <label
                          htmlFor="credit-cash-tendered"
                          className="block text-xs font-semibold text-slate-700 mb-1"
                        >
                          Cash Tendered (KES)
                        </label>
                        <input
                          id="credit-cash-tendered"
                          type="number"
                          min={0}
                          step="any"
                          value={amountTendered}
                          onChange={(e) => setAmountTendered(e.target.value)}
                          placeholder={parsedCreditDeposit > 0 ? String(parsedCreditDeposit) : '0'}
                          className="w-full px-3 py-2 font-mono tabular-nums text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:border-amber-600"
                        />
                      </div>
                    )}

                    {creditDepositMethod === 'mpesa_paybill' && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label
                            htmlFor="credit-mpesa-code"
                            className="text-xs font-semibold text-slate-800"
                          >
                            M-Pesa Confirmation Code (10 chars)
                          </label>
                          <span
                            className={`font-mono tabular-nums text-xs font-semibold ${
                              isMpesaCodeValid ? 'text-emerald-700' : 'text-slate-500'
                            }`}
                          >
                            {cleanMpesaCode.length}/10
                          </span>
                        </div>
                        <input
                          id="credit-mpesa-code"
                          type="text"
                          maxLength={10}
                          value={mpesaCode}
                          onChange={(e) =>
                            setMpesaCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                          }
                          placeholder="e.g. UBK7H92M1P"
                          className="w-full px-3 py-2 font-mono text-sm font-bold tracking-widest uppercase bg-white border border-emerald-300 rounded-lg focus:outline-none focus:border-emerald-600"
                          required
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-amber-200 text-xs">
                  <span className="font-semibold text-amber-950">Credit (Deni) Balance Owed</span>
                  <span className="font-mono tabular-nums text-sm font-bold text-amber-800">
                    {formatKES(creditBalanceDue)}
                  </span>
                </div>
              </div>
            )}

            {checkoutError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || cart.length === 0}
              className="w-full py-3 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {submitting
                ? 'Recording Sale...'
                : paymentMethod === 'credit'
                ? `Record Credit (Deni) · ${formatKES(creditBalanceDue)} Owed`
                : `Complete Checkout · ${formatKES(totalAmount)}`}
            </button>
          </div>
        </form>
      </div>

      {/* Sale Confirmation & Plain Counter Slip Modal (No eTIMS) */}
      {completedReceipt && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-emerald-50">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Sale Recorded Successfully
                  </h3>
                  <p className="font-mono text-xs text-slate-600">
                    {completedReceipt.receiptNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCompletedReceipt(null)}
                className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                aria-label="Close confirmation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div id="counter-slip-printable" className="p-5 space-y-4 text-xs">
              <div className="text-center border-b border-dashed border-slate-300 pb-3">
                <p className="font-display text-base font-bold text-slate-900">{store.name}</p>
                <p className="text-slate-500">{store.location}</p>
                <p className="font-mono text-slate-600 mt-1">
                  Counter Slip {completedReceipt.receiptNumber} · {completedReceipt.timestamp}
                </p>
              </div>

              <div className="space-y-1 text-slate-600">
                <div className="flex justify-between">
                  <span>Customer</span>
                  <span className="font-semibold text-slate-900">
                    {completedReceipt.customerName}
                    {completedReceipt.customerPhone ? ` (${completedReceipt.customerPhone})` : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Cashier</span>
                  <span className="font-medium text-slate-900">{cashierName}</span>
                </div>
              </div>

              <div className="border-t border-b border-dashed border-slate-300 py-3 space-y-2">
                {completedReceipt.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{item.name}</p>
                      <p className="font-mono text-slate-500">
                        {item.quantity} {item.unit} × {formatKES(item.unitPrice)}
                      </p>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 shrink-0">
                      {formatKES(item.lineTotal)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                {completedReceipt.discountAmount > 0 && (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal</span>
                      <span className="font-mono tabular-nums">
                        {formatKES(completedReceipt.subtotalAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount</span>
                      <span className="font-mono tabular-nums">
                        - {formatKES(completedReceipt.discountAmount)}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-sm font-bold text-slate-900">
                  <span>Net Total</span>
                  <span className="font-mono tabular-nums">
                    {formatKES(completedReceipt.totalAmount)}
                  </span>
                </div>
                {completedReceipt.cashAmount > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Cash Paid</span>
                    <span className="font-mono tabular-nums">
                      {formatKES(completedReceipt.cashAmount)}
                    </span>
                  </div>
                )}
                {completedReceipt.mpesaAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>M-Pesa Paybill ({completedReceipt.mpesaCode})</span>
                    <span className="font-mono tabular-nums">
                      {formatKES(completedReceipt.mpesaAmount)}
                    </span>
                  </div>
                )}
                {completedReceipt.creditAmount > 0 && (
                  <div className="flex justify-between text-amber-700 font-bold">
                    <span>Credit (Deni) Balance Owed</span>
                    <span className="font-mono tabular-nums">
                      {formatKES(completedReceipt.creditAmount)}
                    </span>
                  </div>
                )}
                {completedReceipt.changeDue > 0 && (
                  <div className="flex justify-between text-slate-700 font-semibold">
                    <span>Cash Change Given</span>
                    <span className="font-mono tabular-nums">
                      {formatKES(completedReceipt.changeDue)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Slip</span>
              </button>
              <button
                type="button"
                onClick={() => setCompletedReceipt(null)}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
              >
                Next Customer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
