-- Lot B — Dossier / Pipeline foundation.
-- Keep legacy dossier.statut for compatibility while introducing the target
-- pipeline model: stage, independent blocking state and explicit next action.

ALTER TABLE public.dossiers
  ADD COLUMN IF NOT EXISTS pipeline_etape text,
  ADD COLUMN IF NOT EXISTS pipeline_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS blocage_actif boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocage_code text,
  ADD COLUMN IF NOT EXISTS blocage_motif text,
  ADD COLUMN IF NOT EXISTS blocage_element_attendu text,
  ADD COLUMN IF NOT EXISTS blocage_responsable text,
  ADD COLUMN IF NOT EXISTS blocage_depuis timestamptz,
  ADD COLUMN IF NOT EXISTS prochaine_action text,
  ADD COLUMN IF NOT EXISTS prochaine_action_le date;

ALTER TABLE public.dossiers DROP CONSTRAINT IF EXISTS dossiers_pipeline_etape_check;
ALTER TABLE public.dossiers ADD CONSTRAINT dossiers_pipeline_etape_check CHECK (
  pipeline_etape IS NULL OR pipeline_etape IN (
    'nouveau','qualification','pieces_en_cours','conformite_a_verifier',
    'lettre_mission','recherche_devis','analyse_recommandation','fic_a_valider',
    'fic_envoye','souscription_a_lancer','suivi_compagnie','contrat_actif',
    'post_vente','termine_archive'
  )
);

UPDATE public.dossiers
SET pipeline_etape = CASE statut::text
  WHEN 'nouveau' THEN 'nouveau'
  WHEN 'en_cours' THEN 'pieces_en_cours'
  WHEN 'lettre_mission_envoyee' THEN 'lettre_mission'
  WHEN 'dda_validee' THEN 'recherche_devis'
  WHEN 'devis_en_cours' THEN 'analyse_recommandation'
  WHEN 'devoir_conseil_envoye' THEN 'fic_envoye'
  WHEN 'devoir_conseil_signe' THEN 'souscription_a_lancer'
  WHEN 'souscription_envoyee' THEN 'suivi_compagnie'
  WHEN 'contrat_valide' THEN 'contrat_actif'
  WHEN 'contrat_actif' THEN 'contrat_actif'
  WHEN 'cloture' THEN 'termine_archive'
  WHEN 'perdu' THEN 'termine_archive'
  WHEN 'signe' THEN 'termine_archive'
  ELSE 'nouveau'
END
WHERE pipeline_etape IS NULL;

UPDATE public.dossiers
SET prochaine_action = CASE pipeline_etape
  WHEN 'nouveau' THEN 'Qualifier le dossier et vérifier les doublons'
  WHEN 'qualification' THEN 'Compléter la qualification du besoin'
  WHEN 'pieces_en_cours' THEN 'Collecter et contrôler les pièces manquantes'
  WHEN 'conformite_a_verifier' THEN 'Effectuer les contrôles de conformité'
  WHEN 'lettre_mission' THEN 'Obtenir la signature de la lettre de mission'
  WHEN 'recherche_devis' THEN 'Lancer les demandes de devis et suivre les retours'
  WHEN 'analyse_recommandation' THEN 'Analyser les devis et préparer la recommandation'
  WHEN 'fic_a_valider' THEN 'Faire valider le FIC par le responsable humain'
  WHEN 'fic_envoye' THEN 'Suivre la signature du FIC'
  WHEN 'souscription_a_lancer' THEN 'Lancer la souscription'
  WHEN 'suivi_compagnie' THEN 'Suivre la compagnie jusqu’à validation'
  WHEN 'contrat_actif' THEN 'Préparer le post-vente et le suivi'
  WHEN 'post_vente' THEN 'Exécuter les actions post-vente'
  WHEN 'termine_archive' THEN NULL
END
WHERE prochaine_action IS NULL;

CREATE INDEX IF NOT EXISTS dossiers_pipeline_etape_idx ON public.dossiers (pipeline_etape);
CREATE INDEX IF NOT EXISTS dossiers_blocage_idx ON public.dossiers (blocage_actif, prochaine_action_le)
WHERE blocage_actif = true;