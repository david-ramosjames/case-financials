# Case Financials — Phase 1: Medical Expenses

This workspace tracks the **Case Financials** module. Implementation spans two sibling repositories:

| Component | Repository | Path |
|-----------|------------|------|
| AI extraction pipeline | [file-sorter](c:\Users\david\file-sorter) | `src/services/medicalRecordsCaptureService.ts` |
| Database migrations | file-sorter | `client-supabase/001`–`004` |
| Medical Expenses UI | [docket-calendar](c:\Users\david\docket-calendar) | `src/app/cases/[caseId]/financials/medical-expenses` |

## Architecture

```
Upload → Classify → File to Dropbox → AI Medical Extraction → case_medical_records
                                                              ↓
                                    Case → Financials → Medical Expenses (DocketFlow UI)
```

- **Source of truth:** `case_medical_records` table (aliased as `medical_expenses` view)
- **Source documents:** Dropbox files linked via `dropbox_permalink`
- **Review workflow:** All extractions default to `needs_review`; staff edit and mark `reviewed`

## Deploy checklist

1. Run migrations `001`–`004` in the **client Supabase** project
2. Set `CLIENT_SUPABASE_URL`, `CLIENT_SUPABASE_SERVICE_ROLE_KEY`, `MEDICAL_RECORDS_CAPTURE_ENABLED=true` in file-sorter
3. Deploy file-sorter and docket-calendar

## Future phases

Route namespace `/cases/[caseId]/financials/*` is reserved for Case Expenses, Liens, Subrogation, Settlement Calculator, Disbursement Builder, and Trust Accounting.
