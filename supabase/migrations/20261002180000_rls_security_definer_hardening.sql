-- Harden SECURITY DEFINER functions exposed to authenticated clients.
-- These functions read or update sensitive CRM data and must enforce
-- cabinet/client scope explicitly.

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
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire')) THEN
    RAISE EXCEPTION 'Accès réservé au cabinet';
  END IF;
  IF NOT public.can_access_client(_client_id) THEN
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

CREATE OR REPLACE FUNCTION public.score_valeur_client(p_client_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  total_ca numeric;
  nb_ct numeric;
  nb_reco numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire')) THEN
    RAISE EXCEPTION 'Accès réservé au cabinet';
  END IF;
  IF NOT public.can_access_client(p_client_id) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  SELECT COALESCE(SUM(cm.montant),0)::numeric INTO total_ca
    FROM public.commissions cm
    JOIN public.contrats ct ON ct.id = cm.contrat_id
   WHERE ct.client_id = p_client_id AND cm.statut = 'versee';
  SELECT COUNT(*)::numeric INTO nb_ct FROM public.contrats WHERE client_id = p_client_id;
  SELECT COUNT(*)::numeric INTO nb_reco FROM public.clients
   WHERE client_origine_id = p_client_id AND origine IN ('parrainage','recommandation');

  RETURN GREATEST(0, LEAST(100, ROUND(
      LEAST(total_ca / 5000, 1) * 100 * 0.50
    + LEAST(nb_ct / 5, 1) * 100 * 0.25
    + LEAST(nb_reco / 5, 1) * 100 * 0.25
  )))::integer;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_calculer_fiscalite_contrat() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_calculer_fiscalite_devis() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_document_recu_cree_tache() FROM PUBLIC, anon, authenticated;