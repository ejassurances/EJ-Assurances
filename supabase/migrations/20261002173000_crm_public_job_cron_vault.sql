-- Version the production cron-to-CRM authentication wrapper.
-- The actual token remains in Supabase Vault and is intentionally not stored
-- in source control.

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
BEGIN
  SELECT decrypted_secret
    INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'crm_public_job_token'
  LIMIT 1;

  IF v_token IS NULL OR length(v_token) = 0 THEN
    RAISE EXCEPTION 'CRM public job token is not configured';
  END IF;

  RETURN net.http_post(
    url := 'https://assurance-zenith-guide.lovable.app' || p_path,
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

SELECT cron.alter_job(job_id:=2, command:='SELECT public.invoke_crm_public_job(''/api/public/rappels-expiration'');');
SELECT cron.alter_job(job_id:=3, command:='SELECT public.invoke_crm_public_job(''/api/public/relance-souscription'');');
SELECT cron.alter_job(job_id:=4, command:='SELECT public.invoke_crm_public_job(''/api/public/relance-pieces'');');
SELECT cron.alter_job(job_id:=5, command:='SELECT public.invoke_crm_public_job(''/api/public/envois-planifies'');');
SELECT cron.alter_job(job_id:=6, command:='SELECT public.invoke_crm_public_job(''/api/public/devoirs-conseil-envois'');');
SELECT cron.alter_job(job_id:=8, command:='SELECT public.invoke_crm_public_job(''/api/public/relance-sinistres'');');
SELECT cron.alter_job(job_id:=9, command:='SELECT public.invoke_crm_public_job(''/api/public/suivi-contrats'');');
SELECT cron.alter_job(job_id:=10, command:='SELECT public.invoke_crm_public_job(''/api/public/brevo-listes-sync'');');
SELECT cron.alter_job(job_id:=11, command:='SELECT public.invoke_crm_public_job(''/api/public/revue-lcbft'');');
SELECT cron.alter_job(job_id:=12, command:='SELECT public.invoke_crm_public_job(''/api/public/controle-interne-rappel'');');
SELECT cron.alter_job(job_id:=14, command:='SELECT public.invoke_crm_public_job(''/api/public/scan-emails'',jsonb_build_object(''limite'',15,''maxResults'',40),120000);');
SELECT cron.alter_job(job_id:=15, command:='SELECT public.invoke_crm_public_job(''/api/public/cartographie-risques-revision'');');
SELECT cron.alter_job(job_id:=16, command:='SELECT public.invoke_crm_public_job(''/api/public/formations-rappels'');');
SELECT cron.alter_job(job_id:=17, command:='SELECT public.invoke_crm_public_job(''/api/public/reclamations-accuse-reception'');');
SELECT cron.alter_job(job_id:=21, command:='SELECT public.invoke_crm_public_job(''/api/public/dossiers-bloques'');');
SELECT cron.alter_job(job_id:=22, command:='SELECT public.invoke_crm_public_job(''/api/public/lettres-mission-envois'');');
SELECT cron.alter_job(job_id:=23, command:='SELECT public.invoke_crm_public_job(''/api/public/gmail-inbox'',jsonb_build_object(''limite'',15,''maxResults'',40),120000);');