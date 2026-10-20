-- Stockage privé des PDF des produits du CRM (garanties, IPID, tarifs, notices).
-- Les politiques RLS produits_docs_* existent déjà et limitent l'accès au personnel.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'produits-documents',
  'produits-documents',
  false,
  26214400,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
