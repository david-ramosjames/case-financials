import { caseDisplayName } from "@/lib/case-display";
import { isCasePaid, needsCaseReview, needsMedicalReview } from "@/lib/expense-review";
import { sourceFileName } from "@/lib/medical-expense-display";
import {
  buildMedicalProviderSummary,
  deriveLineAmounts,
  type MedicalSummaryTotals,
  type ProviderRollup,
} from "@/lib/medical-provider-summary";
import { buildMedicalLedger } from "@/lib/medical-ledger";
import { mergeProviders } from "@/components/MedicalTracker";
import type {
  Case,
  CaseExpense,
  CaseExpenseDocumentType,
  CaseExpensePaymentStatus,
  CaseExpenseReviewStatus,
  MedicalExpense,
  MedicalExpenseDocumentType,
  MedicalExpensePaymentStatus,
  MedicalExpenseReviewStatus,
  MedicalTrackerProvider,
} from "@/lib/types";

export type CertificationScope = "medical" | "expenses" | "all";

export const CERTIFICATION_SCOPES: CertificationScope[] = ["medical", "expenses", "all"];

export const SCOPE_LABELS: Record<CertificationScope, string> = {
  medical: "Medical Tracker",
  expenses: "Case Expenses",
  all: "All",
};

export const SCOPE_DOCUMENT_TITLES: Record<CertificationScope, string> = {
  medical: "Medical Tracker Summary",
  expenses: "Case Expenses Summary",
  all: "Case Financial Summary",
};

export function scopeIncludesMedical(scope: CertificationScope): boolean {
  return scope === "medical" || scope === "all";
}

export function scopeIncludesExpenses(scope: CertificationScope): boolean {
  return scope === "expenses" || scope === "all";
}

export interface AttestationStatement {
  id: string;
  title: string;
  detail: string;
}

interface StatementSet {
  /** Bump when statement wording changes so old attestations keep their original meaning. */
  version: string;
  statements: AttestationStatement[];
}

export const ATTESTATION_STATEMENT_SETS: Record<CertificationScope, StatementSet> = {
  medical: {
    version: "medical-tracker-v1",
    statements: [
      {
        id: "providers_complete",
        title: "I reviewed the medical providers and records for completeness.",
        detail:
          "I confirmed that the providers and medical expenses shown are complete to the best of my knowledge.",
      },
      {
        id: "amounts_accurate",
        title: "I reviewed the charges and balances for accuracy.",
        detail:
          "I verified the amounts against the available bills, records, and supporting documents.",
      },
      {
        id: "duplicates_checked",
        title: "I checked for duplicate or incorrect entries.",
        detail:
          "I reviewed the tracker for duplicate bills, repeated invoices, incorrect providers, and other obvious extraction errors.",
      },
      {
        id: "flags_reviewed",
        title: "I reviewed any items flagged by the system.",
        detail:
          "I resolved or reviewed entries identified as potentially incomplete, uncertain, or requiring manual attention.",
      },
      {
        id: "approve_for_use",
        title: "I approve this Medical Tracker for use.",
        detail:
          "I have reviewed the information above and approve this version to be generated as the Medical Tracker PDF.",
      },
    ],
  },
  expenses: {
    version: "case-expenses-v1",
    statements: [
      {
        id: "expenses_complete",
        title: "I reviewed the case expenses for completeness.",
        detail:
          "I confirmed that the vendors and case expenses shown are complete to the best of my knowledge.",
      },
      {
        id: "amounts_accurate",
        title: "I reviewed the amounts and payment status for accuracy.",
        detail:
          "I verified the amounts, invoice numbers, and paid status against the available invoices, receipts, and supporting documents.",
      },
      {
        id: "duplicates_checked",
        title: "I checked for duplicate or incorrect entries.",
        detail:
          "I reviewed the expenses for duplicate invoices, repeated receipts, incorrect vendors, and other obvious extraction errors.",
      },
      {
        id: "flags_reviewed",
        title: "I reviewed any items flagged by the system.",
        detail:
          "I resolved or reviewed entries identified as potentially incomplete, uncertain, or requiring manual attention.",
      },
      {
        id: "approve_for_use",
        title: "I approve these Case Expenses for use.",
        detail:
          "I have reviewed the information above and approve this version to be generated as the Case Expenses PDF.",
      },
    ],
  },
  all: {
    version: "case-financials-all-v1",
    statements: [
      {
        id: "records_complete",
        title: "I reviewed the medical providers, records, and case expenses for completeness.",
        detail:
          "I confirmed that the providers, medical expenses, vendors, and case expenses shown are complete to the best of my knowledge.",
      },
      {
        id: "amounts_accurate",
        title: "I reviewed the charges, balances, and expense amounts for accuracy.",
        detail:
          "I verified the amounts against the available bills, records, invoices, receipts, and supporting documents.",
      },
      {
        id: "duplicates_checked",
        title: "I checked for duplicate or incorrect entries.",
        detail:
          "I reviewed the medical tracker and case expenses for duplicate bills, repeated invoices or receipts, incorrect providers or vendors, and other obvious extraction errors.",
      },
      {
        id: "flags_reviewed",
        title: "I reviewed any items flagged by the system.",
        detail:
          "I resolved or reviewed entries identified as potentially incomplete, uncertain, or requiring manual attention.",
      },
      {
        id: "approve_for_use",
        title: "I approve this Case Financial Summary for use.",
        detail:
          "I have reviewed the information above and approve this version to be generated as the Case Financial Summary PDF.",
      },
    ],
  },
};

