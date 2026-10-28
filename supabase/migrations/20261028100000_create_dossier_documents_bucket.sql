-- Bucket privé utilisé par les pièces des dossiers et contrats.
-- Les politiques storage.objects "Lire fichiers dossier", "Uploader fichiers dossier"
-- et "Supprimer fichier propriétaire ou admin" existent déjà et restent applicables.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dossier-documents',
  'dossier-documents',
  false,
  8388608,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
