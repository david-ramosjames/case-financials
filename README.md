# Case Financials

Standalone financial module for Ramos James Law. Shares the **client Supabase** database with DocketFlow and Case Tracker, but runs as its own app.

## Architecture

```
file-sorter (document pipeline)  →  case_medical_records (Supabase)
                                           ↓
case-financials (this app)       →  Medical Expenses UI + future modules
```

| Layer | Location |
|-------|----------|
| **UI** | This repo (`case-financials`) — port 3001 by default |
| **AI extraction** | `file-sorter` — post-approve medical capture hook |
| **Database** | `migrations/` — run in client Supabase (001–004) |

## Local development

```bash
cp .env.example .env.local
# Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (same as DocketFlow)

npm install
npm run dev
```

Open http://localhost:3001

Add `http://localhost:3001/auth/callback` to Supabase → Authentication → Redirect URLs.

## Routes

- `/` — case list → Medical Expenses
- `/cases/[caseId]/financials/medical-expenses` — review workflow UI

Future: `/cases/[caseId]/financials/*` for Case Expenses, Liens, Subrogation, etc.

## Deploy checklist

1. Run `migrations/001` through `004` in client Supabase
2. Deploy **file-sorter** with `MEDICAL_RECORDS_CAPTURE_ENABLED=true`
3. Deploy **case-financials** with Supabase env vars + production `NEXT_PUBLIC_SITE_URL`
4. Add production `/auth/callback` to Supabase redirect URLs

## Related repos

- **DocketFlow** (`docket-calendar`) — calendar/deadlines only; no financial UI
- **file-sorter** — document ingestion and AI extraction pipeline
