-- CARDIF peut réutiliser le numéro de contrat pour plusieurs clients.
-- Conserver séparément la référence compagnie, utilisée comme clé de rapprochement prioritaire.
ALTER TABLE public.contrats
  ADD COLUMN IF NOT EXISTS numero_reference text;

CREATE INDEX IF NOT EXISTS idx_contrats_assureur_reference
  ON public.contrats (assureur, numero_reference)
  WHERE numero_reference IS NOT NULL;
