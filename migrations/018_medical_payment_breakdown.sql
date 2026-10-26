-- Amounts a reviewer can enter on a medical bill or balance:
-- adjustments, health insurance paid, and other insurance paid toward the provider.
-- Run in the CLIENT Supabase project after 017. Safe to re-run.

begin;

alter table public.case_medical_records
  add column if not exists adjustment_amount numeric,
  add column if not exists health_insurance_paid numeric,
  add column if not exists insurance_paid numeric;

comment on column public.case_medical_records.adjustment_amount is
  'Adjustment or write-off on this provider bill. Null means the app derives it.';
comment on column public.case_medical_records.health_insurance_paid is
  'Amount health insurance paid on this provider bill.';
comment on column public.case_medical_records.insurance_paid is
  'Other insurance paid toward this provider bill (PIP, MedPay, liability).';

commit;
