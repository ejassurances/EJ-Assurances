-- Rapprochement déterministe des identités pour l'écriture atomique.
ALTER TABLE public.dossiers DROP CONSTRAINT IF EXISTS dossiers_type_assurance_check;
ALTER TABLE public.dossiers ADD CONSTRAINT dossiers_type_assurance_check
  CHECK (type_assurance = ANY (ARRAY[
    'emprunteur', 'sante', 'prevoyance', 'prevoyance_sante',
    'epargne_retraite', 'iard', 'trottinette', 'accidents_vie',
    'juridique', 'animaux', 'expatrie'
  ]));

CREATE OR REPLACE FUNCTION public.normaliser_identite_creation_rapide(p_valeur text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(regexp_replace(
    translate(
      replace(replace(lower(coalesce(p_valeur, '')), 'œ', 'oe'), 'æ', 'ae'),
      'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ',
      'aaaaaaceeeeiiiinooooouuuuyy'
    ),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

CREATE OR REPLACE FUNCTION public.creer_client_dossier_rapide(
  p_client jsonb,
  p_dossier jsonb,
  p_piece_rows jsonb,
  p_user_id uuid,
  p_confirmed_client_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
  v_dossier_id uuid;
  v_dossier_reference text;
  v_match_id uuid;
  v_match_via text;
  v_client_created boolean := false;
  v_client public.clients%ROWTYPE;
  v_email text;
  v_mobile text;
  v_telephone text;
  v_nom text;
  v_phone_key text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur de création manquant';
  END IF;
  IF nullif(trim(coalesce(p_client->>'nom', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom du client est obligatoire';
  END IF;
  IF nullif(trim(coalesce(p_dossier->>'intitule', '')), '') IS NULL THEN
    RAISE EXCEPTION 'L’intitulé du dossier est obligatoire';
  END IF;
  IF coalesce(p_dossier->>'type_assurance', '') NOT IN (
    'emprunteur', 'sante', 'prevoyance', 'prevoyance_sante',
    'epargne_retraite', 'iard', 'trottinette', 'accidents_vie',
    'juridique', 'animaux', 'expatrie'
  ) THEN
    RAISE EXCEPTION 'Type d’assurance non reconnu';
  END IF;

  v_email := nullif(lower(trim(coalesce(p_client->>'email', ''))), '');
  v_mobile := nullif(right(regexp_replace(coalesce(p_client->>'mobile', ''), '[^0-9]', '', 'g'), 9), '');
  v_telephone := nullif(right(regexp_replace(coalesce(p_client->>'telephone', ''), '[^0-9]', '', 'g'), 9), '');
  v_nom := public.normaliser_identite_creation_rapide(p_client->>'nom');

  -- Sérialise les demandes partageant une clé d'identité. Cela ferme la petite
  -- fenêtre de course entre deux formulaires créés simultanément.
  IF v_email IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('email:' || v_email));
  END IF;
  FOR v_phone_key IN
    SELECT DISTINCT cle FROM unnest(ARRAY[v_mobile, v_telephone]) AS telephones(cle)
    WHERE cle IS NOT NULL ORDER BY cle
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('telephone:' || v_phone_key));
  END LOOP;
  IF v_nom <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('nom:' || v_nom));
  END IF;

  -- Vérification dans la même transaction que les insertions : un candidat
  -- apparu après la recherche côté serveur doit encore être confirmé.
  WITH identite AS (
    SELECT
      nullif(lower(trim(p_client->>'email')), '') AS email,
      nullif(right(regexp_replace(coalesce(p_client->>'mobile', ''), '[^0-9]', '', 'g'), 9), '') AS mobile,
      nullif(right(regexp_replace(coalesce(p_client->>'telephone', ''), '[^0-9]', '', 'g'), 9), '') AS telephone,
      public.normaliser_identite_creation_rapide(p_client->>'nom') AS nom,
      public.normaliser_identite_creation_rapide(p_client->>'prenom') AS prenom,
      nullif(p_client->>'date_naissance', '')::date AS date_naissance
  ), correspondances AS (
    SELECT c.id, 'email'::text AS via, 1 AS priorite
    FROM public.clients c, identite i
    WHERE i.email IS NOT NULL AND lower(trim(coalesce(c.email, ''))) = i.email

    UNION ALL

    SELECT c.id, 'telephone'::text, 2
    FROM public.clients c, identite i
    WHERE (i.mobile IS NOT NULL OR i.telephone IS NOT NULL)
      AND (
        (i.mobile IS NOT NULL AND (
          right(regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g'), 9) = i.mobile OR
          right(regexp_replace(coalesce(c.mobile2, ''), '[^0-9]', '', 'g'), 9) = i.mobile OR
          right(regexp_replace(coalesce(c.telephone, ''), '[^0-9]', '', 'g'), 9) = i.mobile OR
          right(regexp_replace(coalesce(c.telephone2, ''), '[^0-9]', '', 'g'), 9) = i.mobile
        )) OR
        (i.telephone IS NOT NULL AND (
          right(regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g'), 9) = i.telephone OR
          right(regexp_replace(coalesce(c.mobile2, ''), '[^0-9]', '', 'g'), 9) = i.telephone OR
          right(regexp_replace(coalesce(c.telephone, ''), '[^0-9]', '', 'g'), 9) = i.telephone OR
          right(regexp_replace(coalesce(c.telephone2, ''), '[^0-9]', '', 'g'), 9) = i.telephone
        ))
      )

    UNION ALL

    SELECT c.id, 'nom_prenom_date_naissance'::text, 3
    FROM public.clients c, identite i
    WHERE i.date_naissance IS NOT NULL AND i.prenom <> ''
      AND c.date_naissance = i.date_naissance
      AND public.normaliser_identite_creation_rapide(c.nom) = i.nom
      AND public.normaliser_identite_creation_rapide(c.prenom) = i.prenom

  )
  SELECT id, via INTO v_match_id, v_match_via
  FROM correspondances
  ORDER BY priorite, id
  LIMIT 1;

  IF v_match_id IS NOT NULL AND v_match_id IS DISTINCT FROM p_confirmed_client_id THEN
    SELECT * INTO v_client FROM public.clients c WHERE c.id = v_match_id;
    RETURN jsonb_build_object(
      'status', 'duplicate_required',
      'candidate', jsonb_build_object(
        'client_id', v_client.id,
        'nom', v_client.nom,
        'prenom', v_client.prenom,
        'email', v_client.email,
        'mobile', v_client.mobile,
        'telephone', v_client.telephone,
        'date_naissance', v_client.date_naissance,
        'via', v_match_via
      )
    );
  END IF;

  IF p_confirmed_client_id IS NOT NULL THEN
    IF v_match_id IS NULL THEN
      RETURN jsonb_build_object('status', 'invalid_confirmation');
    END IF;
    v_client_id := p_confirmed_client_id;
    SELECT * INTO v_client FROM public.clients WHERE id = v_client_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La fiche client confirmée n’existe plus';
    END IF;
  ELSE
    INSERT INTO public.clients (
      civilite, prenom, nom, date_naissance, email, mobile, telephone,
      adresse, code_postal, ville, statut, marque, commercial_id, created_by
    ) VALUES (
      nullif(trim(coalesce(p_client->>'civilite', '')), ''),
      nullif(trim(coalesce(p_client->>'prenom', '')), ''),
      trim(p_client->>'nom'),
      nullif(p_client->>'date_naissance', '')::date,
      nullif(lower(trim(coalesce(p_client->>'email', ''))), ''),
      nullif(trim(coalesce(p_client->>'mobile', '')), ''),
      nullif(trim(coalesce(p_client->>'telephone', '')), ''),
      nullif(trim(coalesce(p_client->>'adresse', '')), ''),
      nullif(trim(coalesce(p_client->>'code_postal', '')), ''),
      nullif(trim(coalesce(p_client->>'ville', '')), ''),
      'prospect',
      coalesce(nullif(p_client->>'marque', ''), 'ej_assurances'),
      nullif(p_client->>'commercial_id', '')::uuid,
      p_user_id
    ) RETURNING * INTO v_client;
    v_client_id := v_client.id;
    v_client_created := true;
  END IF;

  INSERT INTO public.dossiers (
    client_id, client_nom, client_email, client_phone, type_assurance,
    statut, projet_type, projet_contexte, notes, apporteur_id, created_by
  ) VALUES (
    v_client_id,
    trim(concat_ws(' ', nullif(v_client.prenom, ''), v_client.nom)),
    v_client.email,
    coalesce(v_client.mobile, v_client.telephone),
    p_dossier->>'type_assurance',
    'nouveau',
    trim(p_dossier->>'projet_type'),
    nullif(trim(coalesce(p_dossier->>'projet_contexte', '')), ''),
    nullif(trim(coalesce(p_dossier->>'notes', '')), ''),
    p_user_id,
    p_user_id
  ) RETURNING id, reference INTO v_dossier_id, v_dossier_reference;

  INSERT INTO public.dossier_pieces_requises (
    dossier_id, client_id, code, libelle, categorie, obligatoire, statut
  )
  SELECT
    v_dossier_id,
    v_client_id,
    piece.code,
    piece.libelle,
    piece.categorie,
    piece.obligatoire,
    'manquante'
  FROM jsonb_to_recordset(coalesce(p_piece_rows, '[]'::jsonb)) AS piece(
    code text, libelle text, categorie text, obligatoire boolean
  );

  RETURN jsonb_build_object(
    'status', 'created',
    'client_id', v_client_id,
    'dossier_id', v_dossier_id,
    'dossier_reference', v_dossier_reference,
    'client_created', v_client_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normaliser_identite_creation_rapide(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normaliser_identite_creation_rapide(text) TO service_role;
REVOKE ALL ON FUNCTION public.creer_client_dossier_rapide(jsonb, jsonb, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creer_client_dossier_rapide(jsonb, jsonb, jsonb, uuid, uuid) TO service_role;