export interface AttestationStatementRecord {
  id: string;
  version: string;
  text: string;
  checked: boolean;
}

export interface SnapshotProvider {
  providerName: string;
  hasLop: boolean | null;
  lopFileCount: number;
  treatmentFinishedDate: string | null;
  medicalRequestedDate: string | null;
  medicalReceivedDate: string | null;
  billingRequestedDate: string | null;
  billingReceivedDate: string | null;
}

export interface SnapshotInvoice {
  id: string;
  providerName: string;
  documentType: MedicalExpenseDocumentType;
  accountNumber: string | null;
  dateOfService: string | null;
  originalCharges: number | null;
  currentBalance: number | null;
  finalPayAmount: number | null;
  reducedFromAmount: number | null;
  paymentStatus: MedicalExpensePaymentStatus;
  reviewStatus: MedicalExpenseReviewStatus;
  extractionConfidence: number | null;
  sourceFile: string | null;
  charge: number;
  paid: number;
  adjusted: number;
  outstanding: number;
}

export interface SnapshotCaseExpense {
  id: string;
  vendorName: string;
  expenseType: string | null;
  description: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  serviceDate: string | null;
  documentType: CaseExpenseDocumentType | null;
  paymentStatus: CaseExpensePaymentStatus;
  reviewStatus: CaseExpenseReviewStatus;
  extractionConfidence: number | null;
  sourceFile: string | null;
  amount: number;
  paid: number;
  outstanding: number;
}

export interface MedicalSnapshotSection {
  providers: SnapshotProvider[];
  invoices: SnapshotInvoice[];
  summary: { providers: ProviderRollup[]; totals: MedicalSummaryTotals };
  lopProviderCount: number;
  flaggedCount: number;
}

export interface ExpensesSnapshotSection {
  items: SnapshotCaseExpense[];
  totals: { amount: number; paid: number; outstanding: number; vendors: number };
  flaggedCount: number;
}

export interface TrackerSnapshot {
  schema: 2;
  scope: CertificationScope;
  case: {
    id: string;
    displayName: string;
    clientName: string;
    caseNumber: string | null;
    causeNumber: string | null;
    dateOfIncident: string | null;
  };
  medical: MedicalSnapshotSection | null;
  expenses: ExpensesSnapshotSection | null;
}

