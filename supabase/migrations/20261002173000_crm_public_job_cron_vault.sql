-- Version the production cron-to-CRM authentication wrapper.
-- Runtime URL and token stay in Supabase Vault; no Lovable endpoint is retained.

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

-- Resolve jobs by their stable names, not project-specific numeric IDs.
-- Missing jobs are intentionally left absent in the Recette environment.
-- The legacy "gmail" job uses the IONOS adapter through gmail.server.ts.
-- The manual-only gmail-inbox endpoint is intentionally not scheduled.
DO $migration$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT j.jobid, mapping.command
    FROM cron.job AS j
    JOIN (
      VALUES
        ('rappels-expiration-documents'::text, $command$SELECT public.invoke_crm_public_job('/api/public/rappels-expiration');$command$::text),
        ('relance-souscription-compagnie'::text, $command$SELECT public.invoke_crm_public_job('/api/public/relance-souscription');$command$::text),
        ('relance-pieces-j2'::text, $command$SELECT public.invoke_crm_public_job('/api/public/relance-pieces');$command$::text),
        ('envois-planifies'::text, $command$SELECT public.invoke_crm_public_job('/api/public/envois-planifies');$command$::text),
        ('relance-sinistres-3j'::text, $command$SELECT public.invoke_crm_public_job('/api/public/relance-sinistres');$command$::text),
        ('suivi-contrats-periodique'::text, $command$SELECT public.invoke_crm_public_job('/api/public/suivi-contrats');$command$::text),
        ('brevo-listes-sync'::text, $command$SELECT public.invoke_crm_public_job('/api/public/brevo-listes-sync');$command$::text),
        ('revue-lcbft-quotidienne'::text, $command$SELECT public.invoke_crm_public_job('/api/public/revue-lcbft');$command$::text),
        ('controle-interne-rappel-trimestre'::text, $command$SELECT public.invoke_crm_public_job('/api/public/controle-interne-rappel');$command$::text),
        ('tri-emails-gmail'::text, $command$SELECT public.invoke_crm_public_job('/api/public/scan-emails', '{"limite":15,"maxResults":40}'::jsonb, 120000);$command$::text),
        ('reclamations-accuse-reception-j4'::text, $command$SELECT public.invoke_crm_public_job('/api/public/reclamations-accuse-reception');$command$::text)
    ) AS mapping(jobname, command)
      ON mapping.jobname = j.jobname
    ORDER BY j.jobid
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job.jobid,
      command := v_job.command
    );
  END LOOP;
END;
$migration$;
