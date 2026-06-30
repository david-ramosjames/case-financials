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
