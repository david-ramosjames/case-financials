import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type {
  Case,
  MedicalExpense,
  MedicalExpenseDocumentType,
  MedicalExpensePaymentStatus,
  MedicalExpenseReviewStatus,
} from "@/lib/types";

type Unsubscribe = () => void;

function clean<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function formatWriteError(context: string, err: { message?: string; code?: string }): string {
  return err.code ? `${context} (${err.code}): ${err.message}` : `${context}: ${err.message}`;
}

function caseFromRow(r: Record<string, unknown>): Case {
  return {
    id: r.id as string,
    name: r.name as string,
    clientName: r.client_name as string,
    caseNumber: (r.case_number as string) ?? null,
    causeNumber: (r.cause_number as string) ?? null,
    status: r.status as Case["status"],
  };
}

function medicalExpenseFromRow(r: Record<string, unknown>): MedicalExpense {
  return {
    id: r.id as string,
    caseId: (r.case_id as string) ?? null,
    caseNumber: r.case_number as string,
    providerId: (r.provider_id as string) ?? null,
    providerName: r.provider_name as string,
    accountNumber: (r.account_number as string) ?? null,
    dateOfService: (r.date_of_service as string) ?? null,
    originalCharges: r.original_charges != null ? Number(r.original_charges) : null,
    currentBalance: r.current_balance != null ? Number(r.current_balance) : null,
    finalPayAmount: r.final_pay_amount != null ? Number(r.final_pay_amount) : null,
    reducedFromAmount: r.reduced_from_amount != null ? Number(r.reduced_from_amount) : null,
    payeeName: (r.payee_name as string) ?? null,
    payeeAddress: (r.payee_address as string) ?? null,
    documentType: r.document_type as MedicalExpenseDocumentType,
    paymentStatus: r.payment_status as MedicalExpensePaymentStatus,
    reviewStatus: r.review_status as MedicalExpenseReviewStatus,
    dropboxFileId: (r.dropbox_file_id as string) ?? null,
    dropboxFilePath: (r.dropbox_file_path as string) ?? null,
    dropboxPermalink: (r.dropbox_permalink as string) ?? null,
    extractionConfidence: r.extraction_confidence != null ? Number(r.extraction_confidence) : null,
    documentExtractionConfidence:
      r.document_extraction_confidence != null ? Number(r.document_extraction_confidence) : null,
    textExtractionMethod: (r.text_extraction_method as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function medicalExpenseToRow(patch: Partial<MedicalExpense>): Record<string, unknown> {
  return clean({
    provider_name: patch.providerName,
    account_number: patch.accountNumber,
    date_of_service: patch.dateOfService,
    original_charges: patch.originalCharges,
    current_balance: patch.currentBalance,
    final_pay_amount: patch.finalPayAmount,
    reduced_from_amount: patch.reducedFromAmount,
    payee_name: patch.payeeName,
    payee_address: patch.payeeAddress,
    document_type: patch.documentType,
    payment_status: patch.paymentStatus,
    review_status: patch.reviewStatus,
    updated_at: Date.now(),
  });
}

export async function fetchCases(supabase: SupabaseClient): Promise<Case[]> {
  const { data, error } = await supabase
    .from("cases")
    .select("id,name,client_name,case_number,cause_number,status")
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => caseFromRow(r as Record<string, unknown>));
}

export async function fetchCase(supabase: SupabaseClient, caseId: string): Promise<Case | null> {
  const { data, error } = await supabase
    .from("cases")
    .select("id,name,client_name,case_number,cause_number,status")
    .eq("id", caseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return caseFromRow(data as Record<string, unknown>);
}

export function subscribeCase(
  supabase: SupabaseClient,
  caseId: string,
  cb: (c: Case | null) => void
): Unsubscribe {
  const load = async () => {
    try {
      cb(await fetchCase(supabase, caseId));
    } catch {
      cb(null);
    }
  };
  void load();
  const ch: RealtimeChannel = supabase
    .channel(`case:${caseId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cases", filter: `id=eq.${caseId}` },
      () => void load()
    )
    .subscribe();
  return () => void supabase.removeChannel(ch);
}

export async function fetchMedicalExpensesForCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<MedicalExpense[]> {
  const { data: caseRow } = await supabase
    .from("cases")
    .select("case_number")
    .eq("id", caseId)
    .maybeSingle();

  const caseNumber = (caseRow as { case_number?: string } | null)?.case_number?.trim();
  let query = supabase.from("case_medical_records").select("*");

  if (caseNumber) {
    query = query.or(`case_id.eq.${caseId},case_number.eq.${caseNumber}`);
  } else {
    query = query.eq("case_id", caseId);
  }

  const { data, error } = await query
    .order("date_of_service", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => medicalExpenseFromRow(r as Record<string, unknown>));
}

export function subscribeMedicalExpensesForCase(
  supabase: SupabaseClient,
  caseId: string,
  cb: (expenses: MedicalExpense[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      cb(await fetchMedicalExpensesForCase(supabase, caseId));
    } catch (e) {
      console.warn("[subscribeMedicalExpensesForCase]", e);
      cb([]);
    }
  };
  void load();
  const lane =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r${Date.now()}`;
  const ch = supabase
    .channel(`medical-expenses:${caseId}:${lane}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "case_medical_records" },
      () => void load()
    )
    .subscribe();
  return () => void supabase.removeChannel(ch);
}

export async function updateMedicalExpense(
  supabase: SupabaseClient,
  expenseId: string,
  patch: Partial<MedicalExpense>
): Promise<void> {
  const { error } = await supabase
    .from("case_medical_records")
    .update(medicalExpenseToRow(patch))
    .eq("id", expenseId);
  if (error) throw new Error(formatWriteError("Update medical expense", error));
}

export async function markMedicalExpenseReviewed(
  supabase: SupabaseClient,
  expenseId: string
): Promise<void> {
  const { error } = await supabase
    .from("case_medical_records")
    .update({ review_status: "reviewed", updated_at: Date.now() })
    .eq("id", expenseId);
  if (error) throw new Error(formatWriteError("Mark reviewed", error));
}
