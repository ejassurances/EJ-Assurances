-- Protection contre les doubles soumissions des points d'entrée publics.
-- La table est inaccessible aux rôles publics et n'est manipulée que par les
-- routes serveur utilisant la clé service_role.

CREATE TABLE IF NOT EXISTS public.public_intake_idempotency (
  endpoint text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed')),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  dossier_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS public_intake_idempotency_created_at_idx
  ON public.public_intake_idempotency (created_at);

ALTER TABLE public.public_intake_idempotency ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.public_intake_idempotency FROM anon, authenticated;
GRANT ALL ON TABLE public.public_intake_idempotency TO service_role;
