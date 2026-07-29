"use client";

import { useEffect, useState } from "react";
import {
  fetchLatestMedicalImportForCase,
  type CaseMedicalImportSummary,
} from "@/lib/supabase/repo";
import { formatImportScanSummary } from "@/lib/medical-import-api";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { FinancialSection } from "@/components/FinancialSection";
import { Badge } from "@/components/ui";
import type { ImportExcludedFile } from "@/lib/medical-import-api";

const SECTION_LABEL: Record<ImportExcludedFile["section"], string> = {
  lop: "LOP",
  medical: "Medical",
  expenses: "Expenses",
};

export function ImportExcludedFilesSection({ caseId }: { caseId: string }) {
  const [summary, setSummary] = useState<CaseMedicalImportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchLatestMedicalImportForCase(getBrowserSupabase(), caseId)
      .then((row) => {
        if (!cancelled) setSummary(row);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  if (loading || !summary || summary.status === "queued" || summary.status === "running") {
    return null;
  }

  const scanned = summary.scannedFiles || summary.includedFiles + summary.excludedFiles;
  if (scanned <= 0) return null;

  const excluded = summary.excludedFileList;

  return (
    <FinancialSection
      id="dropbox-not-included"
      level={3}
      title="Dropbox files not included"
      description={`Last import: ${formatImportScanSummary(summary)}. These files are in LOP, Medical, or Expenses but use a file type the importer does not read (PDF, Word, PNG, JPG, WEBP only).`}
    >
      {excluded.length === 0 ? (
        <p className="text-sm text-text-muted">Every scanned file was included in the import.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface-alt/30">
          {excluded.map((file) => (
            <li key={file.path} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                {file.url ? (
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent hover:underline"
                  >
                    {file.name}
                  </a>
                ) : (
                  <span className="font-medium text-text">{file.name}</span>
                )}
                <p className="mt-0.5 text-[13px] text-text-muted">{file.reason}</p>
              </div>
              <Badge variant="default">{SECTION_LABEL[file.section]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </FinancialSection>
  );
}
