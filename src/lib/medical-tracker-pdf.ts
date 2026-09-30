import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatIncidentDate } from "@/lib/case-display";
import { CASE_EXPENSE_PAYMENT_LABELS } from "@/lib/case-expense-display";
import {
  DOCUMENT_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/medical-expense-display";
import {
  SCOPE_DOCUMENT_TITLES,
  formatCentralTime,
  type CertificationScope,
  type ExpensesSnapshotSection,
  type MedicalSnapshotSection,
  type MedicalTrackerAttestation,
} from "@/lib/medical-attestation";

const NAVY: [number, number, number] = [11, 31, 58];
const PINK: [number, number, number] = [211, 54, 138];
const MUTED: [number, number, number] = [100, 116, 139];
const BORDER: [number, number, number] = [226, 232, 240];
const ZEBRA: [number, number, number] = [248, 250, 252];
const FOOT_FILL: [number, number, number] = [238, 242, 247];

const MARGIN = 40;

const FILE_PREFIX: Record<CertificationScope, string> = {
  medical: "Medical-Tracker",
  expenses: "Case-Expenses",
  all: "Case-Financials",
};

const CERTIFICATION_SENTENCES: Record<CertificationScope, string> = {
  medical:
    "The reviewer confirmed that the medical providers, charges, balances, duplicate entries, and system-flagged items were reviewed prior to generation of this document.",
  expenses:
    "The reviewer confirmed that the case expenses, amounts, payment status, duplicate entries, and system-flagged items were reviewed prior to generation of this document.",
  all:
    "The reviewer confirmed that the medical providers, charges, balances, case expenses, duplicate entries, and system-flagged items were reviewed prior to generation of this document.",
};

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function date(value: string | null): string {
  return formatIncidentDate(value) ?? "—";
}

function lopLabel(value: boolean | null): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

function rightAlignColumns(columns: number[]) {
  return (data: { column: { index: number }; cell: { styles: { halign?: string } } }) => {
    if (columns.includes(data.column.index)) data.cell.styles.halign = "right";
  };
}

function lastTableY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? MARGIN;
}

function sectionTitle(doc: jsPDF, title: string, y: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - 120) {
    doc.addPage();
    y = MARGIN;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text(title, MARGIN, y);
  return y + 8;
}

const tableDefaults = {
  margin: { left: MARGIN, right: MARGIN, bottom: 44 },
  styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4, textColor: [15, 23, 42] as [number, number, number], lineColor: BORDER, lineWidth: 0.5 },
  headStyles: { fillColor: NAVY, textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const },
  alternateRowStyles: { fillColor: ZEBRA },
};

const footStyles = { fillColor: FOOT_FILL, textColor: NAVY, fontStyle: "bold" as const };

/** Version lines relevant to the certified scope, e.g. ["Medical Tracker", 7]. */
function scopeVersions(att: MedicalTrackerAttestation): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  if (att.snapshot.medical) out.push(["Medical Tracker", att.trackerVersion]);
  if (att.snapshot.expenses) out.push(["Case Expenses", att.expensesVersion]);
  return out;
}

export function medicalTrackerPdfFileName(attestation: MedicalTrackerAttestation): string {
  const caseNumber = attestation.snapshot.case.caseNumber ?? attestation.caseId.slice(0, 8);
  const safe = caseNumber.replace(/[^\w.-]+/g, "_");
  return `${FILE_PREFIX[attestation.scope]}_Case-${safe}_PDF-v${attestation.pdfVersion}.pdf`;
}

export function downloadMedicalTrackerPdf(attestation: MedicalTrackerAttestation): void {
  buildMedicalTrackerPdf(attestation).save(medicalTrackerPdfFileName(attestation));
}

function statsFor(
  medical: MedicalSnapshotSection | null,
  expenses: ExpensesSnapshotSection | null
): Array<[string, string]> {
  if (medical && expenses) {
    return [
      ["Medical Charges", money(medical.summary.totals.charge)],
      ["Case Expenses", money(expenses.totals.amount)],
      ["Combined Total", money(medical.summary.totals.charge + expenses.totals.amount)],
      ["Outstanding", money(medical.summary.totals.outstanding + expenses.totals.outstanding)],
      ["Providers", String(medical.providers.length)],
      ["Vendors", String(expenses.totals.vendors)],
    ];
  }
  if (expenses) {
    return [
      ["Total Expenses", money(expenses.totals.amount)],
      ["Paid", money(expenses.totals.paid)],
      ["Outstanding", money(expenses.totals.outstanding)],
      ["Expenses", String(expenses.items.length)],
      ["Vendors", String(expenses.totals.vendors)],
    ];
  }
  const totals = medical!.summary.totals;
  return [
    ["Total Charges", money(totals.charge)],
    ["Paid", money(totals.paid)],
    ["Adjusted", money(totals.adjusted)],
    ["Outstanding", money(totals.outstanding)],
    ["Providers", String(medical!.providers.length)],
    ["LOP Providers", String(medical!.lopProviderCount)],
  ];
}

