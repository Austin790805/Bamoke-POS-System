import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { SEED_HARDWARE_CATALOG } from '../data/seedCatalog';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CartItem,
  CreditStatus,
  DailyReconciliation,
  MPESA_CODE_REGEX,
  MpesaStatus,
  PaymentMethod,
  Product,
  ProductCategory,
  Sale,
  SaleLineItem,
  SKU_REGEX,
  StockLogType,
  StoreConfig,
  getKenyaDateKey,
} from '../types/pos';

function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function generateReceiptNumber(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = String(Math.floor(1000 + Math.random() * 9000));
  return `BMK-${y}${m}${d}-${suffix}`;
}

export async function ensureUserAndStore(user: User): Promise<StoreConfig> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const storePath = `stores/${uid}`;

  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid,
        email: (user.email || 'operator@bamokehardware.co.ke').slice(0, 200),
        displayName: (user.displayName || user.email?.split('@')[0] || 'Counter Operator').slice(0, 120),
        role: 'owner',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  const storeRef = doc(db, 'stores', uid);
  let storeSnap;
  try {
    storeSnap = await getDoc(storeRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, storePath);
  }

  if (!storeSnap.exists()) {
    try {
      await setDoc(storeRef, {
        ownerId: uid,
        name: 'Bamoke Hardware',
        paybillNumber: '400200',
        accountReference: 'BAMOKE',
        location: 'Nairobi, Kenya',
        seeded: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      storeSnap = await getDoc(storeRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, storePath);
    }
  }

  const storeData = storeSnap.data() as Omit<StoreConfig, 'id'>;

  if (!storeData.seeded) {
    try {
      const productsCol = collection(db, 'stores', uid, 'products');
      const existingProducts = await getDocs(query(productsCol, where('ownerId', '==', uid)));

      if (existingProducts.empty) {
        const batch = writeBatch(db);
        const actorName = (user.displayName || user.email || 'Store Owner').slice(0, 120);

        for (const item of SEED_HARDWARE_CATALOG) {
          const prodId = makeDocId('prod');
          const prodRef = doc(db, 'stores', uid, 'products', prodId);
          batch.set(prodRef, {
            ownerId: uid,
            sku: item.sku,
            name: item.name,
            category: item.category,
            unit: item.unit,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
            stockQuantity: item.stockQuantity,
            reorderLevel: item.reorderLevel,
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          const logId = makeDocId('log');
          const logRef = doc(db, 'stores', uid, 'stockLogs', logId);
          batch.set(logRef, {
            ownerId: uid,
            productId: prodId,
            productName: item.name,
            sku: item.sku,
            type: 'restock',
            quantityDelta: item.stockQuantity,
            previousStock: 0,
            newStock: item.stockQuantity,
            reason: 'Initial opening stock',
            actorName,
            createdAt: serverTimestamp(),
          });
        }

        batch.update(doc(db, 'stores', uid), {
          seeded: true,
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
        storeSnap = await getDoc(doc(db, 'stores', uid));
      } else {
        await updateDoc(doc(db, 'stores', uid), {
          seeded: true,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `stores/${uid}/products`);
    }
  }

  return {
    id: storeSnap.id,
    ...(storeSnap.data() as Omit<StoreConfig, 'id'>),
  };
}

export async function updateStoreSettings(
  storeId: string,
  payload: {
    name: string;
    paybillNumber: string;
    accountReference: string;
    location: string;
  }
): Promise<void> {
  const path = `stores/${storeId}`;
  try {
    await updateDoc(doc(db, 'stores', storeId), {
      name: payload.name.trim().slice(0, 120),
      paybillNumber: payload.paybillNumber.trim().slice(0, 20),
      accountReference: payload.accountReference.trim().toUpperCase().slice(0, 40),
      location: payload.location.trim().slice(0, 120),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface CreateProductInput {
  sku: string;
  name: string;
  category: ProductCategory;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  stockQuantity: number;
  reorderLevel: number;
}

export async function createProduct(
  storeId: string,
  ownerId: string,
  actorName: string,
  input: CreateProductInput
): Promise<string> {
  const cleanSku = input.sku.trim().toUpperCase();
  if (!SKU_REGEX.test(cleanSku) || cleanSku.length < 2 || cleanSku.length > 32) {
    throw new Error('SKU must be 2–32 characters using uppercase letters, numbers, or hyphens.');
  }

  const prodId = makeDocId('prod');
  const batch = writeBatch(db);
  const prodRef = doc(db, 'stores', storeId, 'products', prodId);

  batch.set(prodRef, {
    ownerId,
    sku: cleanSku,
    name: input.name.trim().slice(0, 140),
    category: input.category,
    unit: input.unit.trim().slice(0, 30),
    costPrice: Math.max(0, Number(input.costPrice)),
    sellingPrice: Math.max(0, Number(input.sellingPrice)),
    stockQuantity: Math.max(0, round2(Number(input.stockQuantity))),
    reorderLevel: Math.max(0, Number(input.reorderLevel)),
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (input.stockQuantity > 0) {
    const logId = makeDocId('log');
    batch.set(doc(db, 'stores', storeId, 'stockLogs', logId), {
      ownerId,
      productId: prodId,
      productName: input.name.trim().slice(0, 140),
      sku: cleanSku,
      type: 'restock',
      quantityDelta: round2(Number(input.stockQuantity)),
      previousStock: 0,
      newStock: round2(Number(input.stockQuantity)),
      reason: 'New inventory item added',
      actorName: actorName.slice(0, 120),
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return prodId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `stores/${storeId}/products/${prodId}`);
  }
}

export async function updateProductDetails(
  storeId: string,
  productId: string,
  input: {
    sku: string;
    name: string;
    category: ProductCategory;
    unit: string;
    costPrice: number;
    sellingPrice: number;
    reorderLevel: number;
    isActive: boolean;
  }
): Promise<void> {
  const cleanSku = input.sku.trim().toUpperCase();
  if (!SKU_REGEX.test(cleanSku) || cleanSku.length < 2 || cleanSku.length > 32) {
    throw new Error('SKU must be 2–32 characters using uppercase letters, numbers, or hyphens.');
  }

  const path = `stores/${storeId}/products/${productId}`;
  try {
    await updateDoc(doc(db, 'stores', storeId, 'products', productId), {
      sku: cleanSku,
      name: input.name.trim().slice(0, 140),
      category: input.category,
      unit: input.unit.trim().slice(0, 30),
      costPrice: Math.max(0, Number(input.costPrice)),
      sellingPrice: Math.max(0, Number(input.sellingPrice)),
      reorderLevel: Math.max(0, Number(input.reorderLevel)),
      isActive: input.isActive,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adjustProductStock(
  storeId: string,
  ownerId: string,
  product: Product,
  newStockQuantity: number,
  logType: StockLogType,
  reason: string,
  actorName: string
): Promise<void> {
  if (newStockQuantity < 0) {
    throw new Error('Stock quantity cannot be negative.');
  }
  const cleanReason = reason.trim();
  if (!cleanReason) {
    throw new Error('Please enter a reason for this stock adjustment.');
  }

  const cleanNew = round2(newStockQuantity);
  const delta = round2(cleanNew - product.stockQuantity);
  const batch = writeBatch(db);
  const prodRef = doc(db, 'stores', storeId, 'products', product.id);
  const logId = makeDocId('log');
  const logRef = doc(db, 'stores', storeId, 'stockLogs', logId);

  batch.update(prodRef, {
    stockQuantity: cleanNew,
    updatedAt: serverTimestamp(),
  });

  batch.set(logRef, {
    ownerId,
    productId: product.id,
    productName: product.name.slice(0, 140),
    sku: product.sku,
    type: logType,
    quantityDelta: delta,
    previousStock: product.stockQuantity,
    newStock: cleanNew,
    reason: cleanReason.slice(0, 240),
    actorName: actorName.slice(0, 120),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `stores/${storeId}/products/${product.id}`);
  }
}

export interface CheckoutPayload {
  storeId: string;
  ownerId: string;
  cashierName: string;
  customerName: string;
  customerPhone?: string;
  cart: CartItem[];
  discountAmount: number;
  paymentMethod: PaymentMethod;
  cashAmount: number;
  mpesaAmount: number;
  mpesaCode: string;
  amountTendered: number;
  creditDepositMethod?: 'none' | 'cash' | 'mpesa_paybill';
  creditDepositAmount?: number;
  existingSales: Sale[];
}

export async function completeCheckout(payload: CheckoutPayload): Promise<{
  saleId: string;
  receiptNumber: string;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  changeDue: number;
  mpesaCode: string;
  paymentMethod: PaymentMethod;
  cashAmount: number;
  mpesaAmount: number;
  creditAmount: number;
}> {
  const {
    storeId,
    ownerId,
    cashierName,
    customerName,
    customerPhone = '',
    cart,
    discountAmount,
    paymentMethod,
    cashAmount,
    mpesaAmount,
    mpesaCode,
    amountTendered,
    creditDepositMethod = 'none',
    creditDepositAmount = 0,
    existingSales,
  } = payload;

  if (cart.length === 0) {
    throw new Error('Cart is empty. Add at least one hardware item before checkout.');
  }

  for (const item of cart) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error(`Invalid quantity for ${item.product.name}.`);
    }
    if (item.quantity > item.product.stockQuantity + 0.0001) {
      throw new Error(
        `Insufficient stock for ${item.product.name}. Available: ${item.product.stockQuantity} ${item.product.unit}.`
      );
    }
  }

  const subtotalAmount = round2(
    cart.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0)
  );
  const cleanDiscount = round2(Math.max(0, Number(discountAmount) || 0));

  if (cleanDiscount >= subtotalAmount) {
    throw new Error('Discount cannot equal or exceed the subtotal amount.');
  }

  const totalAmount = round2(subtotalAmount - cleanDiscount);
  const totalCost = round2(
    cart.reduce((sum, item) => sum + item.product.costPrice * item.quantity, 0)
  );

  const normalizedCode = mpesaCode.trim().toUpperCase();

  const validateMpesaCode = () => {
    if (!MPESA_CODE_REGEX.test(normalizedCode)) {
      throw new Error(
        'M-Pesa Paybill requires a valid 10-character alphanumeric confirmation code (e.g. UBK7H92M1P).'
      );
    }
    const duplicateSale = existingSales.find(
      (s) => s.status === 'completed' && s.mpesaCode === normalizedCode
    );
    if (duplicateSale) {
      throw new Error(
        `M-Pesa code ${normalizedCode} was already recorded on receipt ${duplicateSale.receiptNumber}. Verify before reusing.`
      );
    }
  };

  let finalCash = 0;
  let finalMpesa = 0;
  let finalCredit = 0;
  let finalTendered = 0;
  let changeDue = 0;
  let mpesaStatus: MpesaStatus = 'not_applicable';
  let creditStatus: CreditStatus = 'not_applicable';
  let finalMpesaCode = '';

  if (paymentMethod === 'cash') {
    finalCash = totalAmount;
    finalTendered = Math.max(totalAmount, Number(amountTendered) || totalAmount);
    if (Number(amountTendered) < totalAmount) {
      throw new Error('Cash tendered cannot be less than the total amount due.');
    }
    changeDue = round2(finalTendered - totalAmount);
  } else if (paymentMethod === 'mpesa_paybill') {
    validateMpesaCode();
    finalMpesa = totalAmount;
    finalTendered = totalAmount;
    finalMpesaCode = normalizedCode;
    mpesaStatus = 'pending';
  } else if (paymentMethod === 'split') {
    validateMpesaCode();
    finalCash = round2(Number(cashAmount));
    finalMpesa = round2(Number(mpesaAmount));
    if (finalCash <= 0 || finalMpesa <= 0) {
      throw new Error('Split payment requires positive amounts for both Cash and M-Pesa Paybill.');
    }
    if (Math.abs(finalCash + finalMpesa - totalAmount) > 0.02) {
      throw new Error('Cash + M-Pesa Paybill amounts must equal the net total due.');
    }
    finalTendered = Math.max(finalCash, Number(amountTendered) || finalCash);
    if (Number(amountTendered) < finalCash) {
      throw new Error('Cash tendered cannot be less than the cash portion.');
    }
    changeDue = round2(finalTendered - finalCash);
    finalMpesaCode = normalizedCode;
    mpesaStatus = 'pending';
  } else if (paymentMethod === 'credit') {
    if (!customerName.trim()) {
      throw new Error('Customer or contractor name is required for Credit (Deni) sales.');
    }
    const deposit = round2(Math.max(0, Number(creditDepositAmount) || 0));
    if (creditDepositMethod !== 'none' && deposit <= 0) {
      throw new Error('Enter a positive deposit amount or select No Upfront Deposit.');
    }
    if (deposit >= totalAmount) {
      throw new Error(
        'Upfront deposit covers the full total. Select Cash or M-Pesa Paybill instead of Credit (Deni).'
      );
    }

    if (creditDepositMethod === 'cash') {
      finalCash = deposit;
      finalTendered = Math.max(deposit, Number(amountTendered) || deposit);
      if (Number(amountTendered) < deposit) {
        throw new Error('Cash tendered cannot be less than the deposit amount.');
      }
      changeDue = round2(finalTendered - deposit);
    } else if (creditDepositMethod === 'mpesa_paybill') {
      validateMpesaCode();
      finalMpesa = deposit;
      finalTendered = deposit;
      finalMpesaCode = normalizedCode;
      mpesaStatus = 'pending';
    }

    finalCredit = round2(totalAmount - finalCash - finalMpesa);
    creditStatus = finalCash + finalMpesa > 0 ? 'partial' : 'unpaid';
  }

  const saleId = makeDocId('sale');
  const receiptNumber = generateReceiptNumber();
  const saleDateKey = getKenyaDateKey(new Date());
  const itemCount = round2(cart.reduce((sum, i) => sum + i.quantity, 0));
  const itemsSummary = cart
    .map((i) => `${i.product.name} × ${i.quantity}`)
    .join(', ')
    .slice(0, 400);

  const batch = writeBatch(db);
  const saleRef = doc(db, 'stores', storeId, 'sales', saleId);

  batch.set(saleRef, {
    ownerId,
    receiptNumber,
    cashierName: (cashierName || 'Counter Operator').slice(0, 120),
    customerName: (customerName.trim() || 'Walk-in Customer').slice(0, 120),
    customerPhone: customerPhone.trim().slice(0, 30),
    paymentMethod,
    cashAmount: finalCash,
    mpesaAmount: finalMpesa,
    creditAmount: finalCredit,
    creditBalance: finalCredit,
    creditStatus,
    mpesaCode: finalMpesaCode,
    mpesaStatus,
    mpesaNote: '',
    subtotalAmount,
    discountAmount: cleanDiscount,
    totalAmount,
    totalCost,
    amountTendered: finalTendered,
    changeDue,
    itemCount,
    itemsSummary,
    status: 'completed',
    voidReason: '',
    saleDateKey,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  for (const cartItem of cart) {
    const lineId = makeDocId('item');
    const lineRef = doc(db, 'stores', storeId, 'sales', saleId, 'items', lineId);
    const lineTotal = round2(cartItem.product.sellingPrice * cartItem.quantity);

    batch.set(lineRef, {
      ownerId,
      saleId,
      productId: cartItem.product.id,
      sku: cartItem.product.sku,
      name: cartItem.product.name.slice(0, 140),
      unit: cartItem.product.unit.slice(0, 30),
      quantity: round2(cartItem.quantity),
      unitPrice: cartItem.product.sellingPrice,
      unitCost: cartItem.product.costPrice,
      lineTotal,
      createdAt: serverTimestamp(),
    });

    const newStock = Math.max(0, round2(cartItem.product.stockQuantity - cartItem.quantity));
    const prodRef = doc(db, 'stores', storeId, 'products', cartItem.product.id);
    batch.update(prodRef, {
      stockQuantity: newStock,
      updatedAt: serverTimestamp(),
    });

    const logId = makeDocId('log');
    const logRef = doc(db, 'stores', storeId, 'stockLogs', logId);
    batch.set(logRef, {
      ownerId,
      productId: cartItem.product.id,
      productName: cartItem.product.name.slice(0, 140),
      sku: cartItem.product.sku,
      type: 'sale',
      quantityDelta: round2(-cartItem.quantity),
      previousStock: cartItem.product.stockQuantity,
      newStock,
      reason: `Counter sale ${receiptNumber}`,
      actorName: (cashierName || 'Counter Operator').slice(0, 120),
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return {
      saleId,
      receiptNumber,
      subtotalAmount,
      discountAmount: cleanDiscount,
      totalAmount,
      changeDue,
      mpesaCode: finalMpesaCode,
      paymentMethod,
      cashAmount: finalCash,
      mpesaAmount: finalMpesa,
      creditAmount: finalCredit,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `stores/${storeId}/sales/${saleId}`);
  }
}

export async function recordCreditRepayment(
  storeId: string,
  sale: Sale,
  repayAmount: number,
  method: 'cash' | 'mpesa_paybill',
  mpesaCode: string,
  existingSales: Sale[]
): Promise<void> {
  if (sale.status === 'voided') {
    throw new Error('Cannot record repayment on a voided sale.');
  }
  const currentBalance = sale.creditBalance ?? 0;
  const cleanAmount = round2(repayAmount);
  if (cleanAmount <= 0 || cleanAmount > currentBalance + 0.01) {
    throw new Error(`Repayment amount must be between KES 1 and ${currentBalance}.`);
  }

  const nextBalance = Math.max(0, round2(currentBalance - cleanAmount));
  const nextCreditStatus: CreditStatus = nextBalance <= 0.01 ? 'settled' : 'partial';

  let nextCash = sale.cashAmount;
  let nextMpesa = sale.mpesaAmount;
  let nextMpesaCode = sale.mpesaCode;
  let nextMpesaStatus = sale.mpesaStatus;

  if (method === 'cash') {
    nextCash = round2(sale.cashAmount + cleanAmount);
  } else {
    const cleanCode = mpesaCode.trim().toUpperCase();
    if (!MPESA_CODE_REGEX.test(cleanCode)) {
      throw new Error('Enter a valid 10-character M-Pesa confirmation code.');
    }
    const dup = existingSales.find(
      (s) => s.id !== sale.id && s.status === 'completed' && s.mpesaCode === cleanCode
    );
    if (dup) {
      throw new Error(`M-Pesa code ${cleanCode} is already used on receipt ${dup.receiptNumber}.`);
    }
    nextMpesa = round2(sale.mpesaAmount + cleanAmount);
    nextMpesaCode = cleanCode;
    nextMpesaStatus = 'pending';
  }

  const path = `stores/${storeId}/sales/${sale.id}`;
  try {
    await updateDoc(doc(db, 'stores', storeId, 'sales', sale.id), {
      cashAmount: nextCash,
      mpesaAmount: nextMpesa,
      mpesaCode: nextMpesaCode,
      mpesaStatus: nextMpesaStatus,
      mpesaNote:
        method === 'mpesa_paybill'
          ? `Deni repayment (${cleanAmount}) via ${nextMpesaCode}`.slice(0, 240)
          : sale.mpesaNote,
      creditBalance: nextBalance,
      creditStatus: nextCreditStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchSaleLineItems(
  storeId: string,
  ownerId: string,
  saleId: string
): Promise<SaleLineItem[]> {
  const path = `stores/${storeId}/sales/${saleId}/items`;
  try {
    const snap = await getDocs(
      query(collection(db, 'stores', storeId, 'sales', saleId, 'items'), where('ownerId', '==', ownerId))
    );
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<SaleLineItem, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function updateMpesaStatus(
  storeId: string,
  saleId: string,
  mpesaStatus: 'pending' | 'verified' | 'flagged',
  mpesaNote: string
): Promise<void> {
  const path = `stores/${storeId}/sales/${saleId}`;
  try {
    await updateDoc(doc(db, 'stores', storeId, 'sales', saleId), {
      mpesaStatus,
      mpesaNote: mpesaNote.trim().slice(0, 240),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function voidSaleTransaction(
  storeId: string,
  ownerId: string,
  sale: Sale,
  products: Product[],
  voidReason: string,
  actorName: string
): Promise<void> {
  const cleanReason = voidReason.trim();
  if (!cleanReason) {
    throw new Error('A void reason is required.');
  }
  if (sale.status === 'voided') {
    throw new Error('This sale is already voided.');
  }

  const lineItems = await fetchSaleLineItems(storeId, ownerId, sale.id);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const batch = writeBatch(db);

  batch.update(doc(db, 'stores', storeId, 'sales', sale.id), {
    status: 'voided',
    voidReason: cleanReason.slice(0, 240),
    updatedAt: serverTimestamp(),
  });

  for (const item of lineItems) {
    const prod = productMap.get(item.productId);
    if (prod) {
      const restoredStock = round2(prod.stockQuantity + item.quantity);
      batch.update(doc(db, 'stores', storeId, 'products', prod.id), {
        stockQuantity: restoredStock,
        updatedAt: serverTimestamp(),
      });

      const logId = makeDocId('log');
      batch.set(doc(db, 'stores', storeId, 'stockLogs', logId), {
        ownerId,
        productId: prod.id,
        productName: prod.name.slice(0, 140),
        sku: prod.sku,
        type: 'void_restore',
        quantityDelta: item.quantity,
        previousStock: prod.stockQuantity,
        newStock: restoredStock,
        reason: `Voided ${sale.receiptNumber}: ${cleanReason}`.slice(0, 240),
        actorName: actorName.slice(0, 120),
        createdAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `stores/${storeId}/sales/${sale.id}`);
  }
}

export async function closeDailyShiftReconciliation(
  storeId: string,
  ownerId: string,
  payload: {
    dateKey: string;
    expectedCash: number;
    countedCash: number;
    expectedMpesa: number;
    verifiedMpesa: number;
    pendingMpesaCount: number;
    totalRevenue: number;
    notes: string;
    closedBy: string;
    existingRec?: DailyReconciliation;
  }
): Promise<void> {
  const recId = payload.existingRec?.id || `rec_${payload.dateKey}`;
  const path = `stores/${storeId}/reconciliations/${recId}`;
  const cashVariance = round2(payload.countedCash - payload.expectedCash);

  try {
    const recRef = doc(db, 'stores', storeId, 'reconciliations', recId);
    if (payload.existingRec) {
      if (payload.existingRec.status === 'closed') {
        throw new Error(`Shift reconciliation for ${payload.dateKey} is already closed.`);
      }
      await updateDoc(recRef, {
        expectedCash: payload.expectedCash,
        countedCash: payload.countedCash,
        cashVariance,
        expectedMpesa: payload.expectedMpesa,
        verifiedMpesa: payload.verifiedMpesa,
        pendingMpesaCount: payload.pendingMpesaCount,
        totalRevenue: payload.totalRevenue,
        notes: payload.notes.trim().slice(0, 500),
        closedBy: payload.closedBy.slice(0, 120),
        status: 'closed',
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(recRef, {
        ownerId,
        dateKey: payload.dateKey,
        expectedCash: payload.expectedCash,
        countedCash: payload.countedCash,
        cashVariance,
        expectedMpesa: payload.expectedMpesa,
        verifiedMpesa: payload.verifiedMpesa,
        pendingMpesaCount: payload.pendingMpesaCount,
        totalRevenue: payload.totalRevenue,
        notes: payload.notes.trim().slice(0, 500),
        closedBy: payload.closedBy.slice(0, 120),
        status: 'closed',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function seedSampleDayTransactions(
  storeId: string,
  ownerId: string,
  cashierName: string,
  products: Product[]
): Promise<void> {
  if (products.length < 4) return;
  const todayKey = getKenyaDateKey(new Date());
  const now = new Date();
  const yestDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = getKenyaDateKey(yestDate);

  const sampleSpecs = [
    {
      dateKey: todayKey,
      customerName: 'Kamau Contractors Ltd',
      customerPhone: '0712345678',
      paymentMethod: 'mpesa_paybill' as PaymentMethod,
      mpesaCode: 'UBK8M41P9Q',
      mpesaStatus: 'verified' as MpesaStatus,
      discount: 200,
      indices: [
        { idx: 0, qty: 10 },
        { idx: 3, qty: 8 },
      ],
    },
    {
      dateKey: todayKey,
      customerName: 'Walk-in Customer',
      customerPhone: '',
      paymentMethod: 'cash' as PaymentMethod,
      mpesaCode: '',
      mpesaStatus: 'not_applicable' as MpesaStatus,
      discount: 0,
      indices: [
        { idx: 12, qty: 2 },
        { idx: 15, qty: 0.5 },
      ],
    },
    {
      dateKey: todayKey,
      customerName: 'Wanjiku Plumbing Works',
      customerPhone: '0722987654',
      paymentMethod: 'credit' as PaymentMethod,
      mpesaCode: '',
      mpesaStatus: 'not_applicable' as MpesaStatus,
      discount: 0,
      depositCash: 1500,
      indices: [
        { idx: 7, qty: 4 },
        { idx: 9, qty: 3 },
      ],
    },
    {
      dateKey: yesterdayKey,
      customerName: 'Omondi Builders',
      customerPhone: '0733112233',
      paymentMethod: 'split' as PaymentMethod,
      mpesaCode: 'UBJ4T82K6N',
      mpesaStatus: 'verified' as MpesaStatus,
      discount: 350,
      indices: [
        { idx: 5, qty: 6 },
        { idx: 10, qty: 1 },
      ],
    },
  ];

  const batch = writeBatch(db);

  for (let i = 0; i < sampleSpecs.length; i++) {
    const spec = sampleSpecs[i];
    const items = spec.indices
      .map((entry) => ({
        product: products[entry.idx],
        qty: Math.min(entry.qty, products[entry.idx]?.stockQuantity || 0),
      }))
      .filter((x) => x.product && x.qty > 0);

    if (items.length === 0) continue;

    const subtotalAmount = round2(items.reduce((s, x) => s + x.product.sellingPrice * x.qty, 0));
    const discountAmount = Math.min(spec.discount, Math.max(0, subtotalAmount - 10));
    const totalAmount = round2(subtotalAmount - discountAmount);
    const totalCost = round2(items.reduce((s, x) => s + x.product.costPrice * x.qty, 0));

    let cashAmount = 0;
    let mpesaAmount = 0;
    let creditAmount = 0;
    let creditBalance = 0;
    let creditStatus: CreditStatus = 'not_applicable';

    if (spec.paymentMethod === 'cash') {
      cashAmount = totalAmount;
    } else if (spec.paymentMethod === 'mpesa_paybill') {
      mpesaAmount = totalAmount;
    } else if (spec.paymentMethod === 'split') {
      cashAmount = Math.round(totalAmount * 0.4);
      mpesaAmount = round2(totalAmount - cashAmount);
    } else if (spec.paymentMethod === 'credit') {
      cashAmount = Math.min(spec.depositCash || 0, Math.max(0, totalAmount - 100));
      creditAmount = round2(totalAmount - cashAmount);
      creditBalance = creditAmount;
      creditStatus = cashAmount > 0 ? 'partial' : 'unpaid';
    }

    const saleId = makeDocId(`sample${i}`);
    const receiptNumber = `BMK-SMP-${101 + i}`;

    batch.set(doc(db, 'stores', storeId, 'sales', saleId), {
      ownerId,
      receiptNumber,
      cashierName: cashierName.slice(0, 120),
      customerName: spec.customerName,
      customerPhone: spec.customerPhone,
      paymentMethod: spec.paymentMethod,
      cashAmount,
      mpesaAmount,
      creditAmount,
      creditBalance,
      creditStatus,
      mpesaCode: spec.mpesaCode,
      mpesaStatus: spec.mpesaStatus,
      mpesaNote: spec.mpesaStatus === 'verified' ? 'Matched Paybill SMS statement' : '',
      subtotalAmount,
      discountAmount,
      totalAmount,
      totalCost,
      amountTendered: cashAmount,
      changeDue: 0,
      itemCount: round2(items.reduce((s, x) => s + x.qty, 0)),
      itemsSummary: items.map((x) => `${x.product.name} × ${x.qty}`).join(', '),
      status: 'completed',
      voidReason: '',
      saleDateKey: spec.dateKey,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const item of items) {
      const lineId = makeDocId('item');
      batch.set(doc(db, 'stores', storeId, 'sales', saleId, 'items', lineId), {
        ownerId,
        saleId,
        productId: item.product.id,
        sku: item.product.sku,
        name: item.product.name.slice(0, 140),
        unit: item.product.unit.slice(0, 30),
        quantity: item.qty,
        unitPrice: item.product.sellingPrice,
        unitCost: item.product.costPrice,
        lineTotal: round2(item.product.sellingPrice * item.qty),
        createdAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `stores/${storeId}/sales`);
  }
}
