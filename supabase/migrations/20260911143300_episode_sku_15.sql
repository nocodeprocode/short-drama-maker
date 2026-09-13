alter table public.productions
  drop constraint if exists productions_sku_chk;

alter table public.productions
  add constraint productions_sku_chk
    check (sku in ('2', '12', '15', '24', '30', '45', '50', '60', '90', 'topup', 'credit'));
