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

## Deploy on Vercel

1. Import the GitHub repo and set **Framework Preset** to **Next.js** (not “Other”).
2. Leave **Output Directory** empty — do not set it to `public`. Next.js builds to `.next`; Vercel handles that automatically.
3. Set environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` (your production URL, e.g. `https://financials.yourfirm.com`)
4. Add `https://<your-domain>/auth/callback` to Supabase → Authentication → Redirect URLs.

If the build succeeds but deploy fails with *“No Output Directory named public found”*, the project is misconfigured as a static site — clear the Output Directory override in Vercel → Project Settings → Build & Development Settings.

## Deploy checklist

1. Run `migrations/001` through `004` in **client Supabase** (SQL editor)
   - If capture logs *Could not find the dropbox_permalink column*, run `004b_dropbox_permalink_column.sql` (or full `004`)
2. Deploy **file-sorter** with `MEDICAL_RECORDS_CAPTURE_ENABLED=true`
3. Deploy **case-financials** with Supabase env vars + production `NEXT_PUBLIC_SITE_URL`
4. Add production `/auth/callback` to Supabase redirect URLs

## Related repos

- **DocketFlow** (`docket-calendar`) — calendar/deadlines only; no financial UI
- **file-sorter** — document ingestion and AI extraction pipeline
