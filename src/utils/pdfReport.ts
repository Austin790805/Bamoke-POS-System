import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Product,
  Sale,
  StoreConfig,
  formatKES,
  formatKenyaDateTime,
} from '../types/pos';

export type ReportPeriodType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'semi_annually'
  | 'annually';

export interface BusinessReportSummary {
  periodType: ReportPeriodType;
  periodLabel: string;
  startDateKey: string;
  endDateKey: string;
  completedCount: number;
  voidedCount: number;
  grossSales: number;
  totalDiscounts: number;
  netRevenue: number;
  totalCost: number;
  grossProfit: number;
  marginPct: number;
  cashCollected: number;
  mpesaCollected: number;
  mpesaVerified: number;
  mpesaPendingCount: number;
  creditIssued: number;
  creditOutstanding: number;
  activeSkus: number;
  totalUnitsInStock: number;
  inventoryCostValue: number;
  inventoryRetailValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  categoryBreakdown: {
    category: string;
    skuCount: number;
    stockUnits: number;
    costValue: number;
    retailValue: number;
  }[];
  topItems: {
    name: string;
    qtySold: number;
    revenueEstimate: number;
  }[];
}

export function exportBusinessReportPDF(
  store: StoreConfig,
  summary: BusinessReportSummary,
  salesInPeriod: Sale[],
  products: Product[]
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const generatedAt = formatKenyaDateTime(new Date());

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 32, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('BAMOKE HARDWARE POS SYSTEM', 14, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(251, 191, 36);
  doc.text(`${summary.periodLabel} Business Report`, 14, 20);

  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `${store.name} · ${store.location} · Paybill ${store.paybillNumber} (${store.accountReference})`,
    14,
    26.5
  );

  // Period Metadata
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(
    `Reporting Window: ${summary.startDateKey} to ${summary.endDateKey} (EAT)`,
    14,
    40
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${generatedAt}`, pageWidth - 14, 40, { align: 'right' });

  // Section 1: Financial & Payment Summary
  autoTable(doc, {
    startY: 45,
    head: [['Financial & Collections Metric', 'Amount / Count', 'Notes']],
    body: [
      ['Gross Sales (Before Discounts)', formatKES(summary.grossSales), `${summary.completedCount} completed sales`],
      ['Total Discounts Offered', formatKES(summary.totalDiscounts), 'Customer discounts applied at checkout'],
      ['Net Sales Revenue', formatKES(summary.netRevenue), `${summary.voidedCount} voided sales excluded`],
      ['Cost of Goods Sold (COGS)', formatKES(summary.totalCost), 'Based on product cost prices'],
      ['Estimated Gross Profit', formatKES(summary.grossProfit), `${summary.marginPct.toFixed(1)}% gross margin`],
      ['Cash Collected', formatKES(summary.cashCollected), 'Cash sales + cash deposits + cash deni repayments'],
      ['M-Pesa Paybill Collected', formatKES(summary.mpesaCollected), `${formatKES(summary.mpesaVerified)} verified · ${summary.mpesaPendingCount} pending`],
      ['Credit (Deni) Issued in Period', formatKES(summary.creditIssued), 'Original credit portion on Deni sales'],
      ['Outstanding Unpaid Deni Balance', formatKES(summary.creditOutstanding), 'Remaining unpaid customer balance in period'],
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    columnStyles: {
      1: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  });

  // Section 2: Inventory Snapshot by Category
  const afterFinanceY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Inventory Valuation Snapshot (${summary.activeSkus} Active SKUs · Cost ${formatKES(summary.inventoryCostValue)} · Retail ${formatKES(summary.inventoryRetailValue)})`,
    14,
    afterFinanceY + 10
  );

  autoTable(doc, {
    startY: afterFinanceY + 14,
    head: [['Hardware Category', 'SKUs', 'Units in Stock', 'Cost Valuation', 'Retail Value']],
    body: summary.categoryBreakdown.map((c) => [
      c.category,
      String(c.skuCount),
      c.stockUnits.toFixed(2).replace(/\.00$/, ''),
      formatKES(c.costValue),
      formatKES(c.retailValue),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [217, 119, 6], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  // Section 3: Top Items in Period (if any)
  const afterCatY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 180;
  if (summary.topItems.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Top Moving Hardware Items in Period', 14, afterCatY + 10);

    autoTable(doc, {
      startY: afterCatY + 14,
      head: [['Item Name', 'Units Sold', 'Est. Revenue']],
      body: summary.topItems.slice(0, 10).map((item) => [
        item.name,
        item.qtySold.toFixed(2).replace(/\.00$/, ''),
        formatKES(item.revenueEstimate),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
  }

  // Section 4: Transactions Ledger (new page if needed)
  const afterTopY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 220;
  if (salesInPeriod.length > 0) {
    if (afterTopY > 225) {
      doc.addPage();
    }
    const txStartY = afterTopY > 225 ? 18 : afterTopY + 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Transactions in Period (${salesInPeriod.length})`, 14, txStartY);

    autoTable(doc, {
      startY: txStartY + 4,
      head: [['Receipt #', 'Date', 'Customer', 'Method / Code', 'Discount', 'Net Total', 'Deni Bal.']],
      body: salesInPeriod.slice(0, 150).map((s) => [
        s.receiptNumber,
        s.saleDateKey,
        s.customerName,
        s.mpesaCode ? `${s.paymentMethod} (${s.mpesaCode})` : s.paymentMethod,
        formatKES(s.discountAmount ?? 0),
        s.status === 'voided' ? 'VOIDED' : formatKES(s.totalAmount),
        formatKES(s.creditBalance ?? 0),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.5 },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
  } else if (products.length > 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('No sales transactions recorded within this selected reporting period.', 14, afterTopY + 12);
  }

  const filename = `Bamoke-Hardware-${summary.periodType}-Report-${summary.endDateKey}.pdf`;
  doc.save(filename);
}
