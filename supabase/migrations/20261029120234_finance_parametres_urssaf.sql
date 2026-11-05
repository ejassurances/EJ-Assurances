create table if not exists public.finance_parametres (
  cle text primary key,
  valeur numeric(7,4),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint finance_parametres_cle_autorisee check (cle in ('taux_urssaf')),
  constraint finance_parametres_taux_urssaf_valide check (cle <> 'taux_urssaf' or valeur is null or (valeur >= 0 and valeur <= 100))
);

alter table public.finance_parametres enable row level security;

drop policy if exists finance_parametres_admin_select on public.finance_parametres;
create policy finance_parametres_admin_select
  on public.finance_parametres for select to authenticated
  using (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role::text = 'admin'
  ));

drop policy if exists finance_parametres_admin_insert on public.finance_parametres;
create policy finance_parametres_admin_insert
  on public.finance_parametres for insert to authenticated
  with check (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role::text = 'admin'
  ));

drop policy if exists finance_parametres_admin_update on public.finance_parametres;
create policy finance_parametres_admin_update
  on public.finance_parametres for update to authenticated
  using (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role::text = 'admin'
  ))
  with check (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role::text = 'admin'
  ));

grant select, insert, update on public.finance_parametres to authenticated;
