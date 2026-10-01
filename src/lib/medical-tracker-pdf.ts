import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatIncidentDate } from "@/lib/case-display";
import { CASE_EXPENSE_PAYMENT_LABELS } from "@/lib/case-expense-display";
import {
  ATTESTATION_STATEMENT_SETS,
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
const INK: [number, number, number] = [15, 23, 42];

const MARGIN = 40;

const FILE_PREFIX: Record<CertificationScope, string> = {
  medical: "Medical-Tracker",
  expenses: "Case-Expenses",
  all: "Case-Financials",
};

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function date(value: string | null): string {
  return formatIncidentDate(value) ?? "—";
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
  styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: BORDER, lineWidth: 0.5 },
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

/** Short titles of the statements the reviewer checked, in the wording they attested to. */
function attestedStatementTitles(att: MedicalTrackerAttestation): string[] {
  const set = Object.values(ATTESTATION_STATEMENT_SETS).find((s) => s.version === att.statementSetVersion);
  return att.statements
    .filter((s) => s.checked)
    .map((s) => set?.statements.find((x) => x.id === s.id)?.title ?? s.text.split(/(?<=\.)\s/)[0]);
}

export function medicalTrackerPdfFileName(attestation: MedicalTrackerAttestation): string {
  const caseNumber = attestation.snapshot.case.caseNumber ?? attestation.caseId.slice(0, 8);
  const safe = caseNumber.replace(/[^\w.-]+/g, "_");
  return `${FILE_PREFIX[attestation.scope]}_Case-${safe}_PDF-v${attestation.pdfVersion}.pdf`;
}

export function downloadMedicalTrackerPdf(attestation: MedicalTrackerAttestation): void {
  buildMedicalTrackerPdf(attestation).save(medicalTrackerPdfFileName(attestation));
}

/** Attorney-facing medical summary: one row per provider plus totals. */
function drawMedicalSummary(doc: jsPDF, medical: MedicalSnapshotSection, startY: number, title: string | null) {
  const totals = medical.summary.totals;
  const y = title ? sectionTitle(doc, title, startY) : startY;
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    styles: { ...tableDefaults.styles, fontSize: 10.5, cellPadding: { top: 7, bottom: 7, left: 8, right: 8 } },
    head: [["Provider", "Total Charges", "Adjustments", "Paid", "Outstanding Balance"]],
    body: medical.summary.providers.length
      ? medical.summary.providers.map((p) => [
          p.providerName,
          money(p.charge),
          money(p.adjusted),
          money(p.paid),
          money(p.outstanding),
        ])
      : [["No medical providers recorded", "", "", "", ""]],
    foot: [["Total", money(totals.charge), money(totals.adjusted), money(totals.paid), money(totals.outstanding)]],
    footStyles,
    columnStyles: { 1: { cellWidth: 115 }, 2: { cellWidth: 115 }, 3: { cellWidth: 115 }, 4: { cellWidth: 135 } },
    didParseCell: rightAlignColumns([1, 2, 3, 4]),
  });
}

function categoryOf(e: ExpensesSnapshotSection["items"][number]): string {
  return e.expenseType?.trim() || "Uncategorized";
}

/** Where the money went: one row per expense category, largest first. */
function drawExpenseCategories(doc: jsPDF, expenses: ExpensesSnapshotSection, startY: number) {
  const byCategory = new Map<string, { count: number; amount: number; paid: number; outstanding: number }>();
  for (const e of expenses.items) {
    const row = byCategory.get(categoryOf(e)) ?? { count: 0, amount: 0, paid: 0, outstanding: 0 };
    row.count += 1;
    row.amount += e.amount;
    row.paid += e.paid;
    row.outstanding += e.outstanding;
    byCategory.set(categoryOf(e), row);
  }
  const rows = [...byCategory.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const t = expenses.totals;
  const y = sectionTitle(doc, "Expenses by Category", startY);
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [["Category", "Items", "Amount", "Paid", "Outstanding"]],
    body: rows.map(([category, r]) => [category, String(r.count), money(r.amount), money(r.paid), money(r.outstanding)]),
    foot: [["Total", String(expenses.items.length), money(t.amount), money(t.paid), money(t.outstanding)]],
    footStyles,
    columnStyles: { 1: { cellWidth: 60 }, 2: { cellWidth: 115 }, 3: { cellWidth: 115 }, 4: { cellWidth: 115 } },
    didParseCell: rightAlignColumns([1, 2, 3, 4]),
  });
}

