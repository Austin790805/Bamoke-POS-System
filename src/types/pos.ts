import { Timestamp } from 'firebase/firestore';

export type AppView = 'pos' | 'dashboard' | 'inventory' | 'reconciliation' | 'sales' | 'reports';

export const PRODUCT_CATEGORIES = [
  'Cement & Masonry',
  'Steel & Roofing',
  'Plumbing & PVC',
  'Paints & Finishes',
  'Hand & Power Tools',
  'Fasteners & Hardware',
  'Electrical & Lighting',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_UNITS = [
  'Bag',
  'Metre',
  'Bag (50kg)',
  'Piece',
  'Sheet',
  'Length (6m)',
  'Litre',
  'Tin (4L)',
  'Bucket (20L)',
  'Kg',
  'Roll',
  'Pack',
  'Pair',
  'Box',
] as const;

export const MPESA_CODE_REGEX = /^[A-Z0-9]{10}$/;
export const SKU_REGEX = /^[A-Z0-9-]+$/;

export type PaymentMethod = 'cash' | 'mpesa_paybill' | 'split' | 'credit';
export type CreditStatus = 'not_applicable' | 'unpaid' | 'partial' | 'settled';
export type MpesaStatus = 'not_applicable' | 'pending' | 'verified' | 'flagged';
export type SaleStatus = 'completed' | 'voided';
export type StockLogType = 'restock' | 'sale' | 'void_restore' | 'adjustment' | 'damage';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'cashier';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StoreConfig {
  id: string;
  ownerId: string;
  name: string;
  paybillNumber: string;
  accountReference: string;
  location: string;
  seeded: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Product {
  id: string;
  ownerId: string;
  sku: string;
  name: string;
  category: ProductCategory;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  stockQuantity: number;
  reorderLevel: number;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Sale {
  id: string;
  ownerId: string;
  receiptNumber: string;
  cashierName: string;
  customerName: string;
  customerPhone?: string;
  paymentMethod: PaymentMethod;
  cashAmount: number;
  mpesaAmount: number;
  creditAmount?: number;
  creditBalance?: number;
  creditStatus?: CreditStatus;
  mpesaCode: string;
  mpesaStatus: MpesaStatus;
  mpesaNote: string;
  subtotalAmount?: number;
  discountAmount?: number;
  totalAmount: number;
  totalCost: number;
  amountTendered: number;
  changeDue: number;
  itemCount: number;
  itemsSummary: string;
  status: SaleStatus;
  voidReason: string;
  saleDateKey: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SaleLineItem {
  id: string;
  ownerId: string;
  saleId: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  createdAt: Timestamp;
}

export interface StockLog {
  id: string;
  ownerId: string;
  productId: string;
  productName: string;
  sku: string;
  type: StockLogType;
  quantityDelta: number;
  previousStock: number;
  newStock: number;
  reason: string;
  actorName: string;
  createdAt: Timestamp;
}

export interface DailyReconciliation {
  id: string;
  ownerId: string;
  dateKey: string;
  expectedCash: number;
  countedCash: number;
  cashVariance: number;
  expectedMpesa: number;
  verifiedMpesa: number;
  pendingMpesaCount: number;
  totalRevenue: number;
  notes: string;
  closedBy: string;
  status: 'open' | 'closed';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export function formatKES(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `KES ${new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(safe)}`;
}

export function getKenyaDateKey(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export function formatKenyaDateTime(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '—';
  const date = ts instanceof Date ? ts : ts.toDate();
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatKenyaTimeOnly(ts: Timestamp | Date | null | undefined): string {
  if (!ts) return '—';
  const date = ts instanceof Date ? ts : ts.toDate();
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
