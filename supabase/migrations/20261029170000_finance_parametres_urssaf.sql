create table if not exists public.finance_parametres (cle text primary key, valeur numeric(7,4), updated_by uuid, updated_at timestamptz not null default now());
alter table public.finance_parametres enable row level security;
