-- Patient on each medical document, so a case with more than one client
-- (for example Crystal Ramos and Juan Rojas) can be totaled separately.
-- Run in the CLIENT Supabase project after 018. Safe to re-run.

begin;

alter table public.case_medical_records
  add column if not exists patient_name text;

comment on column public.case_medical_records.patient_name is
  'Patient named on this document. Null until extracted or entered. Cases group balances by this name.';

commit;
