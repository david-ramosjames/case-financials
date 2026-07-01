-- Quick fix if medical capture fails with "Could not find dropbox_permalink column".
-- Run in the CLIENT Supabase SQL editor. Safe to run multiple times.

alter table public.case_medical_records
  add column if not exists dropbox_permalink text;

comment on column public.case_medical_records.dropbox_permalink is
  'Team-only Dropbox shared link to the source document.';
