-- The IONOS mailbox uses IMAP, which has folders and flags but no equivalent
-- to Gmail's multi-label metadata. Keep CRM routing labels in a separate table.
CREATE TABLE public.crm_email_labels (
  message_id text NOT NULL CHECK (message_id LIKE 'ionos:%' OR message_id LIKE 'ionosuid:%'),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, label)
);

CREATE INDEX crm_email_labels_label_created_idx
  ON public.crm_email_labels (label, created_at DESC);

ALTER TABLE public.crm_email_labels ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_email_labels TO authenticated;
GRANT ALL ON public.crm_email_labels TO service_role;

CREATE POLICY "Staff gere les etiquettes email CRM"
  ON public.crm_email_labels
  FOR ALL
  TO authenticated
  USING (public.current_user_role() IN ('admin', 'mandataire'))
  WITH CHECK (public.current_user_role() IN ('admin', 'mandataire'));

COMMENT ON TABLE public.crm_email_labels IS
  'Étiquettes métier des e-mails IONOS, persistées dans le CRM car IMAP ne propose pas les libellés Gmail.';
