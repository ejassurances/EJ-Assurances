-- Lot D — Documents / pièces / devis foundation.
-- Distinguish receipt from exploitability and a quote from its source/reference.

ALTER TABLE public.dossier_pieces_requises
  ADD COLUMN IF NOT EXISTS demande_le timestamptz,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS controle_statut text NOT NULL DEFAULT 'non_controle',
  ADD COLUMN IF NOT EXISTS controle_le timestamptz,
  ADD COLUMN IF NOT EXISTS controle_resultat text,
  ADD COLUMN IF NOT EXISTS motif_rejet text,
  ADD COLUMN IF NOT EXISTS source_event_id text;

ALTER TABLE public.dossier_pieces_requises DROP CONSTRAINT IF EXISTS dossier_pieces_requises_controle_statut_check;
ALTER TABLE public.dossier_pieces_requises ADD CONSTRAINT dossier_pieces_requises_controle_statut_check
  CHECK (controle_statut IN ('non_controle','exploitable','incoherent','a_corriger','refuse'));

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS statut_exploitabilite text NOT NULL DEFAULT 'recu',
  ADD COLUMN IF NOT EXISTS controle_le timestamptz,
  ADD COLUMN IF NOT EXISTS controle_resultat text,
  ADD COLUMN IF NOT EXISTS motif_rejet text,
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_statut_exploitabilite_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_statut_exploitabilite_check
  CHECK (statut_exploitabilite IN ('recu','exploitable','incoherent','a_corriger','refuse','archive'));

ALTER TABLE public.dossier_devis
  ADD COLUMN IF NOT EXISTS reference_externe text,
  ADD COLUMN IF NOT EXISTS date_devis date,
  ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'recu',
  ADD COLUMN IF NOT EXISTS est_reference_recommandation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motif_non_retenu text,
  ADD COLUMN IF NOT EXISTS analyse_garanties jsonb,
  ADD COLUMN IF NOT EXISTS analyse_source text,
  ADD COLUMN IF NOT EXISTS produit_document_id uuid REFERENCES public.produit_documents(id) ON DELETE SET NULL;

ALTER TABLE public.dossier_devis DROP CONSTRAINT IF EXISTS dossier_devis_statut_check;
ALTER TABLE public.dossier_devis ADD CONSTRAINT dossier_devis_statut_check
  CHECK (statut IN ('recu','analyse','retenu','non_retenu','archive'));

CREATE INDEX IF NOT EXISTS dossier_pieces_controle_idx
  ON public.dossier_pieces_requises (dossier_id, controle_statut);
CREATE INDEX IF NOT EXISTS dossier_devis_reference_idx
  ON public.dossier_devis (dossier_id, est_reference_recommandation);
CREATE INDEX IF NOT EXISTS documents_exploitabilite_idx
  ON public.documents (dossier_id, statut_exploitabilite);