-- Lot C — Task orchestration foundation.
-- Existing unlinked historical tasks are retained but explicitly quarantined
-- from the new operational queue. New tasks can be idempotently keyed and
-- linked to the business object that triggered them.

ALTER TABLE public.taches
  ADD COLUMN IF NOT EXISTS contrat_id uuid REFERENCES public.contrats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_id uuid REFERENCES public.crm_emails(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS compagnie_id uuid REFERENCES public.compagnies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_event_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS resultat_attendu text,
  ADD COLUMN IF NOT EXISTS resultat_obtenu text,
  ADD COLUMN IF NOT EXISTS blocage_motif text,
  ADD COLUMN IF NOT EXISTS cree_par_agent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terminee_le timestamptz,
  ADD COLUMN IF NOT EXISTS orchestration_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS legacy_orpheline boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS taches_idempotency_key_uidx
  ON public.taches (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS taches_dossier_statut_idx
  ON public.taches (dossier_id, statut);

CREATE INDEX IF NOT EXISTS taches_echeance_ouvertes_idx
  ON public.taches (echeance, statut)
  WHERE statut IN ('a_faire','en_cours','a_qualifier');

UPDATE public.taches
SET legacy_orpheline = true
WHERE client_id IS NULL AND dossier_id IS NULL AND legacy_orpheline = false;