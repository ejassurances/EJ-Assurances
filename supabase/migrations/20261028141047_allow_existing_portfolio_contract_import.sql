-- Les contrats importés au portefeuille sont des contrats déjà en vigueur.
-- Le blocage KYC s'applique aux nouvelles souscriptions rattachées à un dossier.
CREATE OR REPLACE FUNCTION public.trg_bloquer_contrat_non_conforme()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sc integer;
BEGIN
  IF NEW.dossier_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT conformite_score INTO sc
  FROM public.clients
  WHERE id = NEW.client_id;

  IF COALESCE(sc, 0) < 50 THEN
    RAISE EXCEPTION 'Conformité insuffisante (score %/100) : complétez les pièces KYC du client avant de créer un contrat.', COALESCE(sc, 0)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;
