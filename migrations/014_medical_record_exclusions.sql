-- Exclude medical records as duplicate / superseded instead of deleting them.
-- Run in the CLIENT Supabase project after 013. Safe to re-run.
--
-- Excluded records stay in the table (so Dropbox re-imports recognize the file and skip it)
-- but no longer count toward totals or appear in attorney-facing views and PDFs.

begin;

alter table public.case_medical_records
  add column if not exists excluded_reason text,
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_by text,
  add column if not exists excluded_note text,
  add column if not exists superseded_by_id uuid references public.case_medical_records(id) on delete set null,
  add column if not exists suggestion_dismissed boolean not null default false;

alter table public.case_medical_records
  drop constraint if exists case_medical_records_excluded_reason_check;
alter table public.case_medical_records
  add constraint case_medical_records_excluded_reason_check
    check (excluded_reason is null or excluded_reason in ('duplicate', 'superseded'));

comment on column public.case_medical_records.excluded_reason is
  'duplicate | superseded when a reviewer excluded this record from totals; null = counted.';
comment on column public.case_medical_records.superseded_by_id is
  'The record that replaces this one (newer balance statement or the original of a duplicate).';
comment on column public.case_medical_records.suggestion_dismissed is
  'Reviewer chose to keep counting this record despite an automatic duplicate/superseded suggestion.';

create index if not exists idx_case_medical_records_case_file
  on public.case_medical_records(case_number, dropbox_file_id)
  where dropbox_file_id is not null;

-- Cases list totals ignore excluded records.
create or replace function public.case_list_enrichment_stats()
returns table (
  case_id uuid,
  medical_total numeric,
  expenses_total numeric,
  lop_count bigint,
  last_dropbox_sync_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with active_cases as (
    select c.id, c.case_number
    from public.cases c
    where c.status = 'active'
  ),
  medical as (
    select
      coalesce(m.case_id, ac.id) as case_id,
      coalesce(
        sum(
          case
            when coalesce(m.original_charges, m.reduced_from_amount, 0) > 0
              then coalesce(m.original_charges, m.reduced_from_amount)
            else 0
          end
        ),
        0
      ) as total
    from public.case_medical_records m
    inner join active_cases ac
      on ac.id = m.case_id
      or (m.case_id is null and ac.case_number is not null and ac.case_number = m.case_number)
    where m.excluded_reason is null
    group by 1
  ),
  expenses as (
    select
      coalesce(e.case_id, ac.id) as case_id,
      coalesce(
        sum(
          case
            when coalesce(e.amount, 0) > 0 then e.amount
            else 0
          end
        ),
        0
      ) as total
    from public.case_expenses e
    inner join active_cases ac
      on ac.id = e.case_id
      or (e.case_id is null and ac.case_number is not null and ac.case_number = e.case_number)
    group by 1
  ),
  lops as (
    select t.case_id, count(*)::bigint as cnt
    from public.case_medical_tracker t
    inner join active_cases ac on ac.id = t.case_id
    where t.has_lop is true
    group by t.case_id
  ),
  last_sync as (
    select distinct on (j.case_id)
      j.case_id,
      coalesce(j.completed_at, j.started_at, j.created_at) as synced_at
    from public.medical_import_jobs j
    inner join active_cases ac on ac.id = j.case_id
    order by j.case_id, j.created_at desc
  )
  select
    ac.id as case_id,
    coalesce(m.total, 0) as medical_total,
    coalesce(e.total, 0) as expenses_total,
    coalesce(l.cnt, 0) as lop_count,
    s.synced_at as last_dropbox_sync_at
  from active_cases ac
  left join medical m on m.case_id = ac.id
  left join expenses e on e.case_id = ac.id
  left join lops l on l.case_id = ac.id
  left join last_sync s on s.case_id = ac.id;
$$;

commit;
