import React, { useMemo, useState } from 'react';
import {
  Search,
  Plus,
  SlidersHorizontal,
  Edit3,
  X,
  AlertCircle,
  History,
  Boxes,
} from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  PRODUCT_UNITS,
  Product,
  ProductCategory,
  StockLog,
  StockLogType,
  formatKES,
  formatKenyaDateTime,
} from '../types/pos';
import {
  adjustProductStock,
  createProduct,
  updateProductDetails,
} from '../services/posService';

interface InventoryViewProps {
  storeId: string;
  ownerId: string;
  actorName: string;
  products: Product[];
  stockLogs: StockLog[];
  loading: boolean;
  showAddModal: boolean;
  onCloseAddModal: () => void;
  onOpenAddModal: () => void;
}

type StockFilter = 'all' | 'low' | 'out' | 'inactive';

export const InventoryView: React.FC<InventoryViewProps> = ({
  storeId,
  ownerId,
  actorName,
  products,
  stockLogs,
  loading,
  showAddModal,
  onCloseAddModal,
  onOpenAddModal,
}) => {
  const [subTab, setSubTab] = useState<'catalog' | 'logs'>('catalog');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);

  // Add / Edit Product Form State
  const [formSku, setFormSku] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<ProductCategory>(PRODUCT_CATEGORIES[0]);
  const [formUnit, setFormUnit] = useState<string>(PRODUCT_UNITS[0]);
  const [formCostPrice, setFormCostPrice] = useState('');
  const [formSellingPrice, setFormSellingPrice] = useState('');
  const [formStockQty, setFormStockQty] = useState('');
  const [formReorderLevel, setFormReorderLevel] = useState('10');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Adjust Stock Form State
  const [adjustMode, setAdjustMode] = useState<'restock' | 'damage' | 'audit'>('restock');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setFormSku(product.sku);
    setFormName(product.name);
    setFormCategory(product.category);
    setFormUnit(product.unit);
    setFormCostPrice(String(product.costPrice));
    setFormSellingPrice(String(product.sellingPrice));
    setFormReorderLevel(String(product.reorderLevel));
    setFormIsActive(product.isActive);
    setFormError(null);
  };

  const resetAddForm = () => {
    setFormSku('');
    setFormName('');
    setFormCategory(PRODUCT_CATEGORIES[0]);
    setFormUnit(PRODUCT_UNITS[0]);
    setFormCostPrice('');
    setFormSellingPrice('');
    setFormStockQty('0');
    setFormReorderLevel('10');
    setFormIsActive(true);
    setFormError(null);
  };

  const openAdjustModal = (product: Product) => {
    setAdjustingProduct(product);
    setAdjustMode('restock');
    setAdjustAmount('');
    setAdjustReason('');
    setAdjustError(null);
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
      if (stockFilter === 'low' && !(p.isActive && p.stockQuantity > 0 && p.stockQuantity <= p.reorderLevel)) {
        return false;
      }
      if (stockFilter === 'out' && !(p.isActive && p.stockQuantity <= 0)) return false;
      if (stockFilter === 'inactive' && p.isActive) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, search, categoryFilter, stockFilter]);

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cost = Number(formCostPrice);
    const sell = Number(formSellingPrice);
    const reorder = Number(formReorderLevel);
    const initialStock = Number(formStockQty || 0);

    if (!formName.trim() || !formSku.trim()) {
      setFormError('Item name and SKU are required.');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(sell) || sell < 0) {
      setFormError('Enter valid KES cost and selling prices.');
      return;
    }

    setSaving(true);
    try {
      if (editingProduct) {
        await updateProductDetails(storeId, editingProduct.id, {
          sku: formSku,
          name: formName,
          category: formCategory,
          unit: formUnit,
          costPrice: cost,
          sellingPrice: sell,
          reorderLevel: Math.max(0, reorder || 0),
          isActive: formIsActive,
        });
        setEditingProduct(null);
      } else {
        await createProduct(storeId, ownerId, actorName, {
          sku: formSku,
          name: formName,
          category: formCategory,
          unit: formUnit,
          costPrice: cost,
          sellingPrice: sell,
          stockQuantity: Math.max(0, initialStock || 0),
          reorderLevel: Math.max(0, reorder || 0),
        });
        resetAddForm();
        onCloseAddModal();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save hardware item.');
    } finally {
      setSaving(false);
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingProduct) return;
    setAdjustError(null);

    const qtyNum = Number(adjustAmount);
    if (!Number.isFinite(qtyNum) || qtyNum < 0) {
      setAdjustError('Enter a valid non-negative quantity.');
      return;
    }

    let nextStock = adjustingProduct.stockQuantity;
    let logType: StockLogType = 'adjustment';
    let defaultReason = '';

    if (adjustMode === 'restock') {
      if (qtyNum <= 0) {
        setAdjustError('Restock quantity must be greater than zero.');
        return;
      }
      nextStock = adjustingProduct.stockQuantity + qtyNum;
      logType = 'restock';
      defaultReason = `Supplier delivery (+${qtyNum} ${adjustingProduct.unit})`;
    } else if (adjustMode === 'damage') {
      if (qtyNum <= 0) {
        setAdjustError('Damaged/shrinkage quantity must be greater than zero.');
        return;
      }
      nextStock = Math.max(0, adjustingProduct.stockQuantity - qtyNum);
      logType = 'damage';
      defaultReason = `Damaged / shrinkage (-${qtyNum} ${adjustingProduct.unit})`;
    } else {
      nextStock = qtyNum;
      logType = 'adjustment';
      defaultReason = `Physical shelf count audit (${qtyNum} ${adjustingProduct.unit})`;
    }

    setSaving(true);
    try {
      await adjustProductStock(
        storeId,
        ownerId,
        adjustingProduct,
        nextStock,
        logType,
        adjustReason.trim() || defaultReason,
        actorName
      );
      setAdjustingProduct(null);
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'Unable to adjust stock.');
    } finally {
      setSaving(false);
    }
  };

  const isModalOpen = showAddModal || editingProduct !== null;

  return (
    <div className="space-y-5">
      {/* Top Sub-Navigation & Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('catalog')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              subTab === 'catalog'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>Stock Catalog ({products.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('logs')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              subTab === 'logs'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Stock Movement Audit ({stockLogs.length})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            resetAddForm();
            onOpenAddModal();
          }}
          className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Add Hardware Item</span>
        </button>
      </div>

      {subTab === 'catalog' ? (
        <>
          {/* Filters */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search inventory by name or SKU..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
              aria-label="Filter by category"
            >
              <option value="ALL">All Categories</option>
              {PRODUCT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'low', label: 'Low Stock' },
                  { id: 'out', label: 'Out of Stock' },
                  { id: 'inactive', label: 'Inactive' },
                ] as { id: StockFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStockFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap ${
                    stockFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Inventory Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-5 space-y-2.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-11 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-semibold text-slate-800">No items match your filters</p>
                <p className="text-xs text-slate-500 mt-1">
                  Adjust your search query or add a new hardware SKU.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-3 px-4 font-semibold">SKU</th>
                      <th className="py-3 px-4 font-semibold">Hardware Item</th>
                      <th className="py-3 px-4 font-semibold">Unit</th>
                      <th className="py-3 px-4 font-semibold text-right">Cost</th>
                      <th className="py-3 px-4 font-semibold text-right">Selling Price</th>
                      <th className="py-3 px-4 font-semibold text-right">In Stock</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProducts.map((product) => {
                      const isOut = product.stockQuantity <= 0;
                      const isLow = !isOut && product.stockQuantity <= product.reorderLevel;
                      const margin =
                        product.sellingPrice > 0
                          ? ((product.sellingPrice - product.costPrice) / product.sellingPrice) * 100
                          : 0;

                      return (
                        <tr key={product.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-mono font-semibold text-slate-700 whitespace-nowrap">
                            {product.sku}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900">{product.name}</p>
                            <p className="text-slate-500">{product.category}</p>
                          </td>
                          <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                            {product.unit}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {formatKES(product.costPrice)}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <span className="font-mono tabular-nums font-bold text-slate-900">
                              {formatKES(product.sellingPrice)}
                            </span>
                            <span className="block font-mono tabular-nums text-[11px] text-slate-400">
                              {margin.toFixed(0)}% margin
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                            {product.stockQuantity}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {!product.isActive ? (
                              <span className="text-slate-500 font-medium">Inactive</span>
                            ) : isOut ? (
                              <span className="text-red-600 font-semibold">Out of stock</span>
                            ) : isLow ? (
                              <span className="text-amber-700 font-semibold">
                                Low (min {product.reorderLevel})
                              </span>
                            ) : (
                              <span className="text-emerald-700 font-medium">In stock</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openAdjustModal(product)}
                                className="px-2.5 py-1.5 rounded-md border border-slate-200 hover:border-amber-500 text-slate-700 hover:text-amber-700 font-medium inline-flex items-center gap-1 cursor-pointer"
                              >
                                <SlidersHorizontal className="w-3 h-3" />
                                <span>Adjust</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(product)}
                                className="px-2.5 py-1.5 rounded-md border border-slate-200 hover:border-slate-400 text-slate-700 font-medium inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Edit</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Stock Movement Audit Log */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-slate-900">
              Stock Movement Audit Trail
            </h2>
            <span className="text-xs text-slate-500">Latest 100 stock changes</span>
          </div>
          {stockLogs.length === 0 ? (
            <p className="p-8 text-xs text-slate-500 text-center">No stock movements logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                    <th className="py-2.5 px-4 font-semibold">Item</th>
                    <th className="py-2.5 px-4 font-semibold">Type</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Change</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Balance</th>
                    <th className="py-2.5 px-4 font-semibold">Reason / Operator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stockLogs.slice(0, 100).map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {formatKenyaDateTime(log.createdAt)}
                      </td>
                      <td className="py-2.5 px-4">
                        <p className="font-semibold text-slate-900">{log.productName}</p>
                        <p className="font-mono text-slate-400">{log.sku}</p>
                      </td>
                      <td className="py-2.5 px-4 capitalize font-medium text-slate-700 whitespace-nowrap">
                        {log.type.replace('_', ' ')}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                          log.quantityDelta >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {log.quantityDelta >= 0 ? `+${log.quantityDelta}` : log.quantityDelta}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {log.newStock}
                      </td>
                      <td className="py-2.5 px-4">
                        <p className="text-slate-700">{log.reason}</p>
                        <p className="text-slate-400">{log.actorName}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Item Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingProduct ? 'Edit Hardware Item' : 'Add New Hardware Item'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditingProduct(null);
                  onCloseAddModal();
                }}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    SKU Code (Uppercase)
                  </label>
                  <input
                    type="text"
                    value={formSku}
                    onChange={(e) =>
                      setFormSku(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))
                    }
                    placeholder="e.g. CEM-BAM-50"
                    maxLength={32}
                    required
                    className="w-full px-3 py-2 font-mono uppercase border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as ProductCategory)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  >
                    {PRODUCT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Item Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Bamburi Nguvu Cement 32.5N"
                  maxLength={140}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Unit</label>
                  <select
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  >
                    {PRODUCT_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cost Price (KES)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={formCostPrice}
                    onChange={(e) => setFormCostPrice(e.target.value)}
                    required
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Selling Price (KES)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={formSellingPrice}
                    onChange={(e) => setFormSellingPrice(e.target.value)}
                    required
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {!editingProduct && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Opening Stock Qty
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={formStockQty}
                      onChange={(e) => setFormStockQty(e.target.value)}
                      required
                      className="w-full px-3 py-2 font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                    />
                  </div>
                )}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Low-Stock Reorder Level
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formReorderLevel}
                    onChange={(e) => setFormReorderLevel(e.target.value)}
                    required
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                  />
                </div>
                {editingProduct && (
                  <div className="flex items-end pb-2">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formIsActive}
                        onChange={(e) => setFormIsActive(e.target.checked)}
                        className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                      />
                      <span className="font-semibold text-slate-700">
                        Active for POS Counter Sale
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingProduct(null);
                    onCloseAddModal();
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Saving...' : editingProduct ? 'Save Changes' : 'Add Item to Catalog'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {adjustingProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Adjust Stock Level
                </h3>
                <p className="text-xs text-slate-500 truncate max-w-[300px]">
                  {adjustingProduct.name} · Current: {adjustingProduct.stockQuantity}{' '}
                  {adjustingProduct.unit}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustingProduct(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAdjustStock} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'restock', label: 'Restock (+)' },
                    { id: 'damage', label: 'Damage (-)' },
                    { id: 'audit', label: 'Set Count' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setAdjustMode(m.id)}
                    className={`py-2 rounded-md font-semibold cursor-pointer ${
                      adjustMode === m.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {adjustMode === 'restock'
                    ? `Units Received (${adjustingProduct.unit})`
                    : adjustMode === 'damage'
                    ? `Units Lost / Damaged (${adjustingProduct.unit})`
                    : `Actual Physical Shelf Count (${adjustingProduct.unit})`}
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  required
                  className="w-full px-3 py-2 font-mono tabular-nums text-sm font-semibold border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Reason / Delivery Note
                </label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Bamburi distributor delivery #441"
                  maxLength={240}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-amber-600"
                />
              </div>

              {adjustError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{adjustError}</span>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setAdjustingProduct(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Updating...' : 'Apply Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
