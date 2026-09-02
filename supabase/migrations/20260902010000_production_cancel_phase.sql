-- Cancelled productions get their own UI phase.

alter table public.productions
  drop constraint if exists productions_phase_chk;

alter table public.productions
  add constraint productions_phase_chk check (ui_phase in (
    'preparing', 'producing', 'finishing', 'ready', 'needs_you', 'cancelled'
  ));
