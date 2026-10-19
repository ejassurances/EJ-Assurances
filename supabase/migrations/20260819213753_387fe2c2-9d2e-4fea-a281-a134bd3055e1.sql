DO $$
DECLARE
  _client uuid := '37f5cb05-21cc-4698-bf0a-6c71a4f78ede';
  _dossier uuid := '6f9aa70c-0ab9-47a3-a7cb-ddcb8a711391';
  _admin uuid := 'f6d18a82-4f54-46b0-8785-6db7d8c90313';
  _contrat uuid;
  _effet date := current_date;
BEGIN
  -- This backfill targets one historical client/dossier. Fresh environments have
  -- no corresponding source records, so skip it without bypassing KYC controls.
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client)
     OR NOT EXISTS (
       SELECT 1 FROM public.dossiers
       WHERE id = _dossier AND client_id = _client
     ) THEN
    RAISE NOTICE 'Skipping historical contract backfill: source client or dossier is absent.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.contrats WHERE dossier_id = _dossier) THEN
    RETURN;
  END IF;

  PERFORM set_config('app.bypass_pipeline_guard', 'on', true);

  INSERT INTO public.contrats (
    client_id, dossier_id, assureur, produit, compagnie_id, produit_id,
    date_effet, date_echeance, duree_mois, prime_annuelle, fractionnement,
    statut, is_emprunteur, created_by
  ) VALUES (
    _client, _dossier, 'April', 'E-Trotinette',
    '73a3f907-7ac2-466b-87cd-037bc24eda1d', '16122380-bf7a-417d-8683-9c860abd9e93',
    _effet, (_effet + interval '12 months' - interval '1 day')::date, 12,
    158.04, 'mensuel', 'actif', false, _admin
  ) RETURNING id INTO _contrat;

  UPDATE public.clients SET statut = 'actif' WHERE id = _client AND statut = 'prospect';

  UPDATE public.dossiers
     SET statut = 'contrat_actif', souscription_retour_le = now()
   WHERE id = _dossier;

  INSERT INTO public.dossier_etapes_historique (dossier_id, ancienne_etape, nouvelle_etape, commentaire, par)
  VALUES (_dossier, 'devis_en_cours', 'contrat_actif',
    'Confirmation d''adhésion reçue de la compagnie — contrat enregistré au portefeuille, documents DDA à faire signer.', _admin);

  INSERT INTO public.taches (client_id, titre, description, echeance, priorite, statut, assignee_id, created_by)
  VALUES (
    _client,
    'Régulariser le dossier DDA — contrat trottinette en place — D-20260812-872923',
    'Le contrat April « E-Trotinette » est confirmé et actif au portefeuille.' || chr(10) ||
    'Effet : ' || _effet || ' · Échéance : ' || (_effet + interval '12 months' - interval '1 day')::date || ' · Prime annuelle : 158,04 €' || chr(10) ||
    'À régulariser : lettre de mission à envoyer et faire signer ; devoir de conseil à envoyer et faire signer.' || chr(10) ||
    'Rappel ACPR : un contrat ne doit pas rester sans devoir de conseil signé.',
    current_date, 'urgente', 'a_faire', _admin, _admin
  );

  INSERT INTO public.activites (client_id, type, titre, contenu, created_by)
  VALUES (_client, 'systeme', 'Contrat créé au portefeuille (confirmation compagnie)',
    'Dossier D-20260812-872923' || chr(10) || 'April — E-Trotinette' || chr(10) ||
    'Effet ' || _effet || ' · fin ' || (_effet + interval '12 months' - interval '1 day')::date || chr(10) ||
    'Prime annuelle : 158,04 €' || chr(10) ||
    'Documents DDA à régulariser : lettre de mission et devoir de conseil à faire signer.', _admin);
END $$;