import type {
  MedicalExpenseDocumentType,
  MedicalExpensePaymentStatus,
  MedicalExpenseReviewStatus,
} from "@/lib/types";

export const DOCUMENT_TYPE_LABELS: Record<MedicalExpenseDocumentType, string> = {
  medical_bill: "Medical Bill",
  balance_statement: "Balance Statement",
  reduction_letter: "Reduction Letter",
  payment_invoice: "Payment Invoice",
  lop_statement: "LOP Statement",
  medical_provider_statement: "Provider Statement",
};

export const PAYMENT_STATUS_LABELS: Record<MedicalExpensePaymentStatus, string> = {
  pending_review: "Pending Review",
  unpaid: "Unpaid",
  partially_paid: "Partially Paid",
  paid: "Paid",
  reduced: "Reduced",
  waived: "Waived",
  closed: "Closed",
  pending_reduction: "Pending Reduction",
  unknown: "Unknown",
};

export const REVIEW_STATUS_LABELS: Record<MedicalExpenseReviewStatus, string> = {
  needs_review: "Needs Review",
  reviewed: "Reviewed",
  pending: "Pending",
  in_review: "In Review",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
};

export function formatCurrency(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatLoggedAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

export function sourceFileName(path: string | null): string {
  if (!path) return "—";
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function reviewBadgeVariant(
  status: MedicalExpenseReviewStatus
): "warning" | "success" | "default" {
  if (status === "needs_review" || status === "pending" || status === "in_review") return "warning";
  if (status === "reviewed" || status === "approved") return "success";
  return "default";
}

export function paymentBadgeVariant(
  status: MedicalExpensePaymentStatus
): "warning" | "success" | "primary" | "default" {
  if (status === "unpaid" || status === "pending_review" || status === "partially_paid") return "warning";
  if (status === "paid" || status === "closed" || status === "waived") return "success";
  if (status === "reduced") return "primary";
  return "default";
}