function drawMedicalSections(doc: jsPDF, medical: MedicalSnapshotSection, startY: number) {
  const totals = medical.summary.totals;

  let y = sectionTitle(doc, "Medical Providers", startY);
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [["Provider", "LOP", "Treatment Finished", "Records Requested", "Records Received", "Billing Requested", "Billing Received"]],
    body: medical.providers.length
      ? medical.providers.map((p) => [
          p.providerName,
          lopLabel(p.hasLop),
          date(p.treatmentFinishedDate),
          date(p.medicalRequestedDate),
          date(p.medicalReceivedDate),
          date(p.billingRequestedDate),
          date(p.billingReceivedDate),
        ])
      : [["No providers recorded", "", "", "", "", "", ""]],
    columnStyles: { 0: { cellWidth: 190 } },
  });

  y = sectionTitle(doc, "Financial Summary by Provider", lastTableY(doc) + 26);
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [["Provider", "Charges", "Paid", "Adjusted", "Outstanding"]],
    body: medical.summary.providers.map((p) => [
      p.providerName,
      money(p.charge),
      money(p.paid),
      money(p.adjusted),
      money(p.outstanding),
    ]),
    foot: [["Total", money(totals.charge), money(totals.paid), money(totals.adjusted), money(totals.outstanding)]],
    footStyles,
    didParseCell: rightAlignColumns([1, 2, 3, 4]),
  });

  y = sectionTitle(doc, "Invoices", lastTableY(doc) + 26);
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [["Provider", "Document", "Account #", "Date of Service", "Charges", "Balance", "Final Pay", "Status"]],
    body: medical.invoices.length
      ? medical.invoices.map((inv) => [
          inv.providerName,
          DOCUMENT_TYPE_LABELS[inv.documentType] ?? inv.documentType,
          inv.accountNumber ?? "—",
          date(inv.dateOfService),
          money(inv.charge),
          money(inv.outstanding),
          money(inv.finalPayAmount),
          PAYMENT_STATUS_LABELS[inv.paymentStatus] ?? inv.paymentStatus,
        ])
      : [["No invoices recorded", "", "", "", "", "", "", ""]],
    columnStyles: { 0: { cellWidth: 170 } },
    didParseCell: rightAlignColumns([4, 5, 6]),
  });
}

function drawExpensesSection(doc: jsPDF, expenses: ExpensesSnapshotSection, startY: number) {
  const y = sectionTitle(doc, "Case Expenses", startY);
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [["Vendor", "Type", "Description", "Invoice #", "Date", "Amount", "Paid", "Status"]],
    body: expenses.items.length
      ? expenses.items.map((e) => [
          e.vendorName,
          e.expenseType ?? "—",
          e.description ?? "—",
          e.invoiceNumber ?? "—",
          date(e.invoiceDate ?? e.serviceDate),
          money(e.amount),
          money(e.paid),
          CASE_EXPENSE_PAYMENT_LABELS[e.paymentStatus] ?? e.paymentStatus,
        ])
      : [["No case expenses recorded", "", "", "", "", "", "", ""]],
    foot: expenses.items.length
      ? [["Total", "", "", "", "", money(expenses.totals.amount), money(expenses.totals.paid), ""]]
      : undefined,
    footStyles,
    columnStyles: { 0: { cellWidth: 140 }, 2: { cellWidth: 170 } },
    didParseCell: rightAlignColumns([5, 6]),
  });
}

