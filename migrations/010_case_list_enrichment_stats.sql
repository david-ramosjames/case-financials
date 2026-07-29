-- Server-side aggregates for the cases list (avoids full-table PostgREST scans).
-- Run in the CLIENT Supabase project.

begin;

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

comment on function public.case_list_enrichment_stats() is
  'Per active case: medical charge total, expense total, LOP count, last Dropbox import time.';

grant execute on function public.case_list_enrichment_stats() to authenticated;
grant execute on function public.case_list_enrichment_stats() to service_role;

commit;
