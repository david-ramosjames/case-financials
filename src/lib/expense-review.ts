import type { CaseExpense, MedicalExpense } from "@/lib/types";

export function needsMedicalReview(e: MedicalExpense): boolean {
  return e.reviewStatus === "needs_review" || e.reviewStatus === "pending" || e.reviewStatus === "in_review";
}

export function needsCaseReview(e: CaseExpense): boolean {
  return e.reviewStatus === "needs_review" || e.reviewStatus === "pending" || e.reviewStatus === "in_review";
}

export function isMedicalPaid(e: MedicalExpense): boolean {
  return e.paymentStatus === "paid" || e.paymentStatus === "closed" || e.paymentStatus === "waived";
}

export function isCasePaid(e: CaseExpense): boolean {
  return e.paymentStatus === "paid" || e.paymentStatus === "closed" || e.paymentStatus === "waived";
}

export function formatConfidence(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function confidenceVariant(value: number | null): "warning" | "success" | "default" {
  if (value == null) return "default";
  if (value < 0.8) return "warning";
  if (value >= 0.95) return "success";
  return "default";
}
