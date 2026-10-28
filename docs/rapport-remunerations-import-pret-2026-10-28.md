# Reprise rémunérations et documents emprunteur — 28 octobre 2026

## Périmètre
Preview uniquement. Aucune publication, aucune requête d'écriture sur la base, aucun changement de secrets ou de politiques actives, aucun paiement réel modifié.
Lovable Cloud a été interrogé : base hébergée en pause. Aucune migration appliquée.

## Terminé dans le code
### Rémunérations
- Frais : 5 % des économies totales emprunteur (120/180/240 mois testés), 20 € autres contrats, 0 € assurance vie ; valeurs incohérentes/non finies sans montant.
- Barème compagnie : branche, produit facultatif, dates, linéaire/précompte, taux distincts année 1/renouvellement, base prime contractuelle ou prime nette, périodicité de versement. Taux laissés vides.
- Les périodes ambiguës ne donnent pas lieu à une sélection arbitraire ; priorité au produit précis.
- Les helpers historiques ne calculent plus une commission sur les économies et n'inventent plus de taux de repli. Les règles enregistrées ne sont pas réécrites ; leur base économies est signalée à revoir.
- Persistance préparée via RPC atomique plutôt que deux écritures successives. SQL préparé : déclencheurs contrats/barèmes, clé unique, archivage des versions prévisionnelles avant changement, années hors durée marquées remplacées et réactivées par upsert si durée augmente.
- Aucun cumul frais + commissions ; aucun accès en écriture aux paiements depuis les nouveaux calculs.

### Documents emprunteur
- Dès la création d'un dossier : offre et tableau proposés séparément, chacun facultatif. Même vérification sur le dossier ouvert.
- Réutilisation de l'analyse documentaire existante ; analyse séparée par fichier, champs éditables, provenance par document et confiance documentaire.
- Contradictions laissées sans valeur préremplie : saisie explicite ou champ laissé vide.
- Seule la confirmation humaine autorise le report ; les champs déjà saisis sont conservés. Absence/échec d'analyse permet la saisie manuelle.
- Liste blanche financière, sans extraction du statut fumeur ni données médicales. Formats PDF/JPG/PNG/WEBP, maximum technique 12 Mo, vérification de signature côté serveur.
- Archivage privé préfixé par dossierId conformément aux politiques déposées dans le projet. Nom normalisé, pas d'écrasement Storage ; nettoyage du nouvel objet si insertion documents échoue ; erreurs partielles visibles.
- Une offre ne marque plus le tableau reçu et inversement. Provenance conservée dans l'analyse du dossier, hors liste blanche stricte du recueil.

## Fichiers créés
- src/lib/import-pret-verification.ts
- src/lib/import-pret-verification.test.ts
- src/lib/import-pret-verification.functions.ts
- src/lib/archiver-pret-verifie.functions.ts
- src/components/import-pret-verifie.tsx
- docs/rapport-remunerations-import-pret-2026-10-28.md

## Fichiers modifiés
- src/lib/remuneration-contrat.ts
- src/lib/remuneration-contrat.test.ts
- src/lib/remuneration-previsionnelle.ts
- src/lib/pending-schema-client.ts
- src/lib/commissions-bareme.ts
- src/lib/commission-devis.ts
- src/lib/commission-devis.test.ts
- src/lib/commission-previsions.ts
- src/lib/offre-pret-analyse.server.ts
- src/components/compagnie-bareme-date.tsx
- src/components/commission-bareme-config.tsx
- src/components/commission-contrat-card.tsx
- src/components/contrats-tab.tsx
- src/components/remuneration-contrat-card.tsx
- src/components/import-documents-emprunteur.tsx
- src/components/documents-pret-panel.tsx
- src/routes/_authenticated/espace.dossiers.index.tsx
- src/routes/_authenticated/espace.dossiers.$id.tsx
- src/routes/_authenticated/espace.contrats.$id.tsx
- src/routes/_authenticated/espace.compagnies.$id.tsx
- src/routes/index.tsx
- vitest.config.ts (résolution des imports du projet dans les tests)
- docs/pending-migrations/remuneration_contrat.sql
- AGENTS.md et roadmap.md

Les pages concernées ont été formatées avec Prettier ; leurs métadonnées de page ont été précisées. Les types générés n'ont pas été modifiés.

## Vérifications réellement exécutées
- Vitest : 6 fichiers, **52 tests réussis** : rémunération 23, import vérifié 7, commission depuis devis 7, normalisation dates offre 3, préremplissage existant 7, noms Storage 5.
- Tests couvrant frais totaux, absence/incohérence, linéaire/précompte, changement de durée/barème, clés stables, réactivation, produit prioritaire, période ambiguë, assiette nette, documents absents/incomplets, contradiction, non-détection, refus de données santé et préservation humaine.
- ESLint ciblé sur tous les fichiers TypeScript concernés : **0 erreur, 7 avertissements** (dépendances d'effets et exports Fast Refresh).
- ESLint global : **échec**, 12 910 erreurs et 57 avertissements à ce passage, majoritairement formatage de fichiers hors périmètre. Pas de reformatage global ni correction massive non demandée.
- Compilation/typecheck exécutés automatiquement par l'aperçu : dernier signal consulté **build OK**. Aucun build/typecheck manuel supplémentaire.
- Playwright : /auth, HTTP 200, écran de connexion visible, 0 erreur JavaScript. Ce contrôle ne constitue PAS une validation des deux parcours authentifiés.

## Préparé, non activé/non testé en base
- Migration docs/pending-migrations/remuneration_contrat.sql : colonnes, table de prévisions, historique, RPC et déclencheurs. SQL non appliqué et non exécuté ; validations SQL/transactions/concurrence/RLS restent indispensables avant activation.
- L'index unique historique commission_bareme_compagnie_unique reste intact. L'étape de remplacement, commentée dans la migration, nécessite d'abord la vérification des périodes existantes et de la contrainte sans chevauchement. Tant que l'index existe, plusieurs barèmes datés d'une même compagnie/branche sont refusés.
- L'ancien repli SQL « économies × 5 % / durée = commission » est retiré uniquement dans la fonction de remplacement préparée ; la fonction actuellement hébergée n'a pas été modifiée.
- Base unique signalée pour aperçu et publication : aucune activation sur cette instance partagée n'a été tentée.

## Limites et suite restante
- Base en pause : pas de session authentifiée, création/modification contrat, sauvegarde barème, upload Storage, lecture après archivage ni vérification des politiques réelles.
- L'extraction réelle n'a pas été testée : la passerelle existante nommée geminiFetch redirige actuellement vers Anthropic ; son identifiant attendu n'est pas disponible dans l'environnement de commande. Cette passerelle et les secrets ont été préservés. La présence de GEMINI_API_KEY seule ne prouve pas que l'analyse fonctionne.
- La confiance affichée est celle du document, pas une confidence IA calculée individuellement pour chaque champ.
- Capital, durée, taux, assurance groupe, dates et coûts sont proposés ; les dates/coûts sans champ dédié restent dans la provenance, sans colonne de contrat inventée. Les caractéristiques utiles déjà supportées du recueil alimentent le dossier.
- L'extraction détaillée de chaque ligne de l'échéancier (date, capital restant dû, échéance, assurance par ligne) n'est pas encore implémentée dans ce parcours ; seul le capital restant dû explicitement identifié est proposé.
- Les anciens tableaux de prévisions et échéances restent des vues historiques distinctes ; aucune reclassification des données enregistrées ni aucun recalcul global de paiements effectué.