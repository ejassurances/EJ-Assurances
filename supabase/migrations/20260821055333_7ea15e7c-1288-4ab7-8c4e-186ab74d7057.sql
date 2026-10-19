DO $migration$
BEGIN
  -- These quote rows belong to historical dossiers. Keep them only when all
  -- referenced source records exist; a fresh CRM must not invent those records.
  IF EXISTS (SELECT 1 FROM public.dossiers WHERE id = 'ad805ebb-417e-4cdd-86b6-23ba142073e8')
     AND EXISTS (SELECT 1 FROM public.compagnies WHERE id = '31ed78c4-4cb9-4304-81db-fe51c8f0f397')
     AND EXISTS (SELECT 1 FROM public.produits WHERE id = '4eb01d51-5da2-4da9-9cd1-e449deecef47') THEN
    INSERT INTO public.dossier_devis (dossier_id, compagnie_id, produit_id, source, cotisation_mensuelle, cotisation_max, montant_total_saisi, type_cotisation, quotite_pct, assureur_porteur, garanties_resume, saisi_par)
    VALUES
    ('ad805ebb-417e-4cdd-86b6-23ba142073e8','31ed78c4-4cb9-4304-81db-fe51c8f0f397','4eb01d51-5da2-4da9-9cd1-e449deecef47','manuel',8.09,8.74,1487.64,'CRD',100,'CARDIF','Décès, PTIA, ITT/IPT/IPP (franchise 90 jours) + options Sérénité + Dos et Sérénité + Psy. Cotisations variables sur capital restant dû — prêt Crédit Mutuel Bussy St Georges, 184 mois à 1,10 %. Total 1 487,64 € TTC sur la durée (convention 2828/737, adhésion 56528882, via SimulAssur).','f6d18a82-4f54-46b0-8785-6db7d8c90313');
  ELSE
    RAISE NOTICE 'Skipping historical quote: source dossier, company, or product is absent.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.dossiers WHERE id = '3a520416-b6d3-4d99-892c-60aadc2d8492')
     AND EXISTS (SELECT 1 FROM public.compagnies WHERE id = '31ed78c4-4cb9-4304-81db-fe51c8f0f397')
     AND EXISTS (SELECT 1 FROM public.produits WHERE id = '7ac73033-ad4e-42dd-93b4-a97d11e1fd9a') THEN
    INSERT INTO public.dossier_devis (dossier_id, compagnie_id, produit_id, source, cotisation_mensuelle, cotisation_max, montant_total_saisi, type_cotisation, quotite_pct, assureur_porteur, garanties_resume, saisi_par)
    VALUES
    ('3a520416-b6d3-4d99-892c-60aadc2d8492','31ed78c4-4cb9-4304-81db-fe51c8f0f397','7ac73033-ad4e-42dd-93b4-a97d11e1fd9a','manuel',23.71,23.71,7041.87,'CI',100,'CARDIF','Décès, PTIA, ITT/IPT/IPP (franchise 90 jours) + options Sérénité + Dos, Sérénité + Psy et extension PTIA-IT à 70 ans. Cotisations fixes sur capital initial — prêt BRED Banque Populaire, 297 mois. Total 7 041,87 € TTC sur la durée (convention 2827/736, adhésion 56085462, via SimulAssur).','f6d18a82-4f54-46b0-8785-6db7d8c90313');
  ELSE
    RAISE NOTICE 'Skipping historical quote: source dossier, company, or product is absent.';
  END IF;
END
$migration$;
