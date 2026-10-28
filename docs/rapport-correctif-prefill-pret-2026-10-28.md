# Correctif de préremplissage emprunteur — 28 octobre 2026

## Cause établie dans le code

Les champs capital, durée, taux nominal, prêteur et première échéance étaient déjà correctement mappés dans le parcours vérifié. Le formulaire d’un dossier existant initialisait néanmoins son état local une seule fois depuis le recueil reçu. Après confirmation serveur et rechargement du parent, cet état restait ancien : les valeurs importées pouvaient rester invisibles et un autosave du JSON local complet pouvait les écraser.

Autre distinction importante : mensualité hors assurance, date d’édition, date du capital restant dû, date de fin et coût total du prêt sont extraits mais ne possèdent pas de destination autorisée dans le recueil actuel. Le trigger de la migration 20260914133928 rejette ces clés ; ce n’est pas une suppression silencieuse. Réutiliser assurance_banque_mensuelle pour la mensualité du prêt serait une erreur métier. Ces informations restent dans analyse_ia.imports_pret_verifies, sans nouvelle clé interdite.

## Changements

- `src/components/recueil-dossier-panel.tsx` : synchronisation du formulaire monté avec le recueil rechargé, conservation des saisies locales non enregistrées, lecture de l’état actuel à l’autosave et suivi dirty conservé jusqu’à succès.
- `src/lib/import-pret-verification.ts` : correspondances uniques exportées, fusion protectrice réutilisable et préparation pure du payload de confirmation ; capital/durée des colonnes existantes conservés même avec recueil vide.
- `src/lib/archiver-pret-verifie.functions.ts` : réutilisation du payload, maintien authentification/autorisation, garde updated_at avec erreur explicite en cas de modification concurrente. Aucun changement de politique.
- `src/components/import-pret-verifie.tsx` : confirmation invalidée avant nouvelle analyse, saisie manuelle accessible même si l’appel d’extraction échoue ; champs audit-only signalés.
- `src/lib/import-pret-verification.test.ts` : six régressions supplémentaires, offre, tableau, préremplissage, fusion du formulaire, colonnes existantes, simulation de sauvegarde/réouverture JSON et conservation de mensualité/date dans l’audit.
- `AGENTS.md`, `roadmap.md` : conventions de protection et état du chantier.

## Vérifications

Vitest : 5 fichiers, 54/54 tests réussis à 17:44 UTC : import vérifié 13, rémunérations 23, commission-devis 7, normalisation recueil 4, ancien préremplissage 7. Les tests de réouverture simulent un aller-retour JSON du payload partagé ; ils ne constituent pas une sauvegarde/lecture réelle de la base.

Prettier appliqué aux cinq fichiers TypeScript concernés. Première vérification lint : zéro erreur, un commentaire de désactivation inutilisé ; commentaire retiré ensuite. Résultats finaux consignés dans la réponse après le dernier contrôle.

Dernier signal de compilation automatique consulté après les premières modifications : build OK à 17:44:58 UTC. Aucun build/typecheck manuel exécuté ; contrôle automatique final à relire après les derniers ajustements.

## Blocages et périmètre exact

- Lovable Cloud confirmé en pause : pas de parcours authentifié vérifiable, pas d’extraction réelle, upload/sauvegarde/réouverture en base ni politiques actives testés. Aucune donnée réelle écrite ni migration appliquée.
- L’OCR existant redirige vers Anthropic ; aucune nouvelle clé/configuration ou substitution de modèle effectuée. Le repli manuel ne répare pas l’indisponibilité du fournisseur.
- La mensualité du prêt et les quatre autres clés sans destination autorisée restent dans l’audit. Les afficher et modifier comme champs métier persistés du recueil nécessite une extension additive de la liste SQL et du formulaire ; non réalisée sur l’instance partagée en pause.
- Le parcours documentaire historique avec analyseAutorisee=true n’est pas unifié ici ; il reste distinct. Les documents de l’import vérifié sont toujours archivés par le flux existant, sans changement d’upload.
- Aucune publication et aucun paiement réel modifié. Rémunérations et import prêt précédents conservés. Le projet devis reste au stade du plan, sans code applicatif ajouté.
- Branche observée au début : edit/edt-e1e1a43f-ad95-4e83-9327-9e30f2dd89e4, pas main. L’agent ne peut ni changer de branche ni pousser/committer manuellement ; il ne prétend pas à une livraison sur main. SHA courant à rapporter après les contrôles (commits gérés par la plateforme).

Preview : https://id-preview--858511e9-52da-414d-be08-3727111ac35d.lovable.app