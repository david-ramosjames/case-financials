"use client";

import { useCallback, useState, type ReactNode } from "react";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { createCaseExpense, createMedicalExpense } from "@/lib/supabase/repo";
import type { CaseExpenseDocumentType, MedicalExpenseDocumentType } from "@/lib/types";
import { Button, Card, CardBody, CardHeader, Input, Select, Spinner } from "@/components/ui";

const MEDICAL_DOC_LABELS: Record<MedicalExpenseDocumentType, string> = {
  medical_bill: "Medical Bill",
  balance_statement: "Balance Statement",
  reduction_letter: "Reduction Letter",
  payment_invoice: "Payment Invoice",
  lop_statement: "LOP Statement",
  medical_provider_statement: "Provider Statement",
};

const CASE_DOC_LABELS: Record<CaseExpenseDocumentType, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  statement: "Statement",
  check_copy: "Check Copy",
  credit_card: "Credit Card",
  vendor_bill: "Vendor Bill",
  other: "Other",
};

type BaseProps = {
  caseId: string;
  caseNumber: string;
  onClose: () => void;
};

export function ManualMedicalExpenseForm({ caseId, caseNumber, onClose }: BaseProps) {
  const [dropboxLink, setDropboxLink] = useState("");
  const [fileName, setFileName] = useState("");
  const [providerName, setProviderName] = useState("");
  const [documentType, setDocumentType] = useState<MedicalExpenseDocumentType>("medical_bill");
  const [currentBalance, setCurrentBalance] = useState("");
  const [originalCharges, setOriginalCharges] = useState("");
  const [dateOfService, setDateOfService] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      await createMedicalExpense(getBrowserSupabase(), caseId, caseNumber, {
        dropboxPermalink: dropboxLink,
        fileName: fileName || null,
        providerName,
        documentType,
        dateOfService: dateOfService || null,
        currentBalance: currentBalance ? Number(currentBalance) : null,
        originalCharges: originalCharges ? Number(originalCharges) : null,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add file");
    } finally {
      setSaving(false);
    }
  }, [caseId, caseNumber, dropboxLink, fileName, providerName, documentType, dateOfService, currentBalance, originalCharges, onClose]);

  return (
    <ManualFormShell
      title="Add medical file"
      err={err}
      saving={saving}
      canSubmit={Boolean(dropboxLink.trim() && providerName.trim())}
      onCancel={onClose}
      onSubmit={() => void submit()}
      dropboxLink={dropboxLink}
      onDropboxLinkChange={setDropboxLink}
      fileName={fileName}
      onFileNameChange={setFileName}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider" required>
          <Input placeholder="Provider or facility name" value={providerName} onChange={(e) => setProviderName(e.target.value)} />
        </Field>
        <Field label="Document type">
          <Select value={documentType} onChange={(e) => setDocumentType(e.target.value as MedicalExpenseDocumentType)}>
            {(Object.keys(MEDICAL_DOC_LABELS) as MedicalExpenseDocumentType[]).map((t) => (
              <option key={t} value={t}>{MEDICAL_DOC_LABELS[t]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date of service">
          <Input type="date" value={dateOfService} onChange={(e) => setDateOfService(e.target.value)} />
        </Field>
        <Field label="Original charges">
          <Input type="number" step="0.01" placeholder="0.00" value={originalCharges} onChange={(e) => setOriginalCharges(e.target.value)} />
        </Field>
        <Field label="Balance due">
          <Input type="number" step="0.01" placeholder="0.00" value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} />
        </Field>
      </div>
    </ManualFormShell>
  );
}

export function ManualCaseExpenseForm({ caseId, caseNumber, onClose }: BaseProps) {
  const [dropboxLink, setDropboxLink] = useState("");
  const [fileName, setFileName] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [documentType, setDocumentType] = useState<CaseExpenseDocumentType | "">("");
  const [description, setDescription] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      await createCaseExpense(getBrowserSupabase(), caseId, caseNumber, {
        dropboxPermalink: dropboxLink,
        fileName: fileName || null,
        vendorName,
        documentType: documentType || null,
        description: description || null,
        invoiceNumber: invoiceNumber || null,
        amount: amount ? Number(amount) : null,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add file");
    } finally {
      setSaving(false);
    }
  }, [caseId, caseNumber, dropboxLink, fileName, vendorName, documentType, description, invoiceNumber, amount, onClose]);

  return (
    <ManualFormShell
      title="Add case expense file"
      err={err}
      saving={saving}
      canSubmit={Boolean(dropboxLink.trim() && vendorName.trim())}
      onCancel={onClose}
      onSubmit={() => void submit()}
      dropboxLink={dropboxLink}
      onDropboxLinkChange={setDropboxLink}
      fileName={fileName}
      onFileNameChange={setFileName}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendor" required>
          <Input placeholder="Vendor or payee" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
        </Field>
        <Field label="Document type">
          <Select value={documentType} onChange={(e) => setDocumentType(e.target.value as CaseExpenseDocumentType | "")}>
            <option value="">—</option>
            {(Object.keys(CASE_DOC_LABELS) as CaseExpenseDocumentType[]).map((t) => (
              <option key={t} value={t}>{CASE_DOC_LABELS[t]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice #">
          <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input type="number" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Input placeholder="Brief description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </ManualFormShell>
  );
}

function ManualFormShell({
  title,
  err,
  saving,
  canSubmit,
  onCancel,
  onSubmit,
  dropboxLink,
  onDropboxLinkChange,
  fileName,
  onFileNameChange,
  children,
}: {
  title: string;
  err: string | null;
  saving: boolean;
  canSubmit: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  dropboxLink: string;
  onDropboxLinkChange: (v: string) => void;
  fileName: string;
  onFileNameChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <Card className="mt-4 border-primary/20">
      <CardHeader>
        <p className="font-medium text-text">{title}</p>
        <p className="mt-1 text-xs text-text-muted">
          Paste a Dropbox shared link (Copy link in Dropbox). Permalinks keep working if the file is moved or renamed.
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dropbox shared link" required className="sm:col-span-2">
            <Input
              placeholder="https://www.dropbox.com/scl/fi/…"
              value={dropboxLink}
              onChange={(e) => onDropboxLinkChange(e.target.value)}
            />
          </Field>
          <Field label="File name" className="sm:col-span-2">
            <Input placeholder="Optional label for the source column" value={fileName} onChange={(e) => onFileNameChange(e.target.value)} />
          </Field>
        </div>
        {children}
        <div className="flex gap-2 pt-2">
          <Button disabled={saving || !canSubmit} onClick={onSubmit}>
            {saving ? <Spinner className="h-4 w-4" /> : "Add file"}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Field({
  label,
  required,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-text-muted">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
    </div>
  );
}
