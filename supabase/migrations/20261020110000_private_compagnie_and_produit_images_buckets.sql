-- Stockage privé des logos de compagnies et des visuels de produits.
-- Les politiques RLS compagnies_logos_* et produits_images_* existent déjà
-- et réservent la lecture aux utilisateurs connectés et les écritures au staff.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'compagnies-logos',
    'compagnies-logos',
    false,
    2097152,
    ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']::text[]
  ),
  (
    'produits-images',
    'produits-images',
    false,
    2097152,
    ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']::text[]
  )
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
