import { getBrowserSupabase } from "@/lib/supabase/singleton";

export interface MedicalImportFolderPreview {
  name: string;
  path: string;
  scannedFiles: number;
  includedFiles: number;
  excludedFiles: number;
  lopFiles: number;
  medicalFiles: number;
  expenseFiles: number;
  providerFolders: string[];
  vendorFolders: string[];
}

export type ImportFileSection = "lop" | "medical" | "expenses";

export interface ImportExcludedFile {
  name: string;
  path: string;
  url: string | null;
  reason: string;
  section: ImportFileSection;
}

export interface MedicalImportJob {
  id: string;
  caseId: string;
  caseNumber: string;
  dropboxCasePath: string;
  status: "queued" | "running" | "completed" | "failed";
  totalFiles: number;
  scannedFiles: number;
  excludedFiles: number;
  excludedFileList: ImportExcludedFile[];
  processedFiles: number;
  importedRecords: number;
  skippedFiles: number;
  alreadyImportedFiles: number;
  noDataFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export function formatImportScanSummary(opts: {
  scannedFiles?: number;
  includedFiles?: number;
  excludedFiles?: number;
  totalFiles?: number;
}): string {
  const included = opts.includedFiles ?? opts.totalFiles ?? 0;
  const scanned = opts.scannedFiles || included + (opts.excludedFiles ?? 0);
  const excluded = opts.excludedFiles ?? Math.max(0, scanned - included);
  return `${scanned} scanned · ${included} included · ${excluded} not included`;
}

function apiBase(): string {
  const value = process.env.NEXT_PUBLIC_FILE_SORTER_URL?.trim().replace(/\/+$/, "");
  if (!value) throw new Error("Dropbox import is not configured");
  return value;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await getBrowserSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to use Dropbox import");

  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Import request failed (${response.status})`);
  return body;
}

function normalizeJob(job: MedicalImportJob): MedicalImportJob {
  const totalFiles = Number(job.totalFiles ?? 0);
  const scannedFiles = Number(job.scannedFiles ?? 0) || totalFiles;
  const excludedFiles =
    Number(job.excludedFiles ?? 0) || Math.max(0, scannedFiles - totalFiles);
  return {
    ...job,
    totalFiles,
    scannedFiles,
    excludedFiles,
    excludedFileList: Array.isArray(job.excludedFileList) ? job.excludedFileList : [],
    alreadyImportedFiles: Number(job.alreadyImportedFiles ?? 0),
    noDataFiles: Number(job.noDataFiles ?? 0),
    skippedFiles: Number(job.skippedFiles ?? 0),
    importedRecords: Number(job.importedRecords ?? 0),
    failedFiles: Number(job.failedFiles ?? 0),
    processedFiles: Number(job.processedFiles ?? 0),
  };
}

export function isMedicalImportConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FILE_SORTER_URL?.trim());
}

export async function previewMedicalImportFolders(
  caseNumber: string
): Promise<MedicalImportFolderPreview[]> {
  const result = await request<{ folders: MedicalImportFolderPreview[] }>(
    `/medical-import/folders?caseNumber=${encodeURIComponent(caseNumber)}`
  );
  return result.folders;
}

export async function launchMedicalImport(opts: {
  caseId: string;
  caseNumber: string;
  folderPath: string;
}): Promise<MedicalImportJob> {
  const result = await request<{ job: MedicalImportJob }>("/medical-import/jobs", {
    method: "POST",
    body: JSON.stringify(opts),
  });
  return normalizeJob(result.job);
}

export async function fetchMedicalImportJob(jobId: string): Promise<MedicalImportJob> {
  const result = await request<{ job: MedicalImportJob }>(`/medical-import/jobs/${jobId}`);
  return normalizeJob(result.job);
}
