# Devis client EJ à partir d’un devis partenaire

## Proposition après audit lecture seule

**DOMAINE :** D4 — Souscription & distribution, lié à D1 — Relation client & dossiers.
**MODULE :** CRM / parcours de souscription.
**SOUS-MODULE :** Devis du dossier.
**OBJECTIF :** importer un devis partenaire, contrôler ses données puis produire une version client EJ fidèle, traçable et validée humainement, sans envoi automatique.

## État actuel vérifié

- `DossierDevisPanel` propose déjà import PDF/photo et préremplissage éditable ; `lireDevisImporte` et `lireDevisDocument` réalisent la lecture documentaire.
- Cette extraction ne couvre pas intégralement taxes, franchises, exclusions, conditions et mentions réglementaires ; elle résume les garanties. Elle ne suffit pas à reconstruire fidèlement le contrat partenaire.
- Le contrôle d’accès existant autorise le dossier mais ne vérifie pas le rattachement du document lu avant sa lecture privilégiée : à corriger dans ce parcours.
- `pdf-lib`, le logo `public/logo-ej-partners.png` et les coordonnées/mentions communes de `pdf-entete-pied.ts` existent.
- `documents` conserve les originaux et `dossier_devis.document_id` leur référence, mais aucun historique dédié de versions client avec validation du contenu exact n’existe.
- Lovable Cloud **en pause**, confirmé lors de cet audit ; politiques réelles et schéma actif non vérifiables. Les migrations du dépôt prévoient un chemin Storage préfixé par **dossierId**.
- La passerelle nommée `geminiFetch` redirige vers Anthropic ; son identifiant n’est pas disponible dans l’environnement de vérification. Aucune extraction réelle testée, aucun changement de fournisseur proposé.
- Régressions exécutées : **37/37 tests passent** (rémunérations 23, import emprunteur 7, commission depuis devis 7). Aucun nouveau parcours UI testé.

## Modification proposée

1. Ajouter un sous-parcours indépendant dans « Devis » du dossier, sans réécrire les calculs de rémunération ni l’import emprunteur.
2. Importer PDF, JPG, PNG et WEBP avec validation serveur des signatures, types et taille, chemins privés immuables et nettoyage du seul nouvel objet si son insertion échoue.
3. Étendre la lecture documentaire dédiée : partenaire, porteur du risque, client, références, produit, garanties, tarifs, taxes, franchises, exclusions, conditions, validité et mentions réglementaires. Restituer les textes contractuels verbatim, les champs absents et contradictions ; aucune donnée médicale et aucune écriture des suggestions IA avant confirmation.
4. Présenter original et champs éditables ; permettre de continuer manuellement après échec OCR. Toute correction invalide la validation précédente. Vérifier explicitement les contradictions avant génération.
5. Générer une **présentation EJ + le devis partenaire intégral en annexe**, plutôt que remplacer le document contractuel par un résumé IA. Les pages PDF originales restent inchangées ; les images acceptées restent intégralement visibles en annexe. Les mentions du partenaire prévalent. Une reconstruction intégrale sans annexe n’est pas proposée : elle risquerait d’omettre des clauses.
6. Conserver chaque version client séparément avec original, empreintes, contenu contrôlé, auteur/date de validation et état de génération. Prévisualisation et téléchargement privés ; aucune action d’envoi automatique ou modification de statut d’offre retenue.
7. Enregistrer la nouvelle demande dans le suivi des travaux, conserver les chantiers précédents et leurs blocages ; fournir un rapport exact des changements et vérifications.

## Dépendances et impact

- Aucun paiement, contrat réel ou document existant modifié/supprimé ; aucune publication, changement de secret ou politique active.
- Pas de migration appliquée à l’instance partagée aperçu/production. Préparer une migration versionnée indépendante des rémunérations pour les versions client, avec permissions et accès au dossier. Garder les types non appliqués dans l’adaptateur dédié conformément aux conventions du projet.
- Sans schéma actif, permettre contrôle et génération locale de prévisualisation ; afficher clairement que l’archivage durable n’est pas activé. Ne pas prétendre qu’une sauvegarde a réussi.
- OCR indisponible : saisie manuelle accessible ; pas de modèle de substitution, pas de nouvelle configuration.
- Reprise séquentielle : le travail rémunérations/import prêt réalisable en code est conservé ; ses vérifications sur données réelles restent bloquées par la base. Ce nouveau parcours reste isolé.

## Détails techniques

- Nouveaux modules ciblés : `devis-client.ts`, tests, `devis-client-review.tsx`, fonctions serveur authentifiées, génération PDF et archivage.
- Un seul point d’intégration dans `dossier-devis-panel.tsx` ; contrôle document→dossier ajouté avant extraction dans `devis-import.functions.ts`.
- Autorisation par client utilisateur/RLS et `can_access_dossier` ; toute lecture privilégiée nécessite d’abord la vérification du document source dans le dossier autorisé.
- Versions avec référence explicite à l’original, instantané humain validé, empreintes et clé idempotente. Un échec d’archivage affiche un état partiel, sans effacer l’original.
- Aucune modification des types générés, du fournisseur OCR commun, des calculs rémunération, des migrations précédentes ou des paiements.

## Tests et vérifications

- Champs manquants sans invention, préservation exacte montants/garanties/conditions, rejet données médicales, échec OCR avec saisie manuelle.
- Génération refusée sans confirmation ; correction après validation nécessitant une nouvelle confirmation ; contradictions non résolues signalées.
- PDF avec original intégral, logo, mentions, pagination et contenu long ; fichiers invalides/trop grands ; accès croisé à un autre dossier refusé ; nettoyage nouvel upload après échec DB.
- Réexécuter les 37 tests des travaux protégés, puis tests du nouveau parcours, Prettier et lint ciblé. Lire les résultats de compilation automatiques de l’aperçu, sans build/typecheck manuel.
- Tester au navigateur uniquement ce qui est réellement accessible ; création/archivage/auth et extraction réelle restent non vérifiés tant que leurs dépendances sont indisponibles.

## Valeur produite et livraison

Un devis présenté au branding EJ, sans perdre les clauses du partenaire, contrôlé humainement et relié à son original. Le rapport distinguera code terminé, préparations non activées et tests réellement effectués.

Référence du projet observée : `bb81eaba` (aucun commit créé par l’agent). Aperçu : https://id-preview--858511e9-52da-414d-be08-3727111ac35d.lovable.app

Ce plan attend la validation requise par votre règle permanente audit → proposition → validation → exécution. **Aucun fichier applicatif, donnée, migration ou configuration n’a été modifié durant l’audit.**