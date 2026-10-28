-- Archive durable des contenus d'e-mails liés au CRM.
-- La migration est versionnée dans Git ; elle n'est pas appliquée à la production par la PR.
ALTER TABLE public.crm_emails
  ADD COLUMN IF NOT EXISTS corps_texte text,
  ADD COLUMN IF NOT EXISTS corps_html text,
  ADD COLUMN IF NOT EXISTS destinataires text,
  ADD COLUMN IF NOT EXISTS copie_cc text,
  ADD COLUMN IF NOT EXISTS pieces_jointes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contenu_archive_le timestamptz;

CREATE INDEX IF NOT EXISTS crm_emails_archive_date_idx
  ON public.crm_emails (contenu_archive_le DESC)
  WHERE contenu_archive_le IS NOT NULL;
