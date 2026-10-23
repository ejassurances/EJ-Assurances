-- Protects manual client creation against accidental duplicates.
-- Matching is serialized and checked in the same transaction as the insert.
CREATE OR REPLACE FUNCTION public.creer_client_manuel_securise(
  p_client jsonb,
  p_user_id uuid,
  p_confirmed_duplicate_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_match_id uuid;
  v_match_via text;
  v_client public.clients%ROWTYPE;
  v_email text;
  v_nom text;
  v_prenom text;
  v_mobile text;
  v_name_key text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur de création manquant';
  END IF;
  IF nullif(trim(coalesce(p_client->>'nom', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom du client est obligatoire';
  END IF;

  v_email := nullif(lower(trim(coalesce(p_client->>'email', ''))), '');
  v_mobile := nullif(right(regexp_replace(coalesce(p_client->>'mobile', ''), '[^0-9]', '', 'g'), 9), '');
  v_nom := public.normaliser_identite_creation_rapide(p_client->>'nom');
  v_prenom := public.normaliser_identite_creation_rapide(p_client->>'prenom');

  -- Lock all supplied identity keys in a stable order to prevent two manual
  -- submissions from passing the duplicate check at the same time.
  IF v_email IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('email:' || v_email));
  END IF;
  IF v_mobile IS NOT NULL AND length(v_mobile) >= 6 THEN
    PERFORM pg_advisory_xact_lock(hashtext('telephone:' || v_mobile));
  END IF;
  IF v_nom <> '' AND v_prenom <> '' THEN
    v_name_key := least(v_nom, v_prenom) || '|' || greatest(v_nom, v_prenom);
    PERFORM pg_advisory_xact_lock(hashtext('nom:' || v_name_key));
  END IF;

  WITH identite AS (
    SELECT
      v_email AS email,
      CASE WHEN length(v_mobile) >= 6 THEN v_mobile ELSE NULL END AS mobile,
      v_nom AS nom,
      v_prenom AS prenom
  ), correspondances AS (
    SELECT c.id, 'email'::text AS via, 1 AS priorite
    FROM public.clients c, identite i
    WHERE i.email IS NOT NULL
      AND lower(trim(coalesce(c.email, ''))) = i.email

    UNION ALL

    SELECT c.id, 'telephone'::text, 2
    FROM public.clients c, identite i
    WHERE i.mobile IS NOT NULL
      AND i.mobile IN (
        right(regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g'), 9),
        right(regexp_replace(coalesce(c.mobile2, ''), '[^0-9]', '', 'g'), 9),
        right(regexp_replace(coalesce(c.telephone, ''), '[^0-9]', '', 'g'), 9),
        right(regexp_replace(coalesce(c.telephone2, ''), '[^0-9]', '', 'g'), 9)
      )

    UNION ALL

    SELECT c.id, 'nom_prenom'::text, 3
    FROM public.clients c, identite i
    WHERE i.nom <> '' AND i.prenom <> ''
      AND (
        (
          public.normaliser_identite_creation_rapide(c.nom) = i.nom
          AND public.normaliser_identite_creation_rapide(c.prenom) = i.prenom
        ) OR (
          public.normaliser_identite_creation_rapide(c.nom) = i.prenom
          AND public.normaliser_identite_creation_rapide(c.prenom) = i.nom
        )
      )
  )
  SELECT id, via INTO v_match_id, v_match_via
  FROM correspondances
  ORDER BY priorite, id
  LIMIT 1;

  IF v_match_id IS NOT NULL AND v_match_id IS DISTINCT FROM p_confirmed_duplicate_id THEN
    SELECT * INTO v_client FROM public.clients c WHERE c.id = v_match_id;
    RETURN jsonb_build_object(
      'status', 'duplicate_required',
      'candidate', jsonb_build_object(
        'client_id', v_client.id,
        'reference', v_client.reference,
        'nom', v_client.nom,
        'prenom', v_client.prenom,
        'email', v_client.email,
        'mobile', v_client.mobile,
        'telephone', v_client.telephone,
        'via', v_match_via
      )
    );
  END IF;

  IF p_confirmed_duplicate_id IS NOT NULL THEN
    IF v_match_id IS NULL THEN
      RETURN jsonb_build_object('status', 'invalid_confirmation');
    END IF;
    -- The user explicitly chose to create a separate record after reviewing
    -- the current match. A changed candidate is shown again for confirmation.
    IF v_match_id IS DISTINCT FROM p_confirmed_duplicate_id THEN
      SELECT * INTO v_client FROM public.clients c WHERE c.id = v_match_id;
      RETURN jsonb_build_object(
        'status', 'duplicate_required',
        'candidate', jsonb_build_object(
          'client_id', v_client.id,
          'reference', v_client.reference,
          'nom', v_client.nom,
          'prenom', v_client.prenom,
          'email', v_client.email,
          'mobile', v_client.mobile,
          'telephone', v_client.telephone,
          'via', v_match_via
        )
      );
    END IF;
  END IF;

  INSERT INTO public.clients (
    civilite, prenom, nom, email, mobile, ville, origine, client_origine_id,
    marque, created_by, commercial_id
  ) VALUES (
    nullif(trim(coalesce(p_client->>'civilite', '')), ''),
    nullif(trim(coalesce(p_client->>'prenom', '')), ''),
    trim(p_client->>'nom'),
    v_email,
    nullif(trim(coalesce(p_client->>'mobile', '')), ''),
    nullif(trim(coalesce(p_client->>'ville', '')), ''),
    p_client->>'origine',
    CASE
      WHEN p_client->>'origine' IN ('parrainage', 'recommandation')
        THEN nullif(p_client->>'client_origine_id', '')::uuid
      ELSE NULL
    END,
    coalesce(nullif(p_client->>'marque', ''), 'ej_assurances'),
    p_user_id,
    nullif(p_client->>'commercial_id', '')::uuid
  ) RETURNING * INTO v_client;

  RETURN jsonb_build_object('status', 'created', 'id', v_client.id);
END;
$$;

REVOKE ALL ON FUNCTION public.creer_client_manuel_securise(jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creer_client_manuel_securise(jsonb, uuid, uuid) TO service_role;
