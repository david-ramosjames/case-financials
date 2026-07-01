export interface Case {
  id: string;
  name: string;
  clientName: string;
  caseNumber: string | null;
  causeNumber: string | null;
  status: "active" | "archived";
}

export type MedicalExpenseDocumentType =
  | "medical_bill"
  | "balance_statement"
  | "reduction_letter"
  | "payment_invoice"
  | "lop_statement"
  | "medical_provider_statement";

export type MedicalExpensePaymentStatus =
  | "pending_review"
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "reduced"
  | "waived"
  | "closed"
  | "pending_reduction"
  | "unknown";

export type MedicalExpenseReviewStatus =
  | "needs_review"
  | "reviewed"
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "paid";

export interface MedicalExpense {
  id: string;
  caseId: string | null;
  caseNumber: string;
  providerId: string | null;
  providerName: string;
  accountNumber: string | null;
  dateOfService: string | null;
  originalCharges: number | null;
  currentBalance: number | null;
  finalPayAmount: number | null;
  reducedFromAmount: number | null;
  payeeName: string | null;
  payeeAddress: string | null;
  documentType: MedicalExpenseDocumentType;
  paymentStatus: MedicalExpensePaymentStatus;
  reviewStatus: MedicalExpenseReviewStatus;
  dropboxFileId: string | null;
  dropboxFilePath: string | null;
  dropboxPermalink: string | null;
  extractionConfidence: number | null;
  documentExtractionConfidence: number | null;
  textExtractionMethod: string | null;
  createdAt: number;
  updatedAt: number;
}

export type CaseExpenseDocumentType =
  | "invoice"
  | "receipt"
  | "statement"
  | "check_copy"
  | "credit_card"
  | "vendor_bill"
  | "other";

export type CaseExpensePaymentStatus =
  | "pending_review"
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "waived"
  | "closed"
  | "unknown";

export type CaseExpenseReviewStatus =
  | "needs_review"
  | "reviewed"
  | "pending"
  | "in_review"
  | "approved"
  | "rejected";

export interface CaseExpense {
  id: string;
  caseId: string | null;
  caseNumber: string;
  vendorName: string;
  expenseType: string | null;
  description: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  serviceDate: string | null;
  amount: number | null;
  paymentStatus: CaseExpensePaymentStatus;
  paidAmount: number | null;
  checkNumber: string | null;
  payeeName: string | null;
  payeeAddress: string | null;
  referenceNumber: string | null;
  relatedParty: string | null;
  dropboxFileId: string | null;
  dropboxFilePath: string | null;
  dropboxPermalink: string | null;
  documentType: CaseExpenseDocumentType | null;
  reviewStatus: CaseExpenseReviewStatus;
  extractionConfidence: number | null;
  documentExtractionConfidence: number | null;
  textExtractionMethod: string | null;
  createdAt: number;
  updatedAt: number;
}
