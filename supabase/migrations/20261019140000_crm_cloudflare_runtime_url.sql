-- Keep scheduled CRM calls independent of the former Lovable hostname.
-- Configure `crm_public_base_url` in Supabase Vault with the CRM origin,
-- for example https://crm.ej-assurances.fr, before enabling scheduled jobs.

CREATE OR REPLACE FUNCTION public.invoke_crm_public_job(
  p_path text,
  p_body jsonb DEFAULT '{}'::jsonb,
  p_timeout_ms integer DEFAULT 30000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_token text;
  v_base_url text;
BEGIN
  SELECT decrypted_secret
    INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'crm_public_job_token'
  LIMIT 1;

  SELECT decrypted_secret
    INTO v_base_url
  FROM vault.decrypted_secrets
  WHERE name = 'crm_public_base_url'
  LIMIT 1;

  IF v_token IS NULL OR length(v_token) = 0 THEN
    RAISE EXCEPTION 'CRM public job token is not configured';
  END IF;
  IF v_base_url IS NULL OR length(trim(v_base_url)) = 0 THEN
    RAISE EXCEPTION 'CRM public base URL is not configured';
  END IF;
  IF trim(v_base_url) !~ '^https://[^/]+$' THEN
    RAISE EXCEPTION 'CRM public base URL must be an HTTPS origin without a path';
  END IF;
  IF p_path !~ '^/api/public/[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'CRM public job path is invalid';
  END IF;

  RETURN net.http_post(
    url := trim(trailing '/' FROM trim(v_base_url)) || p_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-relance-token', v_token
    ),
    body := COALESCE(p_body, '{}'::jsonb),
    timeout_milliseconds := p_timeout_ms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_crm_public_job(text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_crm_public_job(text, jsonb, integer) TO postgres;

-- Keep the vendor register aligned with the replacement stack. Unknown regions
-- are marked for confirmation rather than assumed.
UPDATE public.dora_systemes_tiers
SET fournisseur = 'Supabase'
WHERE nom = 'Base de données & authentification CRM'
  AND fournisseur = 'Lovable Cloud (Supabase)';

UPDATE public.dora_systemes_tiers
SET fournisseur = 'Google Gemini API'
WHERE nom = 'Analyse documentaire et triage IA'
  AND fournisseur = 'Google Gemini (Lovable AI)';

INSERT INTO public.dora_systemes_tiers (
  nom,
  fournisseur,
  categorie,
  criticite,
  donnees_traitees,
  localisation_donnees,
  plan_continuite
)
SELECT
  'Hébergement et exécution du CRM',
  'Cloudflare Workers',
  'hebergement',
  'critique',
  'Données CRM transitant par l’application',
  'À confirmer dans les conditions et paramètres du compte',
  'Configuration et procédure de reprise à documenter avant mise en production'
WHERE NOT EXISTS (
  SELECT 1 FROM public.dora_systemes_tiers
  WHERE nom = 'Hébergement et exécution du CRM'
);
