import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { dropboxDisplayLabel, normalizeDropboxPermalink } from "@/lib/dropbox-link";
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

type Unsubscribe = () => void;

function clean<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function formatWriteError(context: string, err: { message?: string; code?: string }): string {
  return err.code ? `${context} (${err.code}): ${err.message}` : `${context}: ${err.message}`;
}

function parseTimestamp(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Date.parse(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
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
    createdAt: parseTimestamp(r.created_at),
    updatedAt: parseTimestamp(r.updated_at),
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

/** Firm-wide expense log — newest logged first. */
export async function fetchAllMedicalExpensesLog(
  supabase: SupabaseClient
): Promise<MedicalExpense[]> {
  const { data, error } = await supabase
    .from("case_medical_records")
    .select("*")
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

function medicalTrackerProviderFromRow(r: Record<string, unknown>): MedicalTrackerProvider {
  const lopFiles = Array.isArray(r.lop_files)
    ? r.lop_files.filter(
        (file): file is MedicalTrackerProvider["lopFiles"][number] =>
          Boolean(file) &&
          typeof file === "object" &&
          typeof (file as { name?: unknown }).name === "string" &&
          typeof (file as { url?: unknown }).url === "string"
      )
    : [];
  return {
    id: r.id as string,
    caseId: r.case_id as string,
    caseNumber: r.case_number as string,
    providerId: (r.provider_id as string) ?? null,
    providerName: r.provider_name as string,
    hasLop: r.has_lop == null ? null : Boolean(r.has_lop),
    lopFiles,
    treatmentFinishedDate: (r.treatment_finished_date as string) ?? null,
    medicalRequestedDate: (r.medical_requested_date as string) ?? null,
    medicalReceivedDate: (r.medical_received_date as string) ?? null,
    billingRequestedDate: (r.billing_requested_date as string) ?? null,
    billingReceivedDate: (r.billing_received_date as string) ?? null,
    createdAt: parseTimestamp(r.created_at),
    updatedAt: parseTimestamp(r.updated_at),
  };
}

export async function fetchMedicalTrackerForCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<MedicalTrackerProvider[]> {
  const { data, error } = await supabase
    .from("case_medical_tracker")
    .select("*")
    .eq("case_id", caseId)
    .order("provider_name");
  if (error) throw error;
  return (data ?? []).map((r) => medicalTrackerProviderFromRow(r as Record<string, unknown>));
}

export function subscribeMedicalTrackerForCase(
  supabase: SupabaseClient,
  caseId: string,
  cb: (providers: MedicalTrackerProvider[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      cb(await fetchMedicalTrackerForCase(supabase, caseId));
    } catch (e) {
      console.warn("[subscribeMedicalTrackerForCase]", e);
      cb([]);
    }
  };
  void load();
  const ch = supabase
    .channel(`medical-tracker:${caseId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "case_medical_tracker", filter: `case_id=eq.${caseId}` },
      () => void load()
    )
    .subscribe();
  return () => void supabase.removeChannel(ch);
}

export async function saveMedicalTrackerProvider(
  supabase: SupabaseClient,
  provider: Pick<MedicalTrackerProvider, "caseId" | "caseNumber" | "providerName"> &
    Partial<MedicalTrackerProvider>
): Promise<void> {
  const providerName = provider.providerName.trim();
  if (!providerName) throw new Error("Provider name is required");

  const row = {
    case_id: provider.caseId,
    case_number: provider.caseNumber,
    provider_id: provider.providerId ?? null,
    provider_name: providerName,
    has_lop: provider.hasLop ?? null,
    lop_files: provider.lopFiles ?? [],
    treatment_finished_date: provider.treatmentFinishedDate || null,
    medical_requested_date: provider.medicalRequestedDate || null,
    medical_received_date: provider.medicalReceivedDate || null,
    billing_requested_date: provider.billingRequestedDate || null,
    billing_received_date: provider.billingReceivedDate || null,
    updated_at: new Date().toISOString(),
  };

  const query = provider.id
    ? supabase.from("case_medical_tracker").update(row).eq("id", provider.id)
    : supabase
        .from("case_medical_tracker")
        .upsert(row, { onConflict: "case_id,normalized_provider_name" });
  const { error } = await query;
  if (error) throw new Error(formatWriteError("Save medical tracker", error));
}

export async function deleteMedicalTrackerProvider(
  supabase: SupabaseClient,
  providerId: string
): Promise<void> {
  const { error } = await supabase.from("case_medical_tracker").delete().eq("id", providerId);
  if (error) throw new Error(formatWriteError("Delete medical tracker", error));
}

export interface CaseMedicalImportSummary {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  importedRecords: number;
  skippedFiles: number;
  failedFiles: number;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

export async function fetchLatestMedicalImportForCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<CaseMedicalImportSummary | null> {
  const { data, error } = await supabase
    .from("medical_import_jobs")
    .select(
      "id, status, imported_records, skipped_files, failed_files, started_at, completed_at, created_at"
    )
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    status: row.status as CaseMedicalImportSummary["status"],
    importedRecords: Number(row.imported_records ?? 0),
    skippedFiles: Number(row.skipped_files ?? 0),
    failedFiles: Number(row.failed_files ?? 0),
    startedAt: row.started_at ? parseTimestamp(row.started_at) : null,
    completedAt: row.completed_at ? parseTimestamp(row.completed_at) : null,
    createdAt: parseTimestamp(row.created_at),
  };
}

export function subscribeAllMedicalExpensesLog(
  supabase: SupabaseClient,
  cb: (expenses: MedicalExpense[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      cb(await fetchAllMedicalExpensesLog(supabase));
    } catch (e) {
      console.warn("[subscribeAllMedicalExpensesLog]", e);
      cb([]);
    }
  };
  void load();
  const lane =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r${Date.now()}`;
  const ch = supabase
    .channel(`medical-expenses:log:${lane}`)
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

export async function markMedicalExpensePaid(
  supabase: SupabaseClient,
  expenseId: string
): Promise<void> {
  const { error } = await supabase
    .from("case_medical_records")
    .update({ payment_status: "paid", updated_at: Date.now() })
    .eq("id", expenseId);
  if (error) throw new Error(formatWriteError("Mark paid", error));
}

export type ManualMedicalExpenseInput = {
  providerName: string;
  dropboxPermalink: string;
  fileName?: string | null;
  documentType?: MedicalExpenseDocumentType;
  accountNumber?: string | null;
  dateOfService?: string | null;
  originalCharges?: number | null;
  currentBalance?: number | null;
  finalPayAmount?: number | null;
};

export async function createMedicalExpense(
  supabase: SupabaseClient,
  caseId: string,
  caseNumber: string,
  input: ManualMedicalExpenseInput
): Promise<void> {
  const permalink = normalizeDropboxPermalink(input.dropboxPermalink);
  const providerName = input.providerName.trim();
  if (!providerName) throw new Error("Provider name is required");

  const { error } = await supabase.from("case_medical_records").insert({
    case_id: caseId,
    case_number: caseNumber,
    provider_name: providerName,
    document_type: input.documentType ?? "medical_bill",
    payment_status: "unknown",
    review_status: "needs_review",
    dropbox_permalink: permalink,
    dropbox_file_path: dropboxDisplayLabel(permalink, input.fileName),
    account_number: input.accountNumber?.trim() || null,
    date_of_service: input.dateOfService || null,
    original_charges: input.originalCharges ?? null,
    current_balance: input.currentBalance ?? null,
    final_pay_amount: input.finalPayAmount ?? null,
    text_extraction_method: "manual",
  });
  if (error) throw new Error(formatWriteError("Create medical expense", error));
}

/* ── Case Expenses (vendor / case costs) ─────────────────────────── */

function caseExpenseFromRow(r: Record<string, unknown>): CaseExpense {
  return {
    id: r.id as string,
    caseId: (r.case_id as string) ?? null,
    caseNumber: r.case_number as string,
    vendorName: r.vendor_name as string,
    expenseType: (r.expense_type as string) ?? null,
    description: (r.description as string) ?? null,
    invoiceNumber: (r.invoice_number as string) ?? null,
    invoiceDate: (r.invoice_date as string) ?? null,
    serviceDate: (r.service_date as string) ?? null,
    amount: r.amount != null ? Number(r.amount) : null,
    paymentStatus: r.payment_status as CaseExpensePaymentStatus,
    paidAmount: r.paid_amount != null ? Number(r.paid_amount) : null,
    checkNumber: (r.check_number as string) ?? null,
    payeeName: (r.payee_name as string) ?? null,
    payeeAddress: (r.payee_address as string) ?? null,
    referenceNumber: (r.reference_number as string) ?? null,
    relatedParty: (r.related_party as string) ?? null,
    dropboxFileId: (r.dropbox_file_id as string) ?? null,
    dropboxFilePath: (r.dropbox_file_path as string) ?? null,
    dropboxPermalink: (r.dropbox_permalink as string) ?? null,
    documentType: (r.document_type as CaseExpenseDocumentType) ?? null,
    reviewStatus: r.review_status as CaseExpenseReviewStatus,
    extractionConfidence: r.extraction_confidence != null ? Number(r.extraction_confidence) : null,
    documentExtractionConfidence:
      r.document_extraction_confidence != null ? Number(r.document_extraction_confidence) : null,
    textExtractionMethod: (r.text_extraction_method as string) ?? null,
    createdAt: parseTimestamp(r.created_at),
    updatedAt: parseTimestamp(r.updated_at),
  };
}

function caseExpenseToRow(patch: Partial<CaseExpense>): Record<string, unknown> {
  return clean({
    vendor_name: patch.vendorName,
    expense_type: patch.expenseType,
    description: patch.description,
    invoice_number: patch.invoiceNumber,
    invoice_date: patch.invoiceDate,
    service_date: patch.serviceDate,
    amount: patch.amount,
    payment_status: patch.paymentStatus,
    paid_amount: patch.paidAmount,
    check_number: patch.checkNumber,
    payee_name: patch.payeeName,
    payee_address: patch.payeeAddress,
    reference_number: patch.referenceNumber,
    related_party: patch.relatedParty,
    document_type: patch.documentType,
    review_status: patch.reviewStatus,
    updated_at: Date.now(),
  });
}

export async function fetchCaseExpensesForCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<CaseExpense[]> {
  const { data: caseRow } = await supabase
    .from("cases")
    .select("case_number")
    .eq("id", caseId)
    .maybeSingle();

  const caseNumber = (caseRow as { case_number?: string } | null)?.case_number?.trim();
  let query = supabase.from("case_expenses").select("*");

  if (caseNumber) {
    query = query.or(`case_id.eq.${caseId},case_number.eq.${caseNumber}`);
  } else {
    query = query.eq("case_id", caseId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => caseExpenseFromRow(r as Record<string, unknown>));
}

export function subscribeCaseExpensesForCase(
  supabase: SupabaseClient,
  caseId: string,
  cb: (expenses: CaseExpense[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      cb(await fetchCaseExpensesForCase(supabase, caseId));
    } catch (e) {
      console.warn("[subscribeCaseExpensesForCase]", e);
      cb([]);
    }
  };
  void load();
  const lane =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r${Date.now()}`;
  const ch = supabase
    .channel(`case-expenses:${caseId}:${lane}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "case_expenses" }, () => void load())
    .subscribe();
  return () => void supabase.removeChannel(ch);
}

export async function fetchAllCaseExpensesLog(supabase: SupabaseClient): Promise<CaseExpense[]> {
  const { data, error } = await supabase
    .from("case_expenses")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => caseExpenseFromRow(r as Record<string, unknown>));
}

export function subscribeAllCaseExpensesLog(
  supabase: SupabaseClient,
  cb: (expenses: CaseExpense[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      cb(await fetchAllCaseExpensesLog(supabase));
    } catch (e) {
      console.warn("[subscribeAllCaseExpensesLog]", e);
      cb([]);
    }
  };
  void load();
  const lane =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r${Date.now()}`;
  const ch = supabase
    .channel(`case-expenses:log:${lane}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "case_expenses" }, () => void load())
    .subscribe();
  return () => void supabase.removeChannel(ch);
}

export async function updateCaseExpense(
  supabase: SupabaseClient,
  expenseId: string,
  patch: Partial<CaseExpense>
): Promise<void> {
  const { error } = await supabase
    .from("case_expenses")
    .update(caseExpenseToRow(patch))
    .eq("id", expenseId);
  if (error) throw new Error(formatWriteError("Update case expense", error));
}

export async function markCaseExpenseReviewed(
  supabase: SupabaseClient,
  expenseId: string
): Promise<void> {
  const { error } = await supabase
    .from("case_expenses")
    .update({ review_status: "reviewed", updated_at: Date.now() })
    .eq("id", expenseId);
  if (error) throw new Error(formatWriteError("Mark case expense reviewed", error));
}

export async function markCaseExpensePaid(
  supabase: SupabaseClient,
  expenseId: string,
  amount: number | null
): Promise<void> {
  const { error } = await supabase
    .from("case_expenses")
    .update({
      payment_status: "paid",
      paid_amount: amount,
      updated_at: Date.now(),
    })
    .eq("id", expenseId);
  if (error) throw new Error(formatWriteError("Mark case expense paid", error));
}

export type ManualCaseExpenseInput = {
  vendorName: string;
  dropboxPermalink: string;
  fileName?: string | null;
  expenseType?: string | null;
  description?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  amount?: number | null;
  documentType?: CaseExpenseDocumentType | null;
};

export async function createCaseExpense(
  supabase: SupabaseClient,
  caseId: string,
  caseNumber: string,
  input: ManualCaseExpenseInput
): Promise<void> {
  const permalink = normalizeDropboxPermalink(input.dropboxPermalink);
  const vendorName = input.vendorName.trim();
  if (!vendorName) throw new Error("Vendor name is required");

  const { error } = await supabase.from("case_expenses").insert({
    case_id: caseId,
    case_number: caseNumber,
    vendor_name: vendorName,
    expense_type: input.expenseType?.trim() || null,
    description: input.description?.trim() || null,
    invoice_number: input.invoiceNumber?.trim() || null,
    invoice_date: input.invoiceDate || null,
    amount: input.amount ?? null,
    document_type: input.documentType ?? null,
    payment_status: "pending_review",
    review_status: "needs_review",
    dropbox_permalink: permalink,
    dropbox_file_path: dropboxDisplayLabel(permalink, input.fileName),
    text_extraction_method: "manual",
  });
  if (error) throw new Error(formatWriteError("Create case expense", error));
}
