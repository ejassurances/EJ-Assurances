DROP TRIGGER IF EXISTS trg_contrats_echeances ON public.contrats;
CREATE TRIGGER trg_contrats_echeances
AFTER INSERT OR UPDATE OF date_effet, duree_mois, prime_annuelle, prime_nette_annuelle,
  capital_initial, taux_pret, taux_assurance_annuel, quotite, assiette,
  mode_commissionnement, commission_cabinet_taux, mandataire_id, prescripteur_id,
  compagnie_id, produit_id, is_emprunteur, fractionnement
ON public.contrats
FOR EACH ROW EXECUTE FUNCTION public.trg_recalculer_echeances();