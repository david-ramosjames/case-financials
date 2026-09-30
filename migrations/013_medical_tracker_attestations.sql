-- Financial data versioning + reviewer attestations for certified PDF generation.
-- Run in the CLIENT Supabase project after 012. Safe to re-run.
--
-- Every change to a case's medical records / tracker rows bumps its Medical Tracker
-- version; every change to its case expenses bumps its Case Expenses version.
-- An attestation certifies one scope (medical, expenses, or all) at exact versions,
-- plus a snapshot of the data, so any later edit in that scope makes it stale.

begin;

create table if not exists public.case_medical_tracker_versions (
  case_id uuid primary key references public.cases(id) on delete cascade,
  version bigint not null default 1,
  expenses_version bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.case_medical_tracker_versions
  add column if not exists expenses_version bigint not null default 1;

comment on table public.case_medical_tracker_versions is
  'Monotonic data versions per case: version = Medical Tracker, expenses_version = Case Expenses. Missing row = 1.';

alter table public.case_medical_tracker_versions enable row level security;

drop policy if exists "tracker versions readable by authenticated users" on public.case_medical_tracker_versions;
create policy "tracker versions readable by authenticated users"
on public.case_medical_tracker_versions for select to authenticated using (true);

grant select on public.case_medical_tracker_versions to authenticated;

create or replace function public.bump_case_medical_tracker_version(p_case_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.case_medical_tracker_versions (case_id, version, updated_at)
  select p_case_id, 2, now()
  where exists (select 1 from public.cases c where c.id = p_case_id)
  on conflict (case_id) do update
    set version = public.case_medical_tracker_versions.version + 1,
        updated_at = now();
$$;

create or replace function public.bump_case_expenses_version(p_case_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.case_medical_tracker_versions (case_id, expenses_version, updated_at)
  select p_case_id, 2, now()
  where exists (select 1 from public.cases c where c.id = p_case_id)
  on conflict (case_id) do update
    set expenses_version = public.case_medical_tracker_versions.expenses_version + 1,
        updated_at = now();
$$;

revoke all on function public.bump_case_medical_tracker_version(uuid) from public;
revoke all on function public.bump_case_expenses_version(uuid) from public;

-- Resolve a record to its case the same way the app does (case_id, else case_number).
create or replace function public.resolve_financial_record_case_id(p_case_id uuid, p_case_number text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.id from public.cases c where c.id = p_case_id),
    (select c.id from public.cases c
      where p_case_number is not null and c.case_number = btrim(p_case_number)
      order by c.status = 'active' desc
      limit 1)
  );
$$;

create or replace function public.trg_bump_tracker_version_from_records()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old := public.resolve_financial_record_case_id(old.case_id, old.case_number);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := public.resolve_financial_record_case_id(new.case_id, new.case_number);
  end if;

  if v_new is not null then
    perform public.bump_case_medical_tracker_version(v_new);
  end if;
  if v_old is not null and v_old is distinct from v_new then
    perform public.bump_case_medical_tracker_version(v_old);
  end if;
  return null;
end;
$$;

create or replace function public.trg_bump_tracker_version_from_tracker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform public.bump_case_medical_tracker_version(new.case_id);
  elsif tg_op = 'DELETE' then
    perform public.bump_case_medical_tracker_version(old.case_id);
  else
    perform public.bump_case_medical_tracker_version(new.case_id);
    if old.case_id is distinct from new.case_id then
      perform public.bump_case_medical_tracker_version(old.case_id);
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.trg_bump_expenses_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old := public.resolve_financial_record_case_id(old.case_id, old.case_number);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := public.resolve_financial_record_case_id(new.case_id, new.case_number);
  end if;

  if v_new is not null then
    perform public.bump_case_expenses_version(v_new);
  end if;
  if v_old is not null and v_old is distinct from v_new then
    perform public.bump_case_expenses_version(v_old);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_case_medical_records_tracker_version on public.case_medical_records;
create trigger trg_case_medical_records_tracker_version
after insert or update or delete on public.case_medical_records
for each row execute function public.trg_bump_tracker_version_from_records();

drop trigger if exists trg_case_medical_tracker_tracker_version on public.case_medical_tracker;
create trigger trg_case_medical_tracker_tracker_version
after insert or update or delete on public.case_medical_tracker
for each row execute function public.trg_bump_tracker_version_from_tracker();

drop trigger if exists trg_case_expenses_version on public.case_expenses;
create trigger trg_case_expenses_version
after insert or update or delete on public.case_expenses
for each row execute function public.trg_bump_expenses_version();

drop function if exists public.resolve_medical_record_case_id(uuid, text);

-- Immutable attestation log. Rows are only written through create_medical_tracker_attestation.
create table if not exists public.medical_tracker_attestations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  case_number text,
  scope text not null default 'medical',
  reviewer_user_id uuid not null,
  reviewer_name text not null,
  reviewer_email text,
  attested_at timestamptz not null default now(),
  tracker_version bigint not null,
  expenses_version bigint not null default 1,
  pdf_version integer not null,
  statement_set_version text not null,
  statements jsonb not null,
  snapshot jsonb not null,
  snapshot_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.medical_tracker_attestations
  add column if not exists scope text not null default 'medical',
  add column if not exists expenses_version bigint not null default 1;

-- PDF versions are now numbered per scope; drop the earlier per-case unique constraint.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.medical_tracker_attestations'::regclass
      and contype = 'u'
      and conname <> 'medical_tracker_attestations_case_scope_pdf_unique'
  loop
    execute format('alter table public.medical_tracker_attestations drop constraint %I', v_name);
  end loop;
end $$;

alter table public.medical_tracker_attestations
  drop constraint if exists medical_tracker_attestations_scope_check,
  drop constraint if exists medical_tracker_attestations_case_pdf_unique,
  drop constraint if exists medical_tracker_attestations_case_scope_pdf_unique;

alter table public.medical_tracker_attestations
  add constraint medical_tracker_attestations_scope_check
    check (scope in ('medical', 'expenses', 'all')),
  add constraint medical_tracker_attestations_case_scope_pdf_unique
    unique (case_id, scope, pdf_version);

create index if not exists idx_medical_tracker_attestations_case_attested
  on public.medical_tracker_attestations(case_id, attested_at desc);

comment on table public.medical_tracker_attestations is
  'Reviewer certifications of exact Medical Tracker / Case Expenses versions, with the certified data snapshot.';
comment on column public.medical_tracker_attestations.scope is
  'What was certified: medical (Medical Tracker), expenses (Case Expenses), or all.';

alter table public.medical_tracker_attestations enable row level security;

drop policy if exists "attestations readable by authenticated users" on public.medical_tracker_attestations;
create policy "attestations readable by authenticated users"
on public.medical_tracker_attestations for select to authenticated using (true);

grant select on public.medical_tracker_attestations to authenticated;

drop function if exists public.create_medical_tracker_attestation(uuid, bigint, text, jsonb, jsonb, text, text);

create or replace function public.create_medical_tracker_attestation(
  p_case_id uuid,
  p_scope text,
  p_tracker_version bigint,
  p_expenses_version bigint,
  p_statement_set_version text,
  p_statements jsonb,
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_reviewer_name text
)
returns public.medical_tracker_attestations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_medical bigint;
  v_expenses bigint;
  v_pdf integer;
  v_case_number text;
  v_row public.medical_tracker_attestations;
begin
  if v_user is null then
    raise exception 'Sign in to certify case financials';
  end if;
  if v_email not like '%@ramosjames.com' then
    raise exception 'Firm account required to certify case financials';
  end if;
  if p_scope not in ('medical', 'expenses', 'all') then
    raise exception 'Unknown certification scope';
  end if;
  if coalesce(btrim(p_reviewer_name), '') = '' then
    raise exception 'Reviewer name is required';
  end if;
  if jsonb_typeof(p_statements) <> 'array' or jsonb_array_length(p_statements) < 5 then
    raise exception 'All required attestations must be provided';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_statements) s
    where coalesce((s ->> 'checked')::boolean, false) is not true
  ) then
    raise exception 'All required attestations must be checked';
  end if;

  select c.case_number into v_case_number from public.cases c where c.id = p_case_id;
  if not found then
    raise exception 'Case not found';
  end if;

  insert into public.case_medical_tracker_versions (case_id)
  values (p_case_id)
  on conflict (case_id) do nothing;

  select version, expenses_version into v_medical, v_expenses
  from public.case_medical_tracker_versions
  where case_id = p_case_id
  for update;

  if p_scope in ('medical', 'all') and v_medical <> p_tracker_version then
    raise exception 'The Medical Tracker changed while you were reviewing (now version %). Review the latest data and certify again.', v_medical;
  end if;
  if p_scope in ('expenses', 'all') and v_expenses <> p_expenses_version then
    raise exception 'Case Expenses changed while you were reviewing (now version %). Review the latest data and certify again.', v_expenses;
  end if;

  select coalesce(max(pdf_version), 0) + 1 into v_pdf
  from public.medical_tracker_attestations
  where case_id = p_case_id and scope = p_scope;

  insert into public.medical_tracker_attestations (
    case_id, case_number, scope, reviewer_user_id, reviewer_name, reviewer_email,
    tracker_version, expenses_version, pdf_version, statement_set_version,
    statements, snapshot, snapshot_hash
  ) values (
    p_case_id, v_case_number, p_scope, v_user, btrim(p_reviewer_name), v_email,
    v_medical, v_expenses, v_pdf, p_statement_set_version,
    p_statements, p_snapshot, p_snapshot_hash
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_medical_tracker_attestation(uuid, text, bigint, bigint, text, jsonb, jsonb, text, text) from public;
grant execute on function public.create_medical_tracker_attestation(uuid, text, bigint, bigint, text, jsonb, jsonb, text, text) to authenticated;

commit;
