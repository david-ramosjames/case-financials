"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchMedicalImportJob,
  isMedicalImportConfigured,
  launchMedicalImport,
  previewMedicalImportFolders,
  type MedicalImportFolderPreview,
  type MedicalImportJob,
} from "@/lib/medical-import-api";
import {
  fetchLatestMedicalImportForCase,
  type CaseMedicalImportSummary,
} from "@/lib/supabase/repo";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { Badge, Button, Card, CardBody, CardHeader, Select, Spinner } from "@/components/ui";

function formatImportWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function lastImportLabel(summary: CaseMedicalImportSummary): string {
  const when = summary.completedAt ?? summary.startedAt ?? summary.createdAt;
  const stamp = formatImportWhen(when);
  if (summary.status === "completed") return `Last import: ${stamp}`;
  if (summary.status === "failed") return `Last import failed: ${stamp}`;
  if (summary.status === "running" || summary.status === "queued") {
    return `Import ${summary.status}: started ${stamp}`;
  }
  return `Last import: ${stamp}`;
}

export function MedicalFolderImport({
  caseId,
  caseNumber,
}: {
  caseId: string;
  caseNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [folders, setFolders] = useState<MedicalImportFolderPreview[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [job, setJob] = useState<MedicalImportJob | null>(null);
  const [lastImport, setLastImport] = useState<CaseMedicalImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = isMedicalImportConfigured();

  const selected = useMemo(
    () => folders.find((folder) => folder.path === selectedPath) ?? null,
    [folders, selectedPath]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchLatestMedicalImportForCase(getBrowserSupabase(), caseId)
      .then((summary) => {
        if (!cancelled) setLastImport(summary);
      })
      .catch(() => {
        if (!cancelled) setLastImport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    const timer = window.setInterval(() => {
      void fetchMedicalImportJob(job.id)
        .then(setJob)
        .catch((e) => setError(e instanceof Error ? e.message : "Could not refresh import"));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job]);

  useEffect(() => {
    if (job?.status !== "completed") return;
    const timer = window.setTimeout(() => {
      window.location.reload();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [job?.status]);

  const loadFolders = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const result = await previewMedicalImportFolders(caseNumber);
      setFolders(result);
      setSelectedPath(result[0]?.path ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not find Dropbox case folder");
    } finally {
      setLoading(false);
    }
  };

  const launch = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      setJob(
        await launchMedicalImport({
          caseId,
          caseNumber,
          folderPath: selected.path,
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start import");
    } finally {
      setLoading(false);
    }
  };

  if (!configured) return null;

  const lastImportMeta = lastImport ? (
    <p className="text-sm text-text-muted">
      {lastImportLabel(lastImport)}
      {lastImport.status === "completed" && (
        <span className="text-text-dim">
          {" "}
          · {lastImport.importedRecords} imported
          {lastImport.failedFiles > 0 ? ` · ${lastImport.failedFiles} failed` : ""}
        </span>
      )}
    </p>
  ) : (
    <p className="text-sm text-text-muted">No Dropbox medical import has been run on this case yet.</p>
  );

  if (!open) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="secondary" onClick={() => void loadFolders()}>
          Import existing Dropbox medical files
        </Button>
        {lastImportMeta}
      </div>
    );
  }

  const active = job?.status === "queued" || job?.status === "running";
  const progress =
    job && job.totalFiles > 0 ? Math.round((job.processedFiles / job.totalFiles) * 100) : 0;

  return (
    <Card className="mt-4 border-primary/25">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-text">Import existing medical files</h2>
            <p className="mt-1 text-sm text-text-muted">
              Recursively scans the selected case’s LOP and Medical folders. Nothing is posted to Slack.
            </p>
            <div className="mt-2">{lastImportMeta}</div>
          </div>
          {!active && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}

        {loading && !folders.length && !job ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Spinner className="h-4 w-4" /> Finding matching Dropbox folders…
          </div>
        ) : !job ? (
          <>
            {folders.length ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">Dropbox case folder</label>
                  <Select value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)}>
                    {folders.map((folder) => (
                      <option key={folder.path} value={folder.path}>{folder.name}</option>
                    ))}
                  </Select>
                </div>
                {selected && (
                  <div className="rounded-xl border border-border bg-surface-alt/50 p-4 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="primary">{selected.medicalFiles} Medical files</Badge>
                      <Badge variant="warning">{selected.lopFiles} LOP files</Badge>
                      <Badge>{selected.providerFolders.length} provider folders</Badge>
                    </div>
                    {selected.providerFolders.length > 0 && (
                      <p className="mt-3 text-text-secondary">
                        Providers found: {selected.providerFolders.join(", ")}
                      </p>
                    )}
                    <p className="mt-2 break-all text-xs text-text-dim">{selected.path}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button disabled={loading || !selected} onClick={() => void launch()}>
                    {loading ? <Spinner className="h-4 w-4" /> : "Start silent import"}
                  </Button>
                  <Button variant="ghost" disabled={loading} onClick={() => setOpen(false)}>Cancel</Button>
                </div>
              </>
            ) : (
              <div>
                <p className="text-sm text-warning">No Dropbox case folder matched case #{caseNumber}.</p>
                <Button className="mt-3" size="sm" variant="secondary" onClick={() => void loadFolders()}>
                  Search again
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium capitalize text-text">{job.status}</span>
              <span className="tabular-nums text-text-muted">
                {job.processedFiles} / {job.totalFiles} files
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-alt">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">{job.importedRecords} records imported</Badge>
              <Badge>{job.skippedFiles} skipped/duplicates</Badge>
              {job.failedFiles > 0 && <Badge variant="danger">{job.failedFiles} failed</Badge>}
            </div>
            {job.status === "completed" && (
              <p className="text-sm text-success">
                Import complete. Refreshing page so new providers and invoices appear…
              </p>
            )}
            {job.status === "failed" && (
              <p className="text-sm text-danger">{job.errorMessage ?? "Import failed"}</p>
            )}
            {job.status === "completed" && job.failedFiles > 0 && job.errorMessage && (
              <p className="text-sm text-danger whitespace-pre-wrap break-words">{job.errorMessage}</p>
            )}
            {!active && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setJob(null);
                  void loadFolders();
                }}
              >
                Run another import
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
