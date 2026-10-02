-- Lot H — Agent IA governance foundation.
-- Every autonomous run/action is traceable to a trigger and validated rule.
-- New/ambiguous situations are represented as explicit escalations.

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  trigger_type text NOT NULL,
  trigger_ref text,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rule_ref text,
  rule_version text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  error text,
  CONSTRAINT agent_runs_status_check CHECK (status IN ('running','completed','blocked','failed','cancelled'))
);
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_runs_staff_read ON public.agent_runs FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  target_type text,
  target_id text,
  idempotency_key text,
  status text NOT NULL DEFAULT 'completed',
  rule_ref text,
  rule_version text,
  input_summary text,
  output_summary text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_actions_status_check CHECK (status IN ('proposed','executed','skipped','blocked','failed'))
);
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_actions_staff_read ON public.agent_actions FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE UNIQUE INDEX IF NOT EXISTS agent_actions_idempotency_uidx
  ON public.agent_actions(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.taches(id) ON DELETE SET NULL,
  motif text NOT NULL,
  contexte text,
  information_manquante text,
  decision_attendue text,
  statut text NOT NULL DEFAULT 'a_traiter',
  demande_le timestamptz NOT NULL DEFAULT now(),
  resolue_le timestamptz,
  resolution text,
  CONSTRAINT agent_escalations_statut_check CHECK (statut IN ('a_traiter','en_cours','resolue','annulee'))
);
ALTER TABLE public.agent_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_escalations_staff_all ON public.agent_escalations FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));

CREATE TABLE IF NOT EXISTS public.agent_permissions (
  action_type text PRIMARY KEY,
  niveau text NOT NULL,
  actif boolean NOT NULL DEFAULT true,
  justification text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_permissions_niveau_check CHECK (niveau IN ('autonome','validation_humaine','execution_humaine','escalade'))
);
ALTER TABLE public.agent_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_permissions_staff_read ON public.agent_permissions FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY agent_permissions_admin_write ON public.agent_permissions FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

INSERT INTO public.agent_permissions(action_type,niveau,justification) VALUES
 ('classement_documentaire','autonome','Règles documentaires validées'),
 ('creation_tache','autonome','Orchestration opérationnelle'),
 ('relance_prevue','autonome','Séquences déjà validées'),
 ('statistiques','autonome','Calcul non décisionnel'),
 ('preparation_fic','validation_humaine','Validation finale obligatoire'),
 ('recommandation_assurance','validation_humaine','Décision de conseil'),
 ('conformite_sensible','validation_humaine','Décision réglementaire sensible'),
 ('nouvelle_regle_metier','escalade','Toute règle nouvelle doit être validée')
ON CONFLICT (action_type) DO NOTHING;