export interface FinancialVersions {
  medical: number;
  expenses: number;
}

export interface MedicalTrackerAttestation {
  id: string;
  caseId: string;
  caseNumber: string | null;
  scope: CertificationScope;
  reviewerUserId: string;
  reviewerName: string;
  reviewerEmail: string | null;
  attestedAt: string;
  trackerVersion: number;
  expensesVersion: number;
  pdfVersion: number;
  statementSetVersion: string;
  statements: AttestationStatementRecord[];
  snapshot: TrackerSnapshot;
  snapshotHash: string;
}

export function isAttestationCurrent(
  att: MedicalTrackerAttestation,
  versions: FinancialVersions
): boolean {
  if (scopeIncludesMedical(att.scope) && att.trackerVersion !== versions.medical) return false;
  if (scopeIncludesExpenses(att.scope) && att.expensesVersion !== versions.expenses) return false;
  return true;
}

export function isFlaggedInvoice(e: MedicalExpense): boolean {
  return (
    needsMedicalReview(e) ||
    (e.extractionConfidence != null && e.extractionConfidence < 0.8)
  );
}

export function isFlaggedCaseExpense(e: CaseExpense): boolean {
  return (
    needsCaseReview(e) ||
    (e.extractionConfidence != null && e.extractionConfidence < 0.8)
  );
}

function compareText(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { numeric: true, sensitivity: "base" });
}

function buildMedicalSection(
  caseRecord: Case,
  trackedProviders: MedicalTrackerProvider[],
  allExpenses: MedicalExpense[]
): MedicalSnapshotSection {
  const expenses = buildMedicalLedger(allExpenses).counted;
  const lopRank = (p: MedicalTrackerProvider) => (p.hasLop === true ? 0 : p.hasLop === false ? 1 : 2);
  const providers = mergeProviders(
    caseRecord.id,
    caseRecord.caseNumber ?? "",
    trackedProviders,
    expenses
  )
    .sort((a, b) => lopRank(a) - lopRank(b) || compareText(a.providerName, b.providerName))
    .map<SnapshotProvider>((p) => ({
      providerName: p.providerName.trim(),
      hasLop: p.hasLop,
      lopFileCount: p.lopFiles.length,
      treatmentFinishedDate: p.treatmentFinishedDate,
      medicalRequestedDate: p.medicalRequestedDate,
      medicalReceivedDate: p.medicalReceivedDate,
      billingRequestedDate: p.billingRequestedDate,
      billingReceivedDate: p.billingReceivedDate,
    }));

  const invoices = [...expenses]
    .sort(
      (a, b) =>
        compareText(a.providerName, b.providerName) ||
        compareText(a.dateOfService, b.dateOfService) ||
        a.id.localeCompare(b.id)
    )
    .map<SnapshotInvoice>((e) => ({
      id: e.id,
      providerName: e.providerName.trim() || "Unknown provider",
      documentType: e.documentType,
      accountNumber: e.accountNumber,
      dateOfService: e.dateOfService,
      originalCharges: e.originalCharges,
      currentBalance: e.currentBalance,
      finalPayAmount: e.finalPayAmount,
      reducedFromAmount: e.reducedFromAmount,
      paymentStatus: e.paymentStatus,
      reviewStatus: e.reviewStatus,
      extractionConfidence: e.extractionConfidence,
      sourceFile: e.dropboxFilePath ? sourceFileName(e.dropboxFilePath) : null,
      ...deriveLineAmounts(e),
    }));

  return {
    providers,
    invoices,
    summary: buildMedicalProviderSummary(expenses),
    lopProviderCount: providers.filter((p) => p.hasLop === true).length,
    flaggedCount: expenses.filter(isFlaggedInvoice).length,
  };
}

