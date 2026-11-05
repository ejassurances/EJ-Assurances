CREATE OR REPLACE FUNCTION public.score_conformite_cabinet()
RETURNS TABLE(
  score numeric,
  niveau text,
  nb_clients integer,
  nb_vert integer,
  nb_orange integer,
  nb_rouge integer,
  nb_a_relancer integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'mandataire'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  RETURN QUERY
  SELECT
    ROUND(COALESCE(AVG(c.conformite_score), 0), 1) AS score,
    CASE
      WHEN COALESCE(AVG(c.conformite_score), 0) >= 80 THEN 'vert'
      WHEN COALESCE(AVG(c.conformite_score), 0) >= 50 THEN 'orange'
      ELSE 'rouge'
    END AS niveau,
    COUNT(*)::int AS nb_clients,
    COUNT(*) FILTER (WHERE c.conformite_niveau = 'vert')::int,
    COUNT(*) FILTER (WHERE c.conformite_niveau = 'orange')::int,
    COUNT(*) FILTER (WHERE c.conformite_niveau = 'rouge')::int,
    COUNT(*) FILTER (
      WHERE c.conformite_prochaine_verif IS NOT NULL
        AND c.conformite_prochaine_verif <= CURRENT_DATE + INTERVAL '30 days'
    )::int
  FROM public.clients c
  WHERE c.statut = 'actif'::public.client_statut
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.can_access_client(c.id)
    );
END;
$function$;
