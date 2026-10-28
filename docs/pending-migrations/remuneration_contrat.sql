-- À appliquer via l'outil de migration quand la base sera relancée.
-- Additif : aucune donnée supprimée ; commissions et finance_revenus (paiements réels) non touchés.

ALTER TABLE public.commission_bareme
  ADD COLUMN IF NOT EXISTS mode text CHECK (mode IN ('lineaire','precompte')),
  ADD COLUMN IF NOT EXISTS taux_annee_1 numeric(6,3),
  ADD COLUMN IF NOT EXISTS taux_renouvellement numeric(6,3),
  ADD COLUMN IF NOT EXISTS date_effet date,
  ADD COLUMN IF NOT EXISTS date_fin date,
  ADD COLUMN IF NOT EXISTS produit_id uuid REFERENCES public.produits(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.commission_bareme.base_calcul IS
  'economie_realisee relève des frais de distribution, pas de la commission : à revoir.';

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.commission_bareme
  ADD CONSTRAINT commission_bareme_periodes_sans_chevauchement
  EXCLUDE USING gist (
    compagnie_id WITH =, branche WITH =,
    (COALESCE(produit_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(date_effet, date_fin, '[]') WITH &&
  ) WHERE (date_effet IS NOT NULL);
-- Note : l'index unique commission_bareme_compagnie_unique (une règle par branche+compagnie)
-- empêche encore plusieurs versions datées ; son remplacement sera soumis à votre accord.

CREATE TABLE IF NOT EXISTS public.contrat_remuneration_previsionnelle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cle text NOT NULL UNIQUE,
  contrat_id uuid NOT NULL REFERENCES public.contrats(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('frais_distribution','commission')),
  annee integer NOT NULL DEFAULT 1,
  statut text NOT NULL CHECK (statut IN ('calcule','a_verifier','non_calculable','remplace')),
  base numeric(14,2),
  taux numeric(6,3),
  montant numeric(14,2),
  motif text,
  bareme_id uuid REFERENCES public.commission_bareme(id) ON DELETE SET NULL,
  bareme_snapshot jsonb,
  calcule_le timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crp_contrat ON public.contrat_remuneration_previsionnelle(contrat_id);

GRANT SELECT, INSERT, UPDATE ON public.contrat_remuneration_previsionnelle TO authenticated;
GRANT ALL ON public.contrat_remuneration_previsionnelle TO service_role;
ALTER TABLE public.contrat_remuneration_previsionnelle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cabinet lit la remuneration previsionnelle"
  ON public.contrat_remuneration_previsionnelle FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'));
CREATE POLICY "Cabinet ecrit la remuneration previsionnelle"
  ON public.contrat_remuneration_previsionnelle FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'));
CREATE POLICY "Cabinet met a jour la remuneration previsionnelle"
  ON public.contrat_remuneration_previsionnelle FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'));
