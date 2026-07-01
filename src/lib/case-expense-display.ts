import type { CaseExpenseDocumentType, CaseExpensePaymentStatus, CaseExpenseReviewStatus } from "@/lib/types";

export const CASE_EXPENSE_DOC_LABELS: Record<CaseExpenseDocumentType, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  statement: "Statement",
  check_copy: "Check Copy",
  credit_card: "Credit Card",
  vendor_bill: "Vendor Bill",
  other: "Other",
};

export const CASE_EXPENSE_PAYMENT_LABELS: Record<CaseExpensePaymentStatus, string> = {
  pending_review: "Pending Review",
  unpaid: "Unpaid",
  partially_paid: "Partially Paid",
  paid: "Paid",
  waived: "Waived",
  closed: "Closed",
  unknown: "Unknown",
};

export const CASE_EXPENSE_REVIEW_LABELS: Record<CaseExpenseReviewStatus, string> = {
  needs_review: "Needs Review",
  reviewed: "Reviewed",
  pending: "Pending",
  in_review: "In Review",
  approved: "Approved",
  rejected: "Rejected",
};

export { formatCurrency, formatLoggedAt, sourceFileName, reviewBadgeVariant, paymentBadgeVariant } from "@/lib/medical-expense-display";
