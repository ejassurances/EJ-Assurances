-- Abonnements de charges sans date de fin et frais de distribution ajustables par contrat.
ALTER TABLE public.factures_achat
  ADD COLUMN IF NOT EXISTS abonnement_sans_fin boolean NOT NULL DEFAULT false;

ALTER TABLE public.contrats
  ADD COLUMN IF NOT EXISTS frais_distribution_mode text NOT NULL DEFAULT 'automatique'
    CHECK (frais_distribution_mode IN ('automatique','offert','montant_fixe')),
  ADD COLUMN IF NOT EXISTS frais_distribution_montant numeric(14,2);

COMMENT ON COLUMN public.factures_achat.abonnement_sans_fin IS
  'Si vrai, le montant TTC est projeté chaque mois à partir du mois de la facture, sans date de fin.';
COMMENT ON COLUMN public.contrats.frais_distribution_mode IS
  'automatique: règle standard; offert: 0 EUR; montant_fixe: frais saisis manuellement.';
COMMENT ON COLUMN public.contrats.frais_distribution_montant IS
  'Montant personnalisé des frais de distribution lorsque le mode est montant_fixe.';

CREATE OR REPLACE FUNCTION public.recalculer_remuneration_contrat(p_contrat_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
 c public.contrats%ROWTYPE; b public.commission_bareme%ROWTYPE;
 v_branche text; frais numeric; eco numeric; ecart numeric; motif text;
 statut_frais text := 'calcule'; prime numeric; taux numeric; montant numeric;
 annee integer; nb integer := 1; com_motif text; produit_prioritaire boolean;
BEGIN
 SELECT * INTO c FROM public.contrats WHERE id = p_contrat_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF pg_trigger_depth() = 0 AND auth.uid() IS NOT NULL AND NOT (
   (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'mandataire'))
   AND public.can_access_client(c.client_id)) THEN RAISE EXCEPTION 'Accès refusé'; END IF;
 v_branche := public.branche_contrat(c.id);
 IF c.frais_distribution_mode = 'offert' THEN
  frais := 0; eco := NULL; motif := 'Frais de distribution offerts';
 ELSIF c.frais_distribution_mode = 'montant_fixe' THEN
  IF c.frais_distribution_montant IS NULL OR c.frais_distribution_montant < 0 THEN
   statut_frais := 'a_verifier'; motif := 'Montant personnalisé absent ou invalide';
  ELSE frais := round(c.frais_distribution_montant,2); eco := NULL; motif := 'Montant personnalisé'; END IF;
 ELSIF c.is_emprunteur OR v_branche = 'emprunteur' THEN
  eco := c.economie_realisee;
  ecart := c.economie_cout_groupe - c.economie_cout_delegue;
  IF c.duree_mois IS NULL OR c.duree_mois <= 0 OR
     c.economie_cout_groupe < 0 OR c.economie_cout_delegue < 0 OR eco < 0 OR
     (eco IS NOT NULL AND ecart IS NOT NULL AND abs(eco - ecart) > 1) OR
     (eco IS NULL AND (ecart IS NULL OR ecart < 0)) THEN
   statut_frais := 'a_verifier'; motif := 'Économie totale absente ou incohérente';
  ELSE eco := coalesce(eco, ecart); frais := round(eco * 0.05, 2); motif := '5 % des économies totales sur la durée du prêt'; END IF;
 ELSIF v_branche IN ('assurance_vie','vie','epargne') THEN frais := 0; motif := 'Assurance vie : 0 €';
 ELSE frais := 20; motif := '20 € par contrat'; END IF;
 INSERT INTO public.contrat_remuneration_previsionnelle(cle,contrat_id,type,annee,statut,base,montant,motif)
 VALUES(c.id || ':frais_distribution:1',c.id,'frais_distribution',1,statut_frais,eco,frais,motif)
 ON CONFLICT(cle) DO UPDATE SET statut=excluded.statut,base=excluded.base,montant=excluded.montant,motif=excluded.motif,calcule_le=now();

 SELECT EXISTS(SELECT 1 FROM public.commission_bareme r WHERE r.compagnie_id=c.compagnie_id
   AND r.branche=v_branche AND r.produit_id=c.produit_id AND r.mode IS NOT NULL
   AND r.date_effet <= c.date_effet AND (r.date_fin IS NULL OR r.date_fin >= c.date_effet)) INTO produit_prioritaire;
 SELECT count(*) INTO nb FROM public.commission_bareme r WHERE r.compagnie_id=c.compagnie_id AND r.branche=v_branche
   AND r.mode IS NOT NULL AND r.date_effet <= c.date_effet AND (r.date_fin IS NULL OR r.date_fin >= c.date_effet)
   AND (CASE WHEN produit_prioritaire THEN r.produit_id=c.produit_id ELSE r.produit_id IS NULL END);
 IF nb = 1 THEN
  SELECT * INTO b FROM public.commission_bareme r WHERE r.compagnie_id=c.compagnie_id AND r.branche=v_branche
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

CREATE OR REPLACE FUNCTION public.trg_remuneration_contrat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.recalculer_remuneration_contrat(NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS remuneration_contrat ON public.contrats;
CREATE TRIGGER remuneration_contrat AFTER INSERT OR UPDATE OF compagnie_id,produit_id,dossier_id,date_effet,
 prime_annuelle,prime_nette_annuelle,duree_mois,is_emprunteur,economie_realisee,economie_cout_groupe,economie_cout_delegue,
 frais_distribution_mode,frais_distribution_montant
 ON public.contrats FOR EACH ROW EXECUTE FUNCTION public.trg_remuneration_contrat();
