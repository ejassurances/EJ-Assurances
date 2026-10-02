-- Lot G — Acquisition / Webinars / Referral foundation.

CREATE TABLE IF NOT EXISTS public.webinaires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  titre text NOT NULL,
  description text,
  actif boolean NOT NULL DEFAULT true,
  formulaire_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  emails_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  parametres_commerciaux jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webinaires_type_check CHECK (type IN ('assurance_emprunteur','coparentalite','assurance_vie','sante_prevoyance_tns_entreprises'))
);
ALTER TABLE public.webinaires ENABLE ROW LEVEL SECURITY;
CREATE POLICY webinaires_staff_read ON public.webinaires FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY webinaires_admin_write ON public.webinaires FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.webinaire_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinaire_id uuid NOT NULL REFERENCES public.webinaires(id) ON DELETE CASCADE,
  occurrence_at timestamptz,
  statut text NOT NULL DEFAULT 'brouillon',
  video_url text,
  replay_url text,
  titre_public text,
  description_public text,
  campagne_id text,
  audience text,
  parametres jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webinaire_sessions_statut_check CHECK (statut IN ('brouillon','programme','termine','replay','archive'))
);
ALTER TABLE public.webinaire_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY webinaire_sessions_staff_read ON public.webinaire_sessions FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY webinaire_sessions_admin_write ON public.webinaire_sessions FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.marketing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text,
  event_type text NOT NULL,
  email text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  webinaire_session_id uuid REFERENCES public.webinaire_sessions(id) ON DELETE SET NULL,
  source text,
  campagne_id text,
  audience text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketing_events_staff_read ON public.marketing_events FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE UNIQUE INDEX IF NOT EXISTS marketing_events_provider_uidx
  ON public.marketing_events(provider,provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.parrainages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parrain_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  filleul_email text NOT NULL,
  code text NOT NULL UNIQUE,
  consentement_parrain boolean NOT NULL DEFAULT false,
  statut text NOT NULL DEFAULT 'invite',
  source text NOT NULL DEFAULT 'parrainage',
  invited_at timestamptz NOT NULL DEFAULT now(),
  clicked_at timestamptz,
  prospect_at timestamptz,
  etude_at timestamptz,
  fic_at timestamptz,
  souscription_at timestamptz,
  actif_at timestamptz,
  recompense_statut text NOT NULL DEFAULT 'non_due',
  recompense_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT parrainages_statut_check CHECK (statut IN ('invite','clique','prospect','etude','fic','souscription','actif','abandonne')),
  CONSTRAINT parrainages_recompense_check CHECK (recompense_statut IN ('non_due','due','payee','bloquee'))
);
ALTER TABLE public.parrainages ENABLE ROW LEVEL SECURITY;
CREATE POLICY parrainages_owner_read ON public.parrainages FOR SELECT TO authenticated
  USING (parrain_client_id IN (SELECT id FROM public.clients WHERE user_id=auth.uid()) OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY parrainages_owner_write ON public.parrainages FOR INSERT TO authenticated
  WITH CHECK (parrain_client_id IN (SELECT id FROM public.clients WHERE user_id=auth.uid()) OR has_role(auth.uid(),'admin'));
CREATE POLICY parrainages_staff_update ON public.parrainages FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS acquisition_source text,
  ADD COLUMN IF NOT EXISTS acquisition_detail text,
  ADD COLUMN IF NOT EXISTS acquisition_campagne_id text,
  ADD COLUMN IF NOT EXISTS acquisition_audience text,
  ADD COLUMN IF NOT EXISTS webinaire_session_id uuid REFERENCES public.webinaire_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parrainage_id uuid REFERENCES public.parrainages(id) ON DELETE SET NULL;

ALTER TABLE public.dossiers
  ADD COLUMN IF NOT EXISTS acquisition_source text,
  ADD COLUMN IF NOT EXISTS acquisition_detail text,
  ADD COLUMN IF NOT EXISTS acquisition_campagne_id text,
  ADD COLUMN IF NOT EXISTS acquisition_audience text,
  ADD COLUMN IF NOT EXISTS webinaire_session_id uuid REFERENCES public.webinaire_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parrainage_id uuid REFERENCES public.parrainages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS marketing_events_email_idx ON public.marketing_events(email,occurred_at);
CREATE INDEX IF NOT EXISTS webinaire_sessions_campagne_idx ON public.webinaire_sessions(campagne_id);
CREATE INDEX IF NOT EXISTS parrainages_filleul_email_idx ON public.parrainages(lower(filleul_email));