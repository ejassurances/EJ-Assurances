DO $migration$
BEGIN
  -- These are historical backfills. Apply them only when their source records
  -- exist in this environment; never invent products or dossiers to satisfy FKs.
  IF EXISTS (
    SELECT 1 FROM public.produits
    WHERE id = '907b19f5-2e51-47a9-af3c-fe0d35ff1fda'
  ) THEN
    INSERT INTO public.produit_garanties (produit_id, famille_code, grille_version, valeurs, statut, valide_par, valide_le, created_by, notes)
    VALUES (
      '907b19f5-2e51-47a9-af3c-fe0d35ff1fda',
      'emprunteur',
      2,
      jsonb_build_object(
        'deces', jsonb_build_object('couverture','oui','conditions','Remboursement au prêteur du capital assuré ; cesse au renouvellement suivant le 90e anniversaire.'),
        'ptia', jsonb_build_object('couverture','oui','conditions','Cesse au renouvellement suivant le 65e anniversaire (70e si activité professionnelle poursuivie).'),
        'itt', jsonb_build_object('couverture','oui','franchise','90 jours (franchise maximale contractuelle 180 jours)','plafond','10 000 € / mois / assuré — 5 000 € en temps partiel thérapeutique','conditions','Inaptitude à exercer strictement l''activité professionnelle ; prestation forfaitaire 100 % de l''échéance pondérée par la quotité.'),
        'ipt', jsonb_build_object('couverture','oui','conditions','Taux d''invalidité supérieur à 66 % ; cesse au renouvellement suivant le 65e anniversaire (70e si activité poursuivie).'),
        'ipp', jsonb_build_object('couverture','oui','conditions','Invalidité permanente partielle couverte, quotité 75 %.'),
        'mno', jsonb_build_object('couverture','oui','conditions','Affections dorsales et psychiatriques couvertes sans condition d''hospitalisation ni d''intervention chirurgicale.'),
        'perte_emploi', jsonb_build_object('couverture','non','conditions','Garantie non souscrite (option disponible au contrat : forfaitaire 50 % de l''échéance, plafonds 5 000 € / 2 500 €).'),
        'type_indemnisation', jsonb_build_object('couverture','oui','conditions','Forfaitaire : 100 % de l''échéance de remboursement pondérée par la quotité assurée.'),
        'franchise_itt', jsonb_build_object('couverture','oui','franchise','90 jours'),
        'delai_carence', jsonb_build_object('couverture','oui','delai_carence','Aucun délai de carence spécifique mentionné à la fiche standardisée'),
        'duree_indemnisation', jsonb_build_object('couverture','oui','conditions','Jusqu''au terme du prêt, dans la limite de la cessation des garanties (65 / 70 ans, retraite).'),
        'seuil_ipp', jsonb_build_object('couverture','oui','conditions','IPT : taux d''invalidité supérieur à 66 %.'),
        'temps_partiel_therapeutique', jsonb_build_object('couverture','oui','plafond','5 000 € / mois','conditions','Prise en charge en cas de reprise à temps partiel thérapeutique.'),
        'prise_en_charge_prorata', jsonb_build_object('couverture','oui','conditions','Prestations proportionnelles au pourcentage du capital emprunté assuré (quotité).'),
        'quotites', jsonb_build_object('couverture','oui','conditions','Quotité retenue : 75 % par assuré.'),
        'capital_max', jsonb_build_object('couverture','inconnu','conditions','Non précisé à la fiche standardisée ; se référer aux conditions générales.'),
        'ages_limites', jsonb_build_object('couverture','oui','conditions','Décès jusqu''au 90e anniversaire ; PTIA / ITT / IPT jusqu''au 65e (70e si activité poursuivie).'),
        'duree_max_pret', jsonb_build_object('couverture','oui','conditions','Prêt couvert de 167 mois conforme au contrat.'),
        'base_calcul_cotisation', jsonb_build_object('couverture','oui','conditions','Cotisations variables assises sur le capital restant dû (cotisation non constante : 1,16 € minimum à 70,10 € maximum par mois).'),
        'equivalence_ccsf', jsonb_build_object('couverture','oui','conditions','Contrat présenté au prêteur au titre de l''équivalence de garanties (grille CCSF), Loi Lemoine.'),
        'formalites_medicales', jsonb_build_object('couverture','oui','conditions','Questionnaire de santé selon capital et âge ; dispense possible au titre de la Loi Lemoine.'),
        'professions_a_risque', jsonb_build_object('couverture','inconnu','conditions','Surprime ou exclusion possible selon profession — se référer aux conditions générales.'),
        'sports_loisirs', jsonb_build_object('couverture','inconnu','conditions','Sports à risque : voir conditions générales.'),
        'deplacements_etranger', jsonb_build_object('couverture','inconnu','conditions','Voir conditions générales.'),
        'exclusions', jsonb_build_object('couverture','oui','conditions','Risques exclus, délais de carence et de franchise détaillés à la notice d''information CARDIF LIBERTES EMPRUNTEUR n° 2828/737.'),
        'delai_renonciation_resiliation', jsonb_build_object('couverture','oui','conditions','Résiliation à tout moment (art. L.113-12-2 du Code des assurances), Loi Lemoine.')
      ),
      'valide',
      'f6d18a82-4f54-46b0-8785-6db7d8c90313',
      now(),
      'f6d18a82-4f54-46b0-8785-6db7d8c90313',
      'Grille renseignée d''après la fiche standardisée d''information CARDIF LIBERTES EMPRUNTEUR cotisations variables n° 2828/737 (dossier GUILLOUF / BRIDOUX).'
    )
    ON CONFLICT (produit_id) DO UPDATE SET
      famille_code = EXCLUDED.famille_code,
      grille_version = EXCLUDED.grille_version,
      valeurs = EXCLUDED.valeurs,
      statut = 'valide',
      valide_par = EXCLUDED.valide_par,
      valide_le = now(),
      notes = EXCLUDED.notes;
  ELSE
    RAISE NOTICE 'Skipping historical product guarantees: source product is absent.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.dossiers
    WHERE id = '3992eafd-eff8-480e-84da-e495259a078b'
  )
  AND EXISTS (
    SELECT 1 FROM public.compagnies
    WHERE id = 'e5582254-4f96-4710-ba56-ee5e8a9e22a0'
  )
  AND EXISTS (
    SELECT 1 FROM public.produits
    WHERE id = '907b19f5-2e51-47a9-af3c-fe0d35ff1fda'
  ) THEN
    INSERT INTO public.dossier_devis (dossier_id, compagnie_id, produit_id, source, type_cotisation, cotisation_min, cotisation_max, montant_total_saisi, quotite_pct, assureur_porteur, garanties_resume, saisi_par)
    SELECT '3992eafd-eff8-480e-84da-e495259a078b', 'e5582254-4f96-4710-ba56-ee5e8a9e22a0', '907b19f5-2e51-47a9-af3c-fe0d35ff1fda', 'manuel', 'CRD', 1.16, 70.10, 5617.32, 75,
      'CARDIF ASSURANCE VIE',
      'CARDIF LIBERTES EMPRUNTEUR cotisations variables n° 2828/737 — Décès, PTIA, ITT, IPT, IPP à 75 %, franchise 90 jours, dos et psy sans condition d''hospitalisation. Coût sur 8 ans : 5 617,32 €.',
      'f6d18a82-4f54-46b0-8785-6db7d8c90313'
    WHERE NOT EXISTS (SELECT 1 FROM public.dossier_devis WHERE dossier_id = '3992eafd-eff8-480e-84da-e495259a078b');
  ELSE
    RAISE NOTICE 'Skipping historical dossier quote: source dossier, company, or product is absent.';
  END IF;
END
$migration$;