function buildExpensesSection(caseExpenses: CaseExpense[]): ExpensesSnapshotSection {
  const items = [...caseExpenses]
    .sort(
      (a, b) =>
        compareText(a.vendorName, b.vendorName) ||
        compareText(a.invoiceDate ?? a.serviceDate, b.invoiceDate ?? b.serviceDate) ||
        a.id.localeCompare(b.id)
    )
    .map<SnapshotCaseExpense>((e) => {
      const amount = e.amount ?? 0;
      const paid = e.paidAmount ?? 0;
      return {
        id: e.id,
        vendorName: e.vendorName.trim() || "Unknown vendor",
        expenseType: e.expenseType,
        description: e.description,
        invoiceNumber: e.invoiceNumber,
        invoiceDate: e.invoiceDate,
        serviceDate: e.serviceDate,
        documentType: e.documentType,
        paymentStatus: e.paymentStatus,
        reviewStatus: e.reviewStatus,
        extractionConfidence: e.extractionConfidence,
        sourceFile: e.dropboxFilePath ? sourceFileName(e.dropboxFilePath) : null,
        amount,
        paid,
        outstanding: isCasePaid(e) ? 0 : Math.max(0, amount - paid),
      };
    });

  return {
    items,
    totals: {
      amount: items.reduce((s, i) => s + i.amount, 0),
      paid: items.reduce((s, i) => s + i.paid, 0),
      outstanding: items.reduce((s, i) => s + i.outstanding, 0),
      vendors: new Set(items.map((i) => i.vendorName.toLowerCase())).size,
    },
    flaggedCount: caseExpenses.filter(isFlaggedCaseExpense).length,
  };
}

export function buildTrackerSnapshot(
  scope: CertificationScope,
  caseRecord: Case,
  trackedProviders: MedicalTrackerProvider[],
  medicalExpenses: MedicalExpense[],
  caseExpenses: CaseExpense[]
): TrackerSnapshot {
  return {
    schema: 2,
    scope,
    case: {
      id: caseRecord.id,
      displayName: caseDisplayName(caseRecord),
      clientName: caseRecord.clientName,
      caseNumber: caseRecord.caseNumber,
      causeNumber: caseRecord.causeNumber,
      dateOfIncident: caseRecord.dateOfIncident,
    },
    medical: scopeIncludesMedical(scope)
      ? buildMedicalSection(caseRecord, trackedProviders, medicalExpenses)
      : null,
    expenses: scopeIncludesExpenses(scope) ? buildExpensesSection(caseExpenses) : null,
  };
}

/** Upgrades snapshots stored before scopes existed (medical-only, schema 1). */
export function normalizeSnapshot(raw: unknown, scope: CertificationScope): TrackerSnapshot {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (s.schema === 2) return s as unknown as TrackerSnapshot;
  return {
    schema: 2,
    scope,
    case: s.case as TrackerSnapshot["case"],
    medical: {
      providers: (s.providers as SnapshotProvider[]) ?? [],
      invoices: (s.invoices as SnapshotInvoice[]) ?? [],
      summary: s.summary as MedicalSnapshotSection["summary"],
      lopProviderCount: Number(s.lopProviderCount ?? 0),
      flaggedCount: Number(s.flaggedCount ?? 0),
    },
    expenses: null,
  };
}

export async function hashSnapshot(snapshot: TrackerSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildStatementRecords(
  scope: CertificationScope,
  checked: Record<string, boolean>
): AttestationStatementRecord[] {
  const set = ATTESTATION_STATEMENT_SETS[scope];
  return set.statements.map((s) => ({
    id: s.id,
    version: set.version,
    text: `${s.title} ${s.detail}`,
    checked: checked[s.id] === true,
  }));
}

/** e.g. "September 30, 2026 at 1:42 PM CT" */
export function formatCentralTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} at ${time} CT`;
}

export function reviewerDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = user.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );
  return name?.trim() || user.email || "Unknown reviewer";
}
