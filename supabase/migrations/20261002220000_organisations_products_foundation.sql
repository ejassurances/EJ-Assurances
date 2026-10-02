-- Lot E — Organizations / Products / Documents foundation.

CREATE TABLE IF NOT EXISTS public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  type text NOT NULL DEFAULT 'other',
  statut text NOT NULL DEFAULT 'actif',
  siret text,
  numero_tva text,
  site_web text,
  portail_url text,
  email_operationnel text,
  telephone_operationnel text,
  adresse text,
  code_postal text,
  ville text,
  pays text DEFAULT 'FR',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisations_type_check CHECK (type IN ('company','group','wholesaler','referrer','provider','other')),
  CONSTRAINT organisations_statut_check CHECK (statut IN ('actif','inactif','a_verifier','archive'))
);
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organisations_staff_read ON public.organisations FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY organisations_admin_write ON public.organisations FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.organisation_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  role text NOT NULL,
  date_debut date,
  date_fin date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisation_roles_role_check CHECK (role IN ('risk_carrier','intermediary','introducer','payer','negotiator'))
);
ALTER TABLE public.organisation_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY organisation_roles_staff_read ON public.organisation_roles FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY organisation_roles_admin_write ON public.organisation_roles FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.organisation_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  nom text NOT NULL,
  prenom text,
  fonction text,
  service text,
  email text,
  telephone text,
  type_contact text NOT NULL DEFAULT 'operationnel',
  principal boolean NOT NULL DEFAULT false,
  notes text,
  actif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisation_contacts_type_check CHECK (type_contact IN ('operationnel','commercial','conformite','sinistre','comptabilite','technique','direction','autre'))
);
ALTER TABLE public.organisation_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY organisation_contacts_staff_read ON public.organisation_contacts FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY organisation_contacts_admin_write ON public.organisation_contacts FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

ALTER TABLE public.compagnies ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS compagnies_organisation_uidx ON public.compagnies(organisation_id) WHERE organisation_id IS NOT NULL;

INSERT INTO public.organisations (nom, type, site_web, email_operationnel, telephone_operationnel, notes)
SELECT c.nom, 'company', c.site_web, c.contact_email, c.contact_telephone, c.notes
FROM public.compagnies c
WHERE c.organisation_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.organisations o WHERE lower(o.nom)=lower(c.nom));

UPDATE public.compagnies c
SET organisation_id=o.id
FROM public.organisations o
WHERE c.organisation_id IS NULL AND lower(o.nom)=lower(c.nom);

ALTER TABLE public.produits
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL;

UPDATE public.produits p
SET organisation_id=c.organisation_id
FROM public.compagnies c
WHERE p.compagnie_id=c.id AND p.organisation_id IS NULL;

ALTER TABLE public.produit_documents
  ADD COLUMN IF NOT EXISTS date_fin date,
  ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'actif';
ALTER TABLE public.produit_documents DROP CONSTRAINT IF EXISTS produit_documents_statut_check;
ALTER TABLE public.produit_documents ADD CONSTRAINT produit_documents_statut_check
  CHECK (statut IN ('brouillon','actif','remplace','archive'));

CREATE TABLE IF NOT EXISTS public.produit_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id uuid NOT NULL REFERENCES public.produits(id) ON DELETE CASCADE,
  date_debut date NOT NULL,
  date_fin date,
  commission_taux numeric,
  frais_versement_pct numeric,
  frais_gestion_pct numeric,
  frais_arbitrage_pct numeric,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT produit_conditions_dates_check CHECK (date_fin IS NULL OR date_fin >= date_debut)
);
ALTER TABLE public.produit_conditions ENABLE ROW LEVEL SECURITY;
CREATE POLICY produit_conditions_staff_read ON public.produit_conditions FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'mandataire'));
CREATE POLICY produit_conditions_admin_write ON public.produit_conditions FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

ALTER TABLE public.contrats
  ADD COLUMN IF NOT EXISTS produit_document_id uuid REFERENCES public.produit_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS produit_condition_id uuid REFERENCES public.produit_conditions(id) ON DELETE SET NULL;