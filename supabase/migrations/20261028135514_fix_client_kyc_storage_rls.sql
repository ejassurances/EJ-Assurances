-- Autoriser le dépôt des pièces KYC client dans dossier-documents.
-- Les chemins KYC suivent client_id/kyc/nom-fichier ; les dossiers restent dossier_id/...
DROP POLICY IF EXISTS "Uploader fichiers dossier" ON storage.objects;
CREATE POLICY "Uploader fichiers dossier"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'dossier-documents'
  AND (
    (
      (storage.foldername(name))[2] = 'kyc'
      AND public.can_access_client(((storage.foldername(name))[1])::uuid)
    )
    OR
    (
      COALESCE((storage.foldername(name))[2], '') <> 'kyc'
      AND public.can_access_dossier(((storage.foldername(name))[1])::uuid)
    )
  )
);

DROP POLICY IF EXISTS "Lire fichiers dossier" ON storage.objects;
CREATE POLICY "Lire fichiers dossier"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'dossier-documents'
  AND (
    (
      (storage.foldername(name))[2] = 'kyc'
      AND public.can_access_client(((storage.foldername(name))[1])::uuid)
    )
    OR
    (
      COALESCE((storage.foldername(name))[2], '') <> 'kyc'
      AND public.can_access_dossier(((storage.foldername(name))[1])::uuid)
    )
  )
);

DROP POLICY IF EXISTS "Supprimer fichier propriétaire ou admin" ON storage.objects;
CREATE POLICY "Supprimer fichier propriétaire ou admin"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'dossier-documents'
  AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      (storage.foldername(name))[2] = 'kyc'
      AND public.has_role(auth.uid(), 'mandataire'::public.app_role)
      AND public.can_access_client(((storage.foldername(name))[1])::uuid)
    )
  )
);
