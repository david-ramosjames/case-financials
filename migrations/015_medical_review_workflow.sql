-- Review workflow: "Not medical expense" exclusions + provider-level total confirmations.
-- Run in the CLIENT Supabase project after 014. Safe to re-run.

begin;

alter table public.case_medical_records
  drop constraint if exists case_medical_records_excluded_reason_check;
alter table public.case_medical_records
  add constraint case_medical_records_excluded_reason_check
    check (excluded_reason is null or excluded_reason in ('duplicate', 'superseded', 'not_medical'));

comment on column public.case_medical_records.excluded_reason is
  'duplicate | superseded | not_medical when a reviewer excluded this record from totals; null = counted.';

-- A paralegal confirmed a provider's canonical totals. The fingerprint captures the provider's
-- records at confirmation; any later change to them sends the provider back to Needs Review.
create table if not exists public.case_medical_provider_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  provider_key text not null,
  provider_name text not null,
  fingerprint text not null,
  reviewed_by_user_id uuid default auth.uid(),
  reviewed_by text,
  reviewed_at timestamptz not null default now(),
  constraint case_medical_provider_reviews_case_provider_unique unique (case_id, provider_key)
);

comment on table public.case_medical_provider_reviews is
  'Provider-level confirmation of canonical medical totals (Needs Review -> Reviewed).';

alter table public.case_medical_provider_reviews enable row level security;

drop policy if exists "provider reviews readable by authenticated users" on public.case_medical_provider_reviews;
create policy "provider reviews readable by authenticated users"
on public.case_medical_provider_reviews for select to authenticated using (true);

drop policy if exists "provider reviews editable by authenticated users" on public.case_medical_provider_reviews;
create policy "provider reviews editable by authenticated users"
on public.case_medical_provider_reviews for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.case_medical_provider_reviews to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'case_medical_provider_reviews'
     ) then
    alter publication supabase_realtime add table public.case_medical_provider_reviews;
  end if;
end $$;

commit;