function drawExpensesSection(doc: jsPDF, expenses: ExpensesSnapshotSection, startY: number) {
  if (!expenses.items.length) {
    const y = sectionTitle(doc, "Case Expenses", startY);
    autoTable(doc, { ...tableDefaults, startY: y, body: [["No case expenses recorded"]] });
    return;
  }

  drawExpenseCategories(doc, expenses, startY);

  const items = [...expenses.items].sort(
    (a, b) =>
      (a.invoiceDate ?? a.serviceDate ?? "9999").localeCompare(b.invoiceDate ?? b.serviceDate ?? "9999") ||
      a.vendorName.localeCompare(b.vendorName)
  );
  const y = sectionTitle(doc, "Expense Line Items", lastTableY(doc) + 26);
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [["Date", "Vendor", "Category", "Description", "Invoice #", "Amount", "Paid", "Status"]],
    body: items.map((e) => [
      date(e.invoiceDate ?? e.serviceDate),
      e.vendorName,
      categoryOf(e),
      e.description ?? "—",
      e.invoiceNumber ?? "—",
      money(e.amount),
      money(e.paid),
      CASE_EXPENSE_PAYMENT_LABELS[e.paymentStatus] ?? e.paymentStatus,
    ]),
    foot: [["Total", "", "", "", "", money(expenses.totals.amount), money(expenses.totals.paid), ""]],
    footStyles,
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 118 },
      2: { cellWidth: 90 },
      4: { cellWidth: 70 },
      5: { cellWidth: 72 },
      6: { cellWidth: 68 },
      7: { cellWidth: 70 },
    },
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

function drawCheckbox(doc: jsPDF, x: number, y: number) {
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.8);
  doc.rect(x, y - 7.5, 9, 9, "S");
  doc.setDrawColor(...PINK);
  doc.setLineWidth(1.4);
  doc.line(x + 1.8, y - 3.2, x + 3.8, y - 1);
  doc.line(x + 3.8, y - 1, x + 7.6, y - 6);
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

  let nextY = MARGIN + 76 + Math.max(0, versions.length - 1) * 15;
  if (medical && expenses) {
    drawCombinedSummary(doc, medical, expenses, nextY);
    nextY = lastTableY(doc) + 26;
  }
  if (medical) {
    drawMedicalSummary(doc, medical, nextY, expenses ? "Medical Expenses by Provider" : null);
    nextY = lastTableY(doc) + 26;
  }
  if (expenses) {
    drawExpensesSection(doc, expenses, nextY);
  }

  // Review certification
  const details: Array<[string, string]> = [
    ["Reviewed by:", attestation.reviewerName],
    ["Review completed:", formatCentralTime(attestation.attestedAt)],
    ...versions.map(([label, v]): [string, string] => [`${label} Version:`, String(v)]),
  ];
  const statementX = MARGIN + 340;
  const statementWidth = MARGIN + contentWidth - statementX - 34;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const statementLines = attestedStatementTitles(attestation).map(
    (title) => doc.splitTextToSize(title, statementWidth) as string[]
  );
  const statementHeight = statementLines.reduce((h, lines) => h + lines.length * 12 + 4, 0);
  const certHeight = 50 + Math.max(details.length * 15, statementHeight + 4);

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
  details.forEach(([label, value], i) => {
    const rowY = certTop + 46 + i * 15;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(label, MARGIN + 18, rowY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(value, MARGIN + 150, rowY);
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  let lineY = certTop + 46;
  for (const lines of statementLines) {
    drawCheckbox(doc, statementX, lineY);
    doc.text(lines, statementX + 16, lineY);
    lineY += lines.length * 12 + 4;
  }

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
