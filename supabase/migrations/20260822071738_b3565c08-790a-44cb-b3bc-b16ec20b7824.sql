INSERT INTO public.produit_documents (produit_id, type, nom, version, mime_type, interne, storage_path, drive_file_id, drive_url)
SELECT '107207e3-d7f1-426f-8599-13ecafdb4533'::uuid, 'conditions_generales'::public.produit_document_type,
  'Notice d''information Cardif Clé — conventions 2827/736 (cotisations fixes)', '2827/736', 'application/pdf', false, NULL,
  '1jixNWtZ1qohZkKeG8kPnzLcxdiPnYzKR', 'https://drive.google.com/file/d/1jixNWtZ1qohZkKeG8kPnzLcxdiPnYzKR/view'
WHERE EXISTS (
  SELECT 1 FROM public.produits p
  WHERE p.id = '107207e3-d7f1-426f-8599-13ecafdb4533'::uuid
)
AND NOT EXISTS (
  SELECT 1 FROM public.produit_documents d
  WHERE d.produit_id = '107207e3-d7f1-426f-8599-13ecafdb4533'::uuid
    AND d.drive_file_id = '1jixNWtZ1qohZkKeG8kPnzLcxdiPnYzKR'
);

INSERT INTO public.produit_documents (produit_id, type, nom, version, mime_type, interne, storage_path, drive_file_id, drive_url)
SELECT '71125071-3b1e-4d7b-baa7-a1057d000c10'::uuid, 'conditions_generales'::public.produit_document_type,
  'Notice d''information MNCAP — 441066CRD', '441066CRD', 'application/pdf', false, NULL,
  '1MiIpYkbrGy6oSCOu4-ESlF_-p3CRgEFz', 'https://drive.google.com/file/d/1MiIpYkbrGy6oSCOu4-ESlF_-p3CRgEFz/view'
WHERE EXISTS (
  SELECT 1 FROM public.produits p
  WHERE p.id = '71125071-3b1e-4d7b-baa7-a1057d000c10'::uuid
)
AND NOT EXISTS (
  SELECT 1 FROM public.produit_documents d
  WHERE d.produit_id = '71125071-3b1e-4d7b-baa7-a1057d000c10'::uuid
    AND d.drive_file_id = '1MiIpYkbrGy6oSCOu4-ESlF_-p3CRgEFz'
);