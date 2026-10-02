-- Lot I — Compliance & Regulatory foundation.
-- Extend the existing regulatory watch and add applicability, obligations,
-- controls and incident objects without turning agent analysis into law.

ALTER TABLE public.veille_reglementaire
  ADD COLUMN IF NOT EXISTS autorite text,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS date_publication date,
  ADD COLUMN IF NOT EXISTS date_entree_vigueur date,
  ADD COLUMN IF NOT EXISTS version text,
  ADD COLUMN IF NOT EXISTS domaine text,
  ADD COLUMN IF NOT EXISTS nature text NOT NULL DEFAULT 'information',
  ADD COLUMN IF NOT EXISTS date_prochaine_revue date,
  ADD COLUMN IF NOT EXISTS analyse_agent text,
  ADD COLUMN IF NOT EXISTS validation_humaine boolean NOT NULL DEFAULT false;
ALTER TABLE public.veille_reglementaire DROP CONSTRAINT IF EXISTS veille_reglementaire_nature_check;
ALTER TABLE public.veille_reglementaire ADD CONSTRAINT veille_reglementaire_nature_check
  CHECK (nature IN ('texte_applicable','recommandation','bonne_pratique','interpretation','hypothese','information'));

CREATE TABLE IF NOT EXISTS public.reglementaire_applicabilites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veille_id uuid NOT NULL REFERENCES public.veille_reglementaire(id) ON DELETE CASCADE,
  perimetre text NOT NULL,
  activites_concernees text,
  entites_concernees text,
  produits_concernes text,
  conclusion_agent text,
  niveau_confiance text,
  validation_humaine boolean NOT NULL DEFAULT false,
  valide_par uuid,
  valide_le timestamptz,
  statut text NOT NULL DEFAULT 'a_valider',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reglementaire_applicabilites_confiance_check CHECK (niveau_confiance IS NULL OR niveau_confiance IN ('faible','moyenne','forte')),
  CONSTRAINT reglementaire_applicabilites_statut_check CHECK (statut IN ('a_analyser','a_valider','validee','non_applicable'))
);
ALTER TABLE public.reglementaire_applicabilites ENABLE ROW LEVEL SECURITY;
CREATE POLICY reglementaire_applicabilites_staff_all ON public.reglementaire_applicabilites FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));

CREATE TABLE IF NOT EXISTS public.conformite_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.veille_reglementaire(id) ON DELETE SET NULL,
  applicabilite_id uuid REFERENCES public.reglementaire_applicabilites(id) ON DELETE SET NULL,
  niveau text NOT NULL,
  domaine text NOT NULL,
  libelle text NOT NULL,
  description text,
  date_entree_vigueur date,
  periodicite text,
  preuve_attendue text,
  responsable text,
  statut text NOT NULL DEFAULT 'a_definir',
  prochaine_echeance date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conformite_obligations_niveau_check CHECK (niveau IN ('cabinet','mandataire','partenaire','client_dossier')),
  CONSTRAINT conformite_obligations_statut_check CHECK (statut IN ('a_definir','a_mettre_en_place','en_place','conforme','non_conforme','non_applicable'))
);
ALTER TABLE public.conformite_obligations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conformite_obligations_staff_all ON public.conformite_obligations FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));

CREATE TABLE IF NOT EXISTS public.conformite_controles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.conformite_obligations(id) ON DELETE CASCADE,
  nom text NOT NULL,
  frequence text,
  responsable text,
  procedure text,
  preuve_attendue text,
  derniere_execution timestamptz,
  resultat text,
  anomalie text,
  prochaine_echeance date,
  statut text NOT NULL DEFAULT 'a_faire',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conformite_controles_statut_check CHECK (statut IN ('a_faire','en_cours','conforme','non_conforme','retard'))
);
ALTER TABLE public.conformite_controles ENABLE ROW LEVEL SECURITY;
CREATE POLICY conformite_controles_staff_all ON public.conformite_controles FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));

CREATE TABLE IF NOT EXISTS public.conformite_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  niveau text NOT NULL,
  type text NOT NULL,
  titre text NOT NULL,
  description text,
  entite_type text,
  entite_id uuid,
  detecte_le timestamptz NOT NULL DEFAULT now(),
  survenu_le timestamptz,
  gravite text NOT NULL,
  notification_requise boolean NOT NULL DEFAULT false,
  action_immediate text,
  plan_correctif text,
  responsable text,
  echeance_corrective date,
  statut text NOT NULL DEFAULT 'ouvert',
  cloture_le timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conformite_incidents_niveau_check CHECK (niveau IN ('cabinet','mandataire','partenaire','client_dossier')),
  CONSTRAINT conformite_incidents_statut_check CHECK (statut IN ('ouvert','en_analyse','action_corrective','cloture','non_retenu'))
);
ALTER TABLE public.conformite_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY conformite_incidents_staff_all ON public.conformite_incidents FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));

CREATE INDEX IF NOT EXISTS conformite_obligations_echeance_idx ON public.conformite_obligations(statut,prochaine_echeance);
CREATE INDEX IF NOT EXISTS conformite_controles_echeance_idx ON public.conformite_controles(statut,prochaine_echeance);
CREATE INDEX IF NOT EXISTS conformite_incidents_statut_idx ON public.conformite_incidents(statut,gravite);