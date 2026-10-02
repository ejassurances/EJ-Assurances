-- Lot A correction: the compliance score function is called both by
-- authenticated users and by SECURITY DEFINER database triggers. Preserve
-- the cabinet/client authorization for API callers while allowing trusted
-- trigger maintenance calls where auth.uid() is absent.

CREATE OR REPLACE FUNCTION public.calculer_score_conformite_client(_client_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  pts integer := 0;
  base integer := 80;
  est_pro boolean := false;
  cni_ok boolean := false;
  jd_ok boolean := false;
  rib_ok boolean := false;
  kbis_ok boolean := false;
  lcb_ok boolean := false;
  lcb_row record;
  derniere timestamptz;
  score integer;
  niveau text;
  prochaine date;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire')) THEN
    RAISE EXCEPTION 'Accès réservé au cabinet';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.client_kyc_documents
    WHERE client_id = _client_id AND type = 'cni' AND statut = 'valide'
      AND (date_expiration IS NULL OR date_expiration >= CURRENT_DATE)
  ) INTO cni_ok;
  SELECT EXISTS (
    SELECT 1 FROM public.client_kyc_documents
    WHERE client_id = _client_id AND type = 'rib' AND statut = 'valide'
  ) INTO rib_ok;
  SELECT EXISTS (
    SELECT 1 FROM public.client_kyc_documents
    WHERE client_id = _client_id AND type = 'justificatif_domicile' AND statut = 'valide'
      AND date_emission IS NOT NULL
      AND date_emission >= CURRENT_DATE - INTERVAL '3 months'
  ) INTO jd_ok;
  SELECT EXISTS (
    SELECT 1 FROM public.client_entreprise
    WHERE client_id = _client_id
      AND (siret IS NOT NULL OR raison_sociale IS NOT NULL)
  ) INTO est_pro;

  IF est_pro THEN
    base := 100;
    SELECT EXISTS (
      SELECT 1 FROM public.client_kyc_documents
      WHERE client_id = _client_id AND type = 'kbis' AND statut = 'valide'
        AND (date_emission IS NULL OR date_emission >= CURRENT_DATE - INTERVAL '12 months')
        AND (date_expiration IS NULL OR date_expiration >= CURRENT_DATE)
    ) INTO kbis_ok;
  END IF;

  SELECT * INTO lcb_row FROM public.client_lcb_verifications
   WHERE client_id = _client_id
   ORDER BY verifie_le DESC LIMIT 1;

  IF lcb_row IS NOT NULL THEN
    derniere := lcb_row.verifie_le;
    lcb_ok := lcb_row.statut IN ('clair', 'faux_positif')
              AND lcb_row.verifie_le >= now() - INTERVAL '12 months';
  END IF;

  IF cni_ok THEN pts := pts + 30; END IF;
  IF jd_ok AND rib_ok THEN pts := pts + 30; END IF;
  IF kbis_ok THEN pts := pts + 20; END IF;
  IF lcb_ok THEN pts := pts + 20; END IF;

  score := LEAST(100, GREATEST(0, ROUND(pts::numeric * 100 / base)::integer));
  IF score >= 90 THEN
    niveau := 'vert'; prochaine := CURRENT_DATE + INTERVAL '18 months';
  ELSIF score >= 50 THEN
    niveau := 'orange'; prochaine := CURRENT_DATE + INTERVAL '12 months';
  ELSE
    niveau := 'rouge'; prochaine := CURRENT_DATE + INTERVAL '6 months';
  END IF;

  UPDATE public.clients
     SET conformite_score = score,
         conformite_niveau = niveau,
         conformite_derniere_verif = COALESCE(derniere, conformite_derniere_verif),
         conformite_prochaine_verif = prochaine
   WHERE id = _client_id;
  RETURN score;
END;
$function$;

UPDATE public.client_lcb_verifications
SET statut='a_verifier',
    notes=coalesce(notes,'') ||
      CASE WHEN coalesce(notes,'')='' THEN
        'Correction Lot A : échec technique OpenSanctions, contrôle non concluant.'
      ELSE
        ' Correction Lot A : échec technique OpenSanctions, contrôle non concluant.'
      END
WHERE statut='clair'
  AND coalesce((requete->>'api_ok')::boolean,true)=false;