-- Prevent scheduled CRM calls from failing or sending messages while the
-- Cloudflare Worker endpoint or its Vault credentials are not configured.
-- The jobs are re-enabled after both secrets are present and the Worker is live.
DO $migration$
DECLARE
  v_job record;
  v_runtime_ready boolean;
BEGIN
  SELECT
    EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'crm_public_base_url'
        AND length(trim(decrypted_secret)) > 0
    )
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'crm_public_job_token'
        AND length(trim(decrypted_secret)) > 0
    )
  INTO v_runtime_ready;

  IF NOT v_runtime_ready THEN
    FOR v_job IN
      SELECT jobid
      FROM cron.job
      WHERE jobname IN (
        'rappels-expiration-documents',
        'relance-souscription-compagnie',
        'relance-pieces-j2',
        'envois-planifies',
        'relance-sinistres-3j',
        'suivi-contrats-periodique',
        'brevo-listes-sync',
        'revue-lcbft-quotidienne',
        'controle-interne-rappel-trimestre',
        'tri-emails-gmail',
        'reclamations-accuse-reception-j4'
      )
        AND active
      ORDER BY jobid
    LOOP
      PERFORM cron.alter_job(job_id := v_job.jobid, active := false);
    END LOOP;
  END IF;
END;
$migration$;
