-- Tarif indicatif conservé dans produits.caracteristiques.tarif_moyen_mensuel.
-- Franchise ITT sélectionnée au niveau du devis client (et non du produit générique).
ALTER TABLE public.dossier_devis
  ADD COLUMN IF NOT EXISTS franchise_itt_jours integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dossier_devis_franchise_itt_jours_check'
      AND conrelid = 'public.dossier_devis'::regclass
  ) THEN
    ALTER TABLE public.dossier_devis
      ADD CONSTRAINT dossier_devis_franchise_itt_jours_check
      CHECK (franchise_itt_jours IS NULL OR franchise_itt_jours IN (30, 60, 90));
  END IF;
END $$;
