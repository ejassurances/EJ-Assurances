CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = _role
      AND (
        _user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.user_roles admin_role
          WHERE admin_role.user_id = auth.uid()
            AND admin_role.role = 'admin'::public.app_role
        )
      )
  );
$function$;

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
  WHERE c.statut IN ('actif', 'client')
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.can_access_client(c.id)
    );
END;
$function$;
