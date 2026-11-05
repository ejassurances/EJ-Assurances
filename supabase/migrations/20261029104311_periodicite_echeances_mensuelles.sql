-- Échéances mensuelles par défaut, périodicité annuelle conservée sur choix explicite et e-Trottineur.
ALTER TABLE public.contrats ALTER COLUMN fractionnement SET DEFAULT 'mensuel';

ALTER TABLE public.contrat_echeances DROP CONSTRAINT IF EXISTS contrat_echeances_contrat_id_annee_key;
CREATE UNIQUE INDEX IF NOT EXISTS contrat_echeances_contrat_annee_debut_key
  ON public.contrat_echeances (contrat_id, annee, date_debut_periode);

CREATE OR REPLACE FUNCTION public.recalculer_echeances_contrat(_contrat_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.contrats%ROWTYPE;
  produit_row public.produits%ROWTYPE;
  nb_periodes integer;
  duree_mois integer;
  mois_par_periode integer;
  periode integer;
  mois_dans_periode integer;
  annee_contrat integer;
  d_start date;
  d_end date;
  capital numeric(14,2);
  crd_debut numeric(14,2);
  crd_fin numeric(14,2);
  base numeric(14,2);
  prime numeric(14,2);
  base_commission numeric(14,2);
  comm_cab numeric(14,2);
  taux_m numeric;
  assiette_m text;
  taux_p numeric;
  assiette_p text;
  comm_m numeric(14,2);
  comm_p numeric(14,2);
  base_partenaire numeric(14,2);
  mensualite numeric(14,2);
  i_mens numeric;
  tx_ass numeric;
  tx_pret numeric;
  periodique_mensuel boolean;
  precompte_actif boolean;
  nb_existantes integer;
BEGIN
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'EXECUTE', 'function:recalculer_echeances_contrat', _contrat_id::text, NULL);

  SELECT * INTO c FROM public.contrats WHERE id = _contrat_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF c.statut IN ('resilie', 'annule', 'cloture') THEN
    SELECT COUNT(*) INTO nb_existantes FROM public.contrat_echeances WHERE contrat_id = _contrat_id;
    IF nb_existantes > 0 THEN RETURN; END IF;
  END IF;

  DELETE FROM public.contrat_echeances WHERE contrat_id = _contrat_id;
  IF c.date_effet IS NULL THEN RETURN; END IF;

  -- Sans durée exploitable, ne pas inventer d'échéances.
  duree_mois := c.duree_mois;
  IF duree_mois IS NULL OR duree_mois <= 0 THEN
    IF c.date_echeance IS NULL OR c.date_echeance <= c.date_effet THEN RETURN; END IF;
    duree_mois := GREATEST(1,
      ((EXTRACT(YEAR FROM age(c.date_echeance, c.date_effet))::integer * 12)
       + EXTRACT(MONTH FROM age(c.date_echeance, c.date_effet))::integer
       + CASE WHEN EXTRACT(DAY FROM age(c.date_echeance, c.date_effet)) > 0 THEN 1 ELSE 0 END));
  END IF;

  periodique_mensuel := lower(coalesce(c.fractionnement, 'mensuel')) IN ('mensuel','mensuelle','mensuellement')
    AND lower(coalesce(c.produit, '')) NOT LIKE '%trottin%';
  nb_periodes := CASE WHEN periodique_mensuel THEN duree_mois ELSE CEIL(duree_mois::numeric / 12)::integer END;

  tx_ass := COALESCE(c.taux_assurance_annuel, 0);
  IF tx_ass > 0.05 THEN tx_ass := tx_ass / 100; END IF;
  tx_pret := COALESCE(c.taux_pret, 0);
  IF tx_pret > 0.2 THEN tx_pret := tx_pret / 100; END IF;

  IF c.produit_id IS NOT NULL THEN
    SELECT * INTO produit_row FROM public.produits WHERE id = c.produit_id;
  END IF;

  capital := COALESCE(c.capital_initial, 0);
  IF c.is_emprunteur AND capital > 0 THEN
    IF tx_pret > 0 THEN
      i_mens := tx_pret / 12;
      mensualite := capital * i_mens / (1 - power(1 + i_mens, -duree_mois));
    ELSE
      mensualite := capital / duree_mois;
    END IF;
  ELSE
    i_mens := 0;
    mensualite := 0;
  END IF;
  crd_debut := capital;

  FOR periode IN 1..nb_periodes LOOP
    mois_par_periode := CASE WHEN periodique_mensuel THEN 1 ELSE LEAST(12, duree_mois - (periode - 1) * 12) END;
    annee_contrat := ((periode - 1) / CASE WHEN periodique_mensuel THEN 12 ELSE 1 END) + 1;
    d_start := (c.date_effet + ((CASE WHEN periodique_mensuel THEN periode - 1 ELSE (periode - 1) * 12 END) || ' months')::interval)::date;
    d_end := (d_start + (mois_par_periode || ' months')::interval - INTERVAL '1 day')::date;

    IF c.is_emprunteur AND capital > 0 THEN
      IF c.assiette = 'capital_restant_du' THEN base := crd_debut; ELSE base := capital; END IF;
      prime := base * tx_ass * (COALESCE(c.quotite, 100) / 100.0) * mois_par_periode / 12.0;
      IF prime = 0 THEN
        prime := COALESCE(c.prime_annuelle, 0) * mois_par_periode / 12.0;
      END IF;
    ELSE
      IF c.mode_commissionnement = 'precompte' AND annee_contrat > 1 THEN
        prime := 0;
      ELSE
        prime := COALESCE(c.prime_annuelle, 0) * mois_par_periode / 12.0;
      END IF;
    END IF;

    -- La commission est assise sur la prime nette annuelle, proratisée à la période.
    -- En précompte, la commission annuelle est enregistrée une seule fois au début du contrat.
    precompte_actif := c.mode_commissionnement = 'precompte';
    IF precompte_actif AND periode > 1 THEN
      base_commission := 0;
    ELSIF precompte_actif THEN
      base_commission := COALESCE(c.prime_nette_annuelle, 0);
    ELSE
      base_commission := COALESCE(c.prime_nette_annuelle, 0) * mois_par_periode / 12.0;
    END IF;
    comm_cab := base_commission * COALESCE(c.commission_cabinet_taux, 0);
    comm_m := 0;
    comm_p := 0;

    IF c.mandataire_id IS NOT NULL THEN
      SELECT tr.taux, tr.assiette INTO taux_m, assiette_m
      FROM public.trouver_taux_regle(
        c.mandataire_id, 'mandataire', c.compagnie_id, c.produit_id,
        produit_row.famille_id, d_start
      ) tr;
      IF taux_m IS NOT NULL THEN
        base_partenaire := CASE WHEN assiette_m = 'prime_ht' THEN base_commission ELSE comm_cab END;
        comm_m := base_partenaire * taux_m;
      END IF;
    END IF;

    IF c.prescripteur_id IS NOT NULL THEN
      SELECT tr.taux, tr.assiette INTO taux_p, assiette_p
      FROM public.trouver_taux_regle(
        c.prescripteur_id, 'prescripteur', c.compagnie_id, c.produit_id,
        produit_row.famille_id, d_start
      ) tr;
      IF taux_p IS NOT NULL THEN
        base_partenaire := CASE WHEN assiette_p = 'prime_ht' THEN base_commission ELSE comm_cab END;
        comm_p := base_partenaire * taux_p;
      END IF;
    END IF;

    INSERT INTO public.contrat_echeances (
      contrat_id, annee, date_debut_periode, date_fin_periode,
      capital_restant_du_debut, prime_periode,
      commission_cabinet_periode, commission_mandataire_periode, commission_prescripteur_periode,
      mandataire_id, prescripteur_id, statut
    ) VALUES (
      _contrat_id, annee_contrat, d_start, d_end,
      crd_debut, ROUND(prime, 2),
      ROUND(comm_cab, 2), ROUND(comm_m, 2), ROUND(comm_p, 2),
      c.mandataire_id, c.prescripteur_id, 'previsionnel'
    );

    IF c.is_emprunteur AND capital > 0 THEN
      FOR mois_dans_periode IN 1..mois_par_periode LOOP
        IF tx_pret > 0 THEN
          crd_fin := crd_debut * (1 + i_mens) - mensualite;
        ELSE
          crd_fin := crd_debut - mensualite;
        END IF;
        crd_debut := GREATEST(0, crd_fin);
      END LOOP;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculer_echeances_contrat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculer_echeances_contrat(uuid) TO authenticated, service_role;
