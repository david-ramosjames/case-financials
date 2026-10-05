-- Learned provider merges: a spelling merged into another provider on one case is grouped
-- with that provider on every case. Case-level aliases (016) take precedence.
-- Run in the CLIENT Supabase project after 016. Safe to re-run.

begin;

create table if not exists public.medical_provider_aliases (
  alias_key text primary key,
  alias_name text not null,
  canonical_name text not null,
  source_case_id uuid references public.cases(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);

comment on table public.medical_provider_aliases is
  'Provider name aliases learned from manual merges, applied on all cases (alias_key = normalized spelling).';

alter table public.medical_provider_aliases enable row level security;

drop policy if exists "learned provider aliases readable by authenticated users" on public.medical_provider_aliases;
create policy "learned provider aliases readable by authenticated users"
on public.medical_provider_aliases for select to authenticated using (true);

drop policy if exists "learned provider aliases editable by authenticated users" on public.medical_provider_aliases;
create policy "learned provider aliases editable by authenticated users"
on public.medical_provider_aliases for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.medical_provider_aliases to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'medical_provider_aliases'
     ) then
    alter publication supabase_realtime add table public.medical_provider_aliases;
  end if;
end $$;

-- Seed from merges already made on individual cases.
insert into public.medical_provider_aliases (alias_key, alias_name, canonical_name, source_case_id, created_by, created_at)
select distinct on (a.alias_key) a.alias_key, a.alias_name, a.canonical_name, a.case_id, a.created_by, a.created_at
from public.case_medical_provider_aliases a
order by a.alias_key, a.created_at desc
on conflict (alias_key) do nothing;

commit;
