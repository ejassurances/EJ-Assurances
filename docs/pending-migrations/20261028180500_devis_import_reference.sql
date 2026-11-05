-- Référence durable des lectures IA de devis, liée à une version exacte du document.
-- Un remplacement du fichier produit une empreinte différente et donc une nouvelle lecture.
CREATE TABLE IF NOT EXISTS public.devis_import_lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  dossier_id uuid NOT NULL REFERENCES public.dossiers(id) ON DELETE CASCADE,
  source_sha256 text NOT NULL,
  extraction jsonb NOT NULL,
  statut text NOT NULL DEFAULT 'proposee' CHECK (statut IN ('proposee', 'validee')),
  lue_le timestamptz NOT NULL DEFAULT now(),
  validee_le timestamptz,
  validee_par uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, source_sha256)
);

CREATE INDEX IF NOT EXISTS devis_import_lectures_dossier_idx
  ON public.devis_import_lectures (dossier_id, created_at DESC);

ALTER TABLE public.devis_import_lectures ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.devis_import_lectures TO authenticated;
GRANT ALL ON public.devis_import_lectures TO service_role;

DROP POLICY IF EXISTS "Staff consulte les lectures de devis" ON public.devis_import_lectures;
CREATE POLICY "Staff consulte les lectures de devis"
ON public.devis_import_lectures FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'));

DROP POLICY IF EXISTS "Staff cree les lectures de devis" ON public.devis_import_lectures;
CREATE POLICY "Staff cree les lectures de devis"
ON public.devis_import_lectures FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'));

DROP POLICY IF EXISTS "Staff valide les lectures de devis" ON public.devis_import_lectures;
CREATE POLICY "Staff valide les lectures de devis"
ON public.devis_import_lectures FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'));
