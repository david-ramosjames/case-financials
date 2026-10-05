-- Manual provider merges: remember that a provider spelling belongs to another provider on a case,
-- so records imported later under that spelling group with the merged provider.
-- Run in the CLIENT Supabase project after 015. Safe to re-run.

begin;

create table if not exists public.case_medical_provider_aliases (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  alias_key text not null,
  alias_name text not null,
  canonical_name text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint case_medical_provider_aliases_case_alias_unique unique (case_id, alias_key)
);

comment on table public.case_medical_provider_aliases is
  'Per-case provider name aliases created by merging providers (alias_key = normalized spelling).';

alter table public.case_medical_provider_aliases enable row level security;

drop policy if exists "provider aliases readable by authenticated users" on public.case_medical_provider_aliases;
create policy "provider aliases readable by authenticated users"
on public.case_medical_provider_aliases for select to authenticated using (true);

drop policy if exists "provider aliases editable by authenticated users" on public.case_medical_provider_aliases;
create policy "provider aliases editable by authenticated users"
on public.case_medical_provider_aliases for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.case_medical_provider_aliases to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'case_medical_provider_aliases'
     ) then
    alter publication supabase_realtime add table public.case_medical_provider_aliases;
  end if;
end $$;

commit;
