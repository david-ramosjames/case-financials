-- Break out import skip reasons on medical_import_jobs.
-- Run in the CLIENT Supabase project after 007 / 010.

begin;

alter table public.medical_import_jobs
  add column if not exists already_imported_files integer not null default 0,
  add column if not exists no_data_files integer not null default 0;

comment on column public.medical_import_jobs.already_imported_files is
  'Files skipped because matching records already existed (dedup).';
comment on column public.medical_import_jobs.no_data_files is
  'Files skipped because no extractable / billable data was found (not an error).';

commit;
