-- Multiple Dropbox LOP files per medical tracker provider.
-- Run in the CLIENT Supabase project after migration 007.

begin;

alter table public.case_medical_tracker
  add column if not exists lop_files jsonb not null default '[]'::jsonb;

alter table public.case_medical_tracker
  drop constraint if exists case_medical_tracker_lop_files_array_check;

alter table public.case_medical_tracker
  add constraint case_medical_tracker_lop_files_array_check
  check (jsonb_typeof(lop_files) = 'array');

comment on column public.case_medical_tracker.lop_files is
  'Dropbox LOP documents for this provider: [{name, url, path, fileId}].';

commit;
