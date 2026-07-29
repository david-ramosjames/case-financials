-- Track Dropbox scan inventory on medical import jobs.
-- Run in the CLIENT Supabase project after 011.

begin;

alter table public.medical_import_jobs
  add column if not exists scanned_files integer not null default 0,
  add column if not exists excluded_files integer not null default 0,
  add column if not exists excluded_file_list jsonb not null default '[]'::jsonb;

comment on column public.medical_import_jobs.scanned_files is
  'All files found under LOP, Medical, and Expenses (any file type).';
comment on column public.medical_import_jobs.excluded_files is
  'Scanned files not processed (unsupported type). scanned = total_files + excluded_files.';
comment on column public.medical_import_jobs.excluded_file_list is
  'Excluded files with Dropbox links from the latest import run.';

commit;
