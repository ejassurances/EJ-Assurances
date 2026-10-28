-- À appliquer via l'outil de migration quand la base sera relancée.
-- Additif : aucune donnée supprimée ; commissions et finance_revenus (paiements réels) non touchés.

ALTER TABLE public.commission_bareme
  ADD COLUMN IF NOT EXISTS base_previsionnelle text CHECK (base_previsionnelle IN ('prime','prime_nette')),
  ADD COLUMN IF NOT EXISTS mode text CHECK (mode IN ('lineaire','precompte')),
  ADD COLUMN IF NOT EXISTS taux_annee_1 numeric(6,3),
  ADD COLUMN IF NOT EXISTS taux_renouvellement numeric(6,3),
  ADD COLUMN IF NOT EXISTS date_effet date,
  ADD COLUMN IF NOT EXISTS date_fin date,
  ADD COLUMN IF NOT EXISTS produit_id uuid REFERENCES public.produits(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.commission_bareme.base_calcul IS
  'economie_realisee relève des frais de distribution, pas de la commission : à revoir.';

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.commission_bareme
  ADD CONSTRAINT commission_bareme_periodes_sans_chevauchement
  EXCLUDE USING gist (
    compagnie_id WITH =, branche WITH =,
    (COALESCE(produit_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(date_effet, date_fin, '[]') WITH &&
  ) WHERE (date_effet IS NOT NULL);
-- Note : l'index unique commission_bareme_compagnie_unique (une règle par branche+compagnie)
-- empêche encore plusieurs versions datées ; son remplacement sera soumis à votre accord.

CREATE TABLE IF NOT EXISTS public.contrat_remuneration_previsionnelle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cle text NOT NULL UNIQUE,
  contrat_id uuid NOT NULL REFERENCES public.contrats(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('frais_distribution','commission')),
  annee integer NOT NULL DEFAULT 1,
  statut text NOT NULL CHECK (statut IN ('calcule','a_verifier','non_calculable','remplace')),
  base numeric(14,2),
  taux numeric(6,3),
  montant numeric(14,2),
  motif text,
  bareme_id uuid REFERENCES public.commission_bareme(id) ON DELETE SET NULL,
  bareme_snapshot jsonb,
  calcule_le timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crp_contrat ON public.contrat_remuneration_previsionnelle(contrat_id);

GRANT SELECT ON public.contrat_remuneration_previsionnelle TO authenticated;
GRANT ALL ON public.contrat_remuneration_previsionnelle TO service_role;
ALTER TABLE public.contrat_remuneration_previsionnelle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cabinet lit la remuneration previsionnelle"
  ON public.contrat_remuneration_previsionnelle FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'))
    AND EXISTS (SELECT 1 FROM public.contrats c WHERE c.id = contrat_id AND public.can_access_client(c.client_id)));

CREATE TABLE public.remuneration_previsionnelle_historique (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrat_id uuid NOT NULL REFERENCES public.contrats(id),
  version_precedente jsonb NOT NULL,
  remplace_le timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.remuneration_previsionnelle_historique TO authenticated;
GRANT ALL ON public.remuneration_previsionnelle_historique TO service_role;
ALTER TABLE public.remuneration_previsionnelle_historique ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Historique remuneration autorise" ON public.remuneration_previsionnelle_historique
 FOR SELECT TO authenticated USING (
 (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'))
 AND EXISTS (SELECT 1 FROM public.contrats c WHERE c.id = contrat_id AND public.can_access_client(c.client_id)));

CREATE FUNCTION public.historiser_remuneration_previsionnelle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF (to_jsonb(NEW) - 'calcule_le') IS DISTINCT FROM (to_jsonb(OLD) - 'calcule_le') THEN
  INSERT INTO public.remuneration_previsionnelle_historique(contrat_id, version_precedente)
  VALUES (OLD.contrat_id, to_jsonb(OLD));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.historiser_remuneration_previsionnelle() FROM PUBLIC;
CREATE TRIGGER remuneration_historique BEFORE UPDATE ON public.contrat_remuneration_previsionnelle
 FOR EACH ROW EXECUTE FUNCTION public.historiser_remuneration_previsionnelle();

-- Source atomique : aucune écriture vers commissions/finance_revenus ni paiements.
CREATE FUNCTION public.recalculer_remuneration_contrat(p_contrat_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
 c public.contrats%ROWTYPE; b public.commission_bareme%ROWTYPE;
 branche text; frais numeric; eco numeric; ecart numeric; motif text;
 statut_frais text := 'calcule'; prime numeric; taux numeric; montant numeric;
 annee integer; nb integer := 1; com_motif text; produit_prioritaire boolean;
BEGIN
 SELECT * INTO c FROM public.contrats WHERE id = p_contrat_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF auth.uid() IS NOT NULL AND NOT (
   (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'))
   AND public.can_access_client(c.client_id)) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
 branche := public.branche_contrat(c.id);
 IF c.is_emprunteur OR branche = 'emprunteur' THEN
  eco := c.economie_realisee;
  ecart := c.economie_cout_groupe - c.economie_cout_delegue;
  IF c.duree_mois IS NULL OR c.duree_mois <= 0 OR
     c.economie_cout_groupe < 0 OR c.economie_cout_delegue < 0 OR eco < 0 OR
     (eco IS NOT NULL AND ecart IS NOT NULL AND abs(eco - ecart) > 1) OR
     (eco IS NULL AND (ecart IS NULL OR ecart < 0)) THEN
   statut_frais := 'a_verifier'; motif := 'Économie totale absente ou incohérente';
  ELSE eco := coalesce(eco, ecart); frais := round(eco * 0.05, 2); motif := '5 % des économies totales sur la durée du prêt'; END IF;
 ELSIF branche IN ('assurance_vie','vie','epargne') THEN frais := 0; motif := 'Assurance vie : 0 €';
 ELSE frais := 20; motif := '20 € par contrat'; END IF;
 INSERT INTO public.contrat_remuneration_previsionnelle(cle,contrat_id,type,annee,statut,base,montant,motif)
 VALUES(c.id || ':frais_distribution:1',c.id,'frais_distribution',1,statut_frais,eco,frais,motif)
 ON CONFLICT(cle) DO UPDATE SET statut=excluded.statut,base=excluded.base,montant=excluded.montant,motif=excluded.motif,calcule_le=now();

 SELECT EXISTS(SELECT 1 FROM public.commission_bareme r WHERE r.compagnie_id=c.compagnie_id
   AND r.branche=branche AND r.produit_id=c.produit_id AND r.mode IS NOT NULL
   AND r.date_effet <= c.date_effet AND (r.date_fin IS NULL OR r.date_fin >= c.date_effet)) INTO produit_prioritaire;
 SELECT count(*) INTO nb FROM public.commission_bareme r WHERE r.compagnie_id=c.compagnie_id AND r.branche=branche
   AND r.mode IS NOT NULL AND r.date_effet <= c.date_effet AND (r.date_fin IS NULL OR r.date_fin >= c.date_effet)
   AND (CASE WHEN produit_prioritaire THEN r.produit_id=c.produit_id ELSE r.produit_id IS NULL END);
 IF nb = 1 THEN
  SELECT * INTO b FROM public.commission_bareme r WHERE r.compagnie_id=c.compagnie_id AND r.branche=branche
   AND r.mode IS NOT NULL AND r.date_effet <= c.date_effet AND (r.date_fin IS NULL OR r.date_fin >= c.date_effet)
   AND (CASE WHEN produit_prioritaire THEN r.produit_id=c.produit_id ELSE r.produit_id IS NULL END);
 END IF;
 prime := CASE WHEN b.base_previsionnelle='prime_nette' THEN c.prime_nette_annuelle ELSE c.prime_annuelle END;
 IF b.id IS NULL THEN com_motif := 'Barème absent ou ambigu : à configurer';
 ELSIF b.base_calcul <> 'prime' THEN com_motif := 'Économies : frais de distribution, pas commission';
 ELSIF prime IS NULL OR prime <= 0 OR c.duree_mois IS NULL OR c.duree_mois <= 0 THEN com_motif := 'Prime ou durée absente';
 ELSIF b.taux_annee_1 IS NULL OR b.taux_annee_1 NOT BETWEEN 0 AND 100 OR
  (b.mode='precompte' AND c.duree_mois>12 AND (b.taux_renouvellement IS NULL OR b.taux_renouvellement NOT BETWEEN 0 AND 100)) THEN com_motif := 'Taux incomplet ou invalide'; END IF;
 nb := CASE WHEN com_motif IS NULL THEN ceil(c.duree_mois::numeric / 12)::integer ELSE 1 END;
 FOR annee IN 1..nb LOOP
  taux := CASE WHEN annee=1 OR b.mode='lineaire' THEN b.taux_annee_1 ELSE b.taux_renouvellement END;
  montant := CASE WHEN com_motif IS NULL THEN round(round(prime * least(12,c.duree_mois-(annee-1)*12)/12,2)*taux/100,2) END;
  INSERT INTO public.contrat_remuneration_previsionnelle(cle,contrat_id,type,annee,statut,base,taux,montant,motif,bareme_id,bareme_snapshot)
  VALUES(c.id || ':commission:' || annee,c.id,'commission',annee,CASE WHEN com_motif IS NULL THEN 'calcule' ELSE 'non_calculable' END,
   CASE WHEN com_motif IS NULL THEN round(prime * least(12,c.duree_mois-(annee-1)*12)/12,2) END,
   CASE WHEN com_motif IS NULL THEN taux END,montant,coalesce(com_motif,b.mode),b.id,to_jsonb(b))
  ON CONFLICT(cle) DO UPDATE SET statut=excluded.statut,base=excluded.base,taux=excluded.taux,montant=excluded.montant,
   motif=excluded.motif,bareme_id=excluded.bareme_id,bareme_snapshot=excluded.bareme_snapshot,calcule_le=now();
 END LOOP;
 UPDATE public.contrat_remuneration_previsionnelle SET statut='remplace' WHERE contrat_id=c.id AND type='commission' AND annee>nb AND statut<>'remplace';
END $$;
REVOKE ALL ON FUNCTION public.recalculer_remuneration_contrat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculer_remuneration_contrat(uuid) TO authenticated, service_role;

CREATE FUNCTION public.trg_remuneration_contrat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.recalculer_remuneration_contrat(NEW.id); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.trg_remuneration_contrat() FROM PUBLIC;
CREATE TRIGGER remuneration_contrat AFTER INSERT OR UPDATE OF compagnie_id,produit_id,dossier_id,date_effet,
 prime_annuelle,prime_nette_annuelle,duree_mois,is_emprunteur,economie_realisee,economie_cout_groupe,economie_cout_delegue
 ON public.contrats FOR EACH ROW EXECUTE FUNCTION public.trg_remuneration_contrat();

CREATE FUNCTION public.trg_remuneration_bareme() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ct record;
BEGIN
 FOR ct IN SELECT id FROM public.contrats WHERE compagnie_id=NEW.compagnie_id OR
  (TG_OP='UPDATE' AND compagnie_id=OLD.compagnie_id) ORDER BY id LOOP
  PERFORM public.recalculer_remuneration_contrat(ct.id);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_remuneration_bareme() FROM PUBLIC;
CREATE TRIGGER remuneration_bareme AFTER INSERT OR UPDATE ON public.commission_bareme
 FOR EACH ROW EXECUTE FUNCTION public.trg_remuneration_bareme();

-- ---------------------------------------------------------------------------
-- ÉTAPE 2 (NON APPLIQUÉE, à valider séparément) : autoriser plusieurs barèmes datés.
-- L'index unique commission_bareme_compagnie_unique reste intact à ce stade :
-- tant qu'il existe, une 2e version datée pour la même compagnie+branche est
-- refusée (erreur 23505, message clair dans la fiche compagnie).
-- Migration nécessaire, une fois la contrainte sans chevauchement ci-dessus en place :
--
--   DROP INDEX IF EXISTS public.commission_bareme_compagnie_unique;
--   CREATE UNIQUE INDEX IF NOT EXISTS commission_bareme_compagnie_sans_date_uidx
--     ON public.commission_bareme (compagnie_id, branche)
--     WHERE date_effet IS NULL AND compagnie_id IS NOT NULL;
--
-- Effet : les anciennes règles non datées gardent l'unicité ; les règles datées
-- sont protégées par commission_bareme_periodes_sans_chevauchement. Aucune donnée supprimée.

-- Retire uniquement le repli erroné économies -> commission ; aucun recalcul global.
CREATE OR REPLACE FUNCTION public.recalculer_prevision_contrat(_contrat_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.contrats%ROWTYPE;
  _prev public.commission_previsions%ROWTYPE;
  _branche text;
  _periodicite text;
  _cotisation numeric;
  _reel numeric;
  _nb_periodes integer;
  _dernier_mois date;
  _estime numeric;
  _ecoules integer;
  _restants integer;
  _offset integer := 0;
  _echeances integer;
  _famille_id uuid;
  _taux_cab numeric;
  _assiette_cab text;
BEGIN
  SELECT * INTO c FROM public.contrats WHERE id = _contrat_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF c.statut NOT IN ('actif','signe','contrat_actif','contrat_valide') THEN RETURN; END IF;

  _branche := public.branche_contrat(_contrat_id);
  _periodicite := CASE WHEN lower(COALESCE(c.fractionnement,'')) LIKE 'annuel%' THEN 'annuelle' ELSE 'mensuelle' END;

  _cotisation := CASE
    WHEN c.prime_nette_annuelle IS NULL THEN NULL
    WHEN _periodicite = 'annuelle' THEN c.prime_nette_annuelle
    ELSE c.prime_nette_annuelle / 12
  END;

  SELECT SUM(montant),
         COUNT(DISTINCT CASE WHEN _periodicite = 'annuelle'
                             THEN date_trunc('year', date_versement)
                             ELSE date_trunc('month', date_versement) END),
         MAX(date_trunc('month', date_versement))::date
    INTO _reel, _nb_periodes, _dernier_mois
    FROM public.commissions
   WHERE contrat_id = _contrat_id AND statut = 'versee' AND date_versement IS NOT NULL;

  IF _nb_periodes IS NOT NULL AND _nb_periodes > 0 THEN
    _reel := ROUND(_reel / _nb_periodes, 2);
  ELSE
    _reel := NULL;
  END IF;

  IF c.produit_id IS NOT NULL THEN
    SELECT famille_id INTO _famille_id FROM public.produits WHERE id = c.produit_id;
  END IF;

  IF c.commission_cabinet_taux IS NOT NULL AND c.commission_cabinet_taux > 0 THEN
    _taux_cab := CASE WHEN c.commission_cabinet_taux > 1 THEN c.commission_cabinet_taux / 100
                      ELSE c.commission_cabinet_taux END;
  ELSE
    SELECT tr.taux, tr.assiette INTO _taux_cab, _assiette_cab
      FROM public.trouver_taux_cabinet(c.compagnie_id, c.produit_id, _famille_id,
                                      COALESCE(c.date_effet, CURRENT_DATE)) tr;
  END IF;

  IF _taux_cab IS NOT NULL AND _cotisation IS NOT NULL THEN
    _estime := ROUND(_cotisation * _taux_cab, 2);

  ELSE
    _estime := NULL;
  END IF;

  IF _reel IS NULL AND _estime IS NULL THEN RETURN; END IF;

  IF c.date_effet IS NOT NULL THEN
    _ecoules := GREATEST(0, (EXTRACT(YEAR FROM age(CURRENT_DATE, c.date_effet)) * 12
                + EXTRACT(MONTH FROM age(CURRENT_DATE, c.date_effet)))::integer);
    _offset := GREATEST(0, (date_part('year', c.date_effet) - date_part('year', CURRENT_DATE)) * 12
               + (date_part('month', c.date_effet) - date_part('month', CURRENT_DATE)))::integer;
  ELSE
    _ecoules := 0;
  END IF;

  _restants := CASE WHEN c.duree_mois IS NULL THEN NULL
                    ELSE GREATEST(0, c.duree_mois - _ecoules) END;

  IF _dernier_mois IS NOT NULL THEN
    _offset := GREATEST(_offset,
      GREATEST(0, ((date_part('year', _dernier_mois) - date_part('year', CURRENT_DATE)) * 12
                  + (date_part('month', _dernier_mois) - date_part('month', CURRENT_DATE)) + 1))::integer);
  END IF;

  _echeances := CASE WHEN _restants IS NULL THEN CASE WHEN _periodicite = 'annuelle' THEN 1 ELSE 12 END
                     WHEN _periodicite = 'annuelle' THEN CEIL(_restants::numeric / 12)::integer
                     ELSE _restants END;

  SELECT * INTO _prev FROM public.commission_previsions
   WHERE contrat_id = _contrat_id
      OR (c.dossier_id IS NOT NULL AND dossier_id = c.dossier_id)
   ORDER BY (contrat_id = _contrat_id) DESC
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.commission_previsions
       SET contrat_id = _contrat_id,
           compagnie_id = COALESCE(compagnie_id, c.compagnie_id),
           branche = COALESCE(branche, _branche),
           periodicite = _periodicite,
           montant_mensuel_reel = COALESCE(_reel, montant_mensuel_reel),
           montant_mensuel_estime = COALESCE(_estime, montant_mensuel_estime),
           mois_restants_actuels = _echeances,
           mois_restants_initial = COALESCE(mois_restants_initial, _echeances),
           montant_previsionnel_total = CASE
             WHEN COALESCE(_reel, _estime) IS NOT NULL
               THEN ROUND(COALESCE(_reel, _estime) * GREATEST(_echeances, 0), 2)
             ELSE montant_previsionnel_total END,
           mois_debut_offset = _offset,
           updated_at = now()
     WHERE id = _prev.id;
  ELSE
    INSERT INTO public.commission_previsions
      (contrat_id, dossier_id, compagnie_id, branche, periodicite,
       montant_mensuel_reel, montant_mensuel_estime, mois_restants_actuels,
       mois_restants_initial, montant_previsionnel_total, mois_debut_offset,
       date_estimation, statut)
    VALUES
      (_contrat_id, c.dossier_id, c.compagnie_id, _branche, _periodicite,
       _reel, _estime, _echeances, _echeances,
       CASE WHEN COALESCE(_reel, _estime) IS NOT NULL
            THEN ROUND(COALESCE(_reel, _estime) * GREATEST(_echeances, 0), 2) END,
       _offset, CURRENT_DATE, 'estime');
  END IF;
END;
$function$;

