-- Lot 7 — Agent IA : gouvernance, permissions, mémoire/contexte, décisions & exécution
--
-- Mise sous versionnement GitHub du socle de gouvernance de l'Agent IA. Ces
-- objets EXISTENT DÉJÀ en base (créés précédemment hors migration) ; cette
-- migration les capture de façon ADDITIVE et IDEMPOTENTE (CREATE ... IF NOT
-- EXISTS, policies gardées, seed ON CONFLICT DO NOTHING). Elle est donc un
-- no-op sur la base de production et reproduit fidèlement le schéma sur un
-- environnement neuf.
--
-- Référentiel des règles métier : Notion. Donnée opérationnelle : CRM.
-- L'Agent exécute dans le périmètre autorisé par agent_permissions, journalise
-- chaque action (agent_actions) rattachée à une session (agent_runs), et
-- escalade à Erwan tout cas non couvert (agent_escalations).

-- 1. Sessions / contexte d'exécution de l'Agent (couche mémoire opérationnelle).
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  trigger_type text not null,
  trigger_ref text,
  status text not null default 'running'
    check (status in ('running','completed','blocked','failed','cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rule_ref text,
  rule_version text,
  context jsonb not null default '{}'::jsonb,
  summary text,
  error text
);

-- 2. Journal des actions/décisions significatives (acteur, règle, objet, résultat).
--    idempotency_key unique (partiel) : une relance/webhook répété ne crée pas
--    de doublon métier.
--    NB production : la colonne status porte un DEFAULT 'completed' hérité, hors
--    de la contrainte CHECK ; l'applicatif fixe toujours un status explicite de
--    l'ensemble autorisé, donc ce défaut n'est jamais utilisé. La migration
--    retient un défaut cohérent ('executed') pour un environnement neuf.
create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.agent_runs(id) on delete set null,
  action_type text not null,
  target_type text,
  target_id text,
  idempotency_key text,
  status text not null default 'executed'
    check (status in ('proposed','executed','skipped','blocked','failed')),
  rule_ref text,
  rule_version text,
  input_summary text,
  output_summary text,
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists agent_actions_idempotency_uidx
  on public.agent_actions (idempotency_key)
  where idempotency_key is not null;

-- 3. Permissions par ACTION (capacité) et non par accès général au CRM.
--    niveau : autonome | validation_humaine | execution_humaine | escalade.
--    Le niveau par action est une donnée de gouvernance remplie par le cabinet
--    (admin). Toute action absente/inactive est traitée comme « escalade » par
--    l'applicatif (défaut conservateur : cas non couvert → demande à Erwan).
create table if not exists public.agent_permissions (
  action_type text primary key,
  niveau text not null
    check (niveau in ('autonome','validation_humaine','execution_humaine','escalade')),
  actif boolean not null default true,
  justification text,
  updated_at timestamptz not null default now()
);

-- 4. Escalades vers Erwan pour tout cas ambigu / non couvert / sensible.
create table if not exists public.agent_escalations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.agent_runs(id) on delete set null,
  dossier_id uuid references public.dossiers(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  task_id uuid references public.taches(id) on delete set null,
  motif text not null,
  contexte text,
  information_manquante text,
  decision_attendue text,
  statut text not null default 'a_traiter'
    check (statut in ('a_traiter','en_cours','resolue','annulee')),
  demande_le timestamptz not null default now(),
  resolue_le timestamptz,
  resolution text
);

-- RLS : lecture réservée au staff (admin/mandataire). agent_permissions en
-- écriture admin seulement ; agent_escalations gérable par le staff.
alter table public.agent_runs enable row level security;
alter table public.agent_actions enable row level security;
alter table public.agent_permissions enable row level security;
alter table public.agent_escalations enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='agent_runs' and policyname='agent_runs_staff_read') then
    create policy agent_runs_staff_read on public.agent_runs for select to authenticated
      using (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'mandataire'::app_role));
  end if;

  if not exists (select 1 from pg_policies where tablename='agent_actions' and policyname='agent_actions_staff_read') then
    create policy agent_actions_staff_read on public.agent_actions for select to authenticated
      using (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'mandataire'::app_role));
  end if;

  if not exists (select 1 from pg_policies where tablename='agent_permissions' and policyname='agent_permissions_staff_read') then
    create policy agent_permissions_staff_read on public.agent_permissions for select to authenticated
      using (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'mandataire'::app_role));
  end if;

  if not exists (select 1 from pg_policies where tablename='agent_permissions' and policyname='agent_permissions_admin_write') then
    create policy agent_permissions_admin_write on public.agent_permissions for all to authenticated
      using (has_role(auth.uid(),'admin'::app_role))
      with check (has_role(auth.uid(),'admin'::app_role));
  end if;

  if not exists (select 1 from pg_policies where tablename='agent_escalations' and policyname='agent_escalations_staff_all') then
    create policy agent_escalations_staff_all on public.agent_escalations for all to authenticated
      using (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'mandataire'::app_role))
      with check (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'mandataire'::app_role));
  end if;
end $$;

-- Écritures applicatives : service_role (serveur) uniquement, hors RLS.
-- (Aucune policy d'INSERT côté client : l'Agent écrit via supabaseAdmin.)

-- Seed des permissions validées par le cabinet (niveaux de gouvernance).
-- Idempotent : ne réécrit jamais une ligne existante modifiée par l'admin.
insert into public.agent_permissions (action_type, niveau, justification) values
  ('statistiques',             'autonome',           'Calcul non décisionnel'),
  ('relance_prevue',           'autonome',           'Séquences déjà validées'),
  ('creation_tache',           'autonome',           'Orchestration opérationnelle'),
  ('classement_documentaire',  'autonome',           'Règles documentaires validées'),
  ('preparation_fic',          'validation_humaine', 'Validation finale obligatoire'),
  ('recommandation_assurance', 'validation_humaine', 'Décision de conseil'),
  ('conformite_sensible',      'validation_humaine', 'Décision réglementaire sensible'),
  ('nouvelle_regle_metier',    'escalade',           'Toute règle nouvelle doit être validée')
on conflict (action_type) do nothing;
