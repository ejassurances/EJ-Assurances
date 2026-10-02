-- Lot F — Finance / CA foundation.
-- Keep operational finance distinct from accounting journals while creating
-- a single auditable revenue/charge layer for forecasting and cash tracking.

CREATE TABLE IF NOT EXISTS public.finance_revenus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid REFERENCES public.dossiers(id) ON DELETE SET NULL,
  contrat_id uuid REFERENCES public.contrats(id) ON DELETE SET NULL,
  compagnie_id uuid REFERENCES public.compagnies(id) ON DELETE SET NULL,
  beneficiaire_id uuid,
  commission_id uuid REFERENCES public.commissions(id) ON DELETE SET NULL,
  type text NOT NULL,
  statut text NOT NULL DEFAULT 'previsionnel',
  montant numeric NOT NULL,
  devise text NOT NULL DEFAULT 'EUR',
  date_prevue date,
  date_facture date,
  date_encaissement date,
  reference_externe text,
  source text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_revenus_type_check CHECK (type IN ('commission','frais_distribution','surcommission','autre')),
  CONSTRAINT finance_revenus_statut_check CHECK (statut IN ('previsionnel','securise','facture','encaisse','annule'))
);
ALTER TABLE public.finance_revenus ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_revenus_staff_read ON public.finance_revenus FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY finance_revenus_staff_write ON public.finance_revenus FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE UNIQUE INDEX IF NOT EXISTS finance_revenus_commission_uidx
  ON public.finance_revenus(commission_id,type) WHERE commission_id IS NOT NULL;

INSERT INTO public.finance_revenus (
  dossier_id,contrat_id,compagnie_id,beneficiaire_id,commission_id,
  type,statut,montant,date_encaissement,source,notes
)
SELECT c.dossier_id,c.contrat_id,ct.compagnie_id,c.beneficiaire_id,c.id,
  'commission',
  CASE WHEN c.statut='versee' THEN 'encaisse' ELSE 'previsionnel' END,
  c.montant,
  CASE WHEN c.statut='versee' THEN c.date_versement ELSE NULL END,
  'commission_existante',
  'Initialisation Lot F depuis la table commissions'
FROM public.commissions c
LEFT JOIN public.contrats ct ON ct.id=c.contrat_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.finance_revenus r
  WHERE r.commission_id=c.id AND r.type='commission'
);

CREATE TABLE IF NOT EXISTS public.finance_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiers_id uuid REFERENCES public.tiers(id) ON DELETE SET NULL,
  business text,
  categorie text NOT NULL,
  statut text NOT NULL DEFAULT 'previsionnel',
  montant numeric NOT NULL,
  devise text NOT NULL DEFAULT 'EUR',
  periode date,
  date_echeance date,
  date_facture date,
  date_paiement date,
  reference_externe text,
  source text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_charges_statut_check CHECK (statut IN ('previsionnel','engage','facture','paye','annule'))
);
ALTER TABLE public.finance_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_charges_staff_read ON public.finance_charges FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY finance_charges_admin_write ON public.finance_charges FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS finance_revenus_statut_date_idx ON public.finance_revenus(statut,date_prevue);
CREATE INDEX IF NOT EXISTS finance_charges_statut_date_idx ON public.finance_charges(statut,date_echeance);