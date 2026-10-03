-- Lot G (Phase 4) — Acquisition / Webinaires : socle funnel + remontée Brevo.
--   Source métier : Notion « CRM Assurance » (architecture webinaires) + Lot 4.
--   Additif : ne touche ni `webinaires` ni `webinaire_sessions` (déjà en base).
--   Ajoute le suivi par participant (funnel) et l'ingestion d'événements Brevo.
--   RLS staff-only (admin/mandataire), aligné sur le reste du schéma.

-- ───────────────────────────────────────────────────────────────────
-- 1. Funnel par participant : une ligne par (session, contact).
--    Étapes de référence (spec Notion) : inscription → présence → clic →
--    formulaire_debut → formulaire_fin → etude → fic → signature → contrat → ca.
--    Chaque étape porte son horodatage (null tant que non atteinte) pour calculer
--    les taux de conversion par webinaire/session/source/audience/campagne.
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.webinaire_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.webinaire_sessions(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  dossier_id uuid references public.dossiers(id) on delete set null,
  email text not null,
  nom text,
  telephone text,
  source text,
  audience text,
  campagne_id text,
  etape_courante text not null default 'inscription'
    check (etape_courante in (
      'inscription','presence','clic','formulaire_debut','formulaire_fin',
      'etude','fic','signature','contrat','ca'
    )),
  inscription_at timestamptz default now(),
  presence_at timestamptz,
  clic_at timestamptz,
  formulaire_debut_at timestamptz,
  formulaire_fin_at timestamptz,
  etude_at timestamptz,
  fic_at timestamptz,
  signature_at timestamptz,
  contrat_at timestamptz,
  ca_at timestamptz,
  ca_montant numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, email)
);
create index if not exists webinaire_participants_session_idx on public.webinaire_participants(session_id);
create index if not exists webinaire_participants_etape_idx on public.webinaire_participants(etape_courante);
create index if not exists webinaire_participants_dossier_idx on public.webinaire_participants(dossier_id);
revoke all on public.webinaire_participants from anon;
grant select, insert, update, delete on public.webinaire_participants to authenticated;
grant all on public.webinaire_participants to service_role;
alter table public.webinaire_participants enable row level security;
drop policy if exists "webinaire_participants_staff_all" on public.webinaire_participants;
create policy "webinaire_participants_staff_all" on public.webinaire_participants
  for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'mandataire'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'mandataire'::app_role));

-- ───────────────────────────────────────────────────────────────────
-- 2. Remontée des événements Brevo (ouvertures, clics, désinscriptions…).
--    Brevo reste le moteur d'envoi ; le CRM n'ingère que les événements utiles
--    pour l'analyse. Idempotent via event_uid (identifiant Brevo de l'événement).
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.brevo_evenements (
  id uuid primary key default gen_random_uuid(),
  event_uid text unique,
  type text not null,
  email text,
  campagne text,
  message_id text,
  participant_id uuid references public.webinaire_participants(id) on delete set null,
  payload jsonb,
  received_at timestamptz not null default now()
);
create index if not exists brevo_evenements_email_idx on public.brevo_evenements(email);
create index if not exists brevo_evenements_type_idx on public.brevo_evenements(type);
revoke all on public.brevo_evenements from anon;
grant select, insert, update, delete on public.brevo_evenements to authenticated;
grant all on public.brevo_evenements to service_role;
alter table public.brevo_evenements enable row level security;
drop policy if exists "brevo_evenements_staff_all" on public.brevo_evenements;
create policy "brevo_evenements_staff_all" on public.brevo_evenements
  for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'mandataire'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'mandataire'::app_role));