function drawCombinedSummary(
  doc: jsPDF,
  medical: MedicalSnapshotSection,
  expenses: ExpensesSnapshotSection,
  startY: number
) {
  const m = medical.summary.totals;
  const e = expenses.totals;
  const y = sectionTitle(doc, "Financial Overview", startY);
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [["Category", "Total", "Paid", "Outstanding"]],
    body: [
      ["Medical Expenses", money(m.charge), money(m.paid), money(m.outstanding)],
      ["Case Expenses", money(e.amount), money(e.paid), money(e.outstanding)],
    ],
    foot: [["Combined", money(m.charge + e.amount), money(m.paid + e.paid), money(m.outstanding + e.outstanding)]],
    footStyles,
    didParseCell: rightAlignColumns([1, 2, 3]),
  });
}

export function buildMedicalTrackerPdf(attestation: MedicalTrackerAttestation): jsPDF {
  const { snapshot } = attestation;
  const { medical, expenses } = snapshot;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const versions = scopeVersions(attestation);

  // Header
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...NAVY);
  doc.text(SCOPE_DOCUMENT_TITLES[attestation.scope], MARGIN, MARGIN + 10);

  doc.setFontSize(13);
  doc.text(snapshot.case.displayName, MARGIN, MARGIN + 30);

  const meta: string[] = [];
  if (snapshot.case.caseNumber) meta.push(`Case #${snapshot.case.caseNumber}`);
  if (snapshot.case.causeNumber) meta.push(`Cause #${snapshot.case.causeNumber}`);
  if (snapshot.case.dateOfIncident) meta.push(`DOL ${date(snapshot.case.dateOfIncident)}`);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(meta.join("  ·  ") || "—", MARGIN, MARGIN + 46);

  doc.text(
    [
      ...versions.map(([label, v]) => `${label} Version ${v}`),
      `PDF Version ${attestation.pdfVersion}`,
      `Certified ${formatCentralTime(attestation.attestedAt)}`,
    ],
    pageWidth - MARGIN,
    MARGIN + 10,
    { align: "right", lineHeightFactor: 1.5 }
  );

  // Totals
  const stats = statsFor(medical, expenses);
  const statTop = MARGIN + 64 + Math.max(0, versions.length - 1) * 8;
  const statWidth = contentWidth / stats.length;
  doc.setDrawColor(...BORDER);
  doc.roundedRect(MARGIN, statTop, contentWidth, 48, 6, 6, "S");
  stats.forEach(([label, value], i) => {
    const x = MARGIN + statWidth * i + 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, statTop + 17);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text(value, x, statTop + 36);
  });

  let nextY = statTop + 76;
  if (medical && expenses) {
    drawCombinedSummary(doc, medical, expenses, nextY);
    nextY = lastTableY(doc) + 26;
  }
  if (medical) {
    drawMedicalSections(doc, medical, nextY);
    nextY = lastTableY(doc) + 26;
  }
  if (expenses) {
    drawExpensesSection(doc, expenses, nextY);
  }

  // Review certification
  const rows: Array<[string, string]> = [
    ["Reviewed by:", attestation.reviewerName],
    ["Review completed:", formatCentralTime(attestation.attestedAt)],
    ...versions.map(([label, v]): [string, string] => [`${label} Version:`, String(v)]),
  ];
  const certHeight = 73 + rows.length * 15;
  let certTop = lastTableY(doc) + 28;
  if (certTop + certHeight > pageHeight - 44) {
    doc.addPage();
    certTop = MARGIN;
  }
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1);
  doc.roundedRect(MARGIN, certTop, contentWidth, certHeight, 6, 6, "S");
  doc.setFillColor(...PINK);
  doc.rect(MARGIN, certTop + 10, 4, certHeight - 20, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...NAVY);
  doc.text("Reviewed & Verified", MARGIN + 18, certTop + 24);

  doc.setFontSize(10);
  rows.forEach(([label, value], i) => {
    const rowY = certTop + 44 + i * 15;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(label, MARGIN + 18, rowY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(value, MARGIN + 150, rowY);
  });

  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(
    doc.splitTextToSize(CERTIFICATION_SENTENCES[attestation.scope], contentWidth - 36),
    MARGIN + 18,
    certTop + 53 + rows.length * 15
  );

  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  const footerLeft = [
    snapshot.case.caseNumber ? `Case #${snapshot.case.caseNumber}` : snapshot.case.displayName,
    ...versions.map(([label, v]) => `${label} v${v}`),
    `PDF v${attestation.pdfVersion}`,
    `Certified by ${attestation.reviewerName}`,
  ].join("  ·  ");
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(footerLeft, MARGIN, pageHeight - 22);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 22, { align: "right" });
  }

  return doc;
}
