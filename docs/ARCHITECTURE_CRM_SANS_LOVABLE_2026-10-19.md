# Recommandation d’architecture — CRM Assurance sans Lovable

**Statut : proposition technique à relier au cahier des charges et à la décision Notion active.** Ce document ne déclenche ni achat, ni migration, ni suppression de données, ni automatisation en production.

## Recommandation

Conserver **Zoho CRM Enterprise** comme cœur opérationnel du CRM Assurance, conformément à la décision active CRM-ARCHI-06 enregistrée dans Notion le 16/10/2026. Exclure Lovable. Garder WordPress pour le site public, séparé du CRM interne.

Ne pas convertir l’application GitHub en plugin WordPress : ce serait une reconstruction du modèle de données, des autorisations, des processus, des intégrations et des écrans, et non une simple installation.

## Constats sur le dépôt GitHub

Audit statique de `main`, branche par défaut, le 19/10/2026 :

- L’application est construite avec React, TanStack Start/Vite et Supabase ; ce n’est pas un projet WordPress.
- Le dépôt comprend environ 90 fichiers de routes, 143 composants React et 202 migrations SQL Supabase.
- Le code référence encore des services Lovable pour l’authentification, les e-mails, les webhooks et l’outillage. `AGENTS.md` indique aussi que le dépôt est relié à Lovable.
- Ces éléments montrent du travail réutilisable comme référence fonctionnelle, mais ne prouvent ni l’état de production ni l’exhaustivité des fonctionnalités.

Sources : [dépôt EJ-Assurances](https://github.com/ejassurances/EJ-Assurances), [package.json](https://github.com/ejassurances/EJ-Assurances/blob/main/package.json), [AGENTS.md](https://github.com/ejassurances/EJ-Assurances/blob/main/AGENTS.md), [arbre des routes](https://github.com/ejassurances/EJ-Assurances/tree/main/src/routes), [migrations](https://github.com/ejassurances/EJ-Assurances/tree/main/supabase/migrations).

## Périmètre fonctionnel à couvrir

La cible reste le cahier des charges complet : emprunteur, santé, EDPM/trottinette, assurance-vie et parcours professionnels ; clients/personnes/entreprises, dossiers et contrats ; recueils, e-mails, documents, tâches, sinistres, réclamations, conformité, commissions et suivi financier. Les contrôles humains et les règles d’accès déjà décidés restent applicables.

Le fait qu’une fonction soit réalisable dans Zoho ne signifie pas qu’elle est déjà configurée. Zoho documente les fonctions personnalisées sur l’édition Enterprise et certaines autres éditions : [disponibilité et quotas](https://www.zoho.com/crm/developer/docs/functions/limits-quotas.html). Chaque exigence doit être reliée à une fonction native, un module/champ, une fonction Deluge, une intégration, une question ouverte ou un arbitrage de périmètre, puis recettée.

## Plan de livraison

1. **Sauvegarde et inventaire** — exporter les données et documents encore accessibles, inventorier les 10 fiches que l’utilisateur indique vouloir reprendre et conserver une copie de l’ancienne base jusqu’à la recette de la reprise.
2. **Matrice de couverture** — relier chaque exigence du cahier à Zoho, identifier les dépendances, coûts, limites et critères d’acceptation.
3. **Modèle CRM** — vérifier les modules Zoho déjà créés (dossiers assurance et assurés du dossier), leurs relations, les types d’assurance et les champs avant ajout.
4. **Parcours de bout en bout** — traiter création client+dossier/dédoublonnage ; parcours et recueils par produit ; e-mails, brouillons et relances ; contrats, pièces et signatures ; sinistres, réclamations, conformité et finance.
5. **Pilote contrôlé** — vérifier les droits, doubles créations, erreurs, pièces, dates, envois, historique et validations humaines sur des dossiers représentatifs.
6. **Bascule** — réimporter ou ressaisir les fiches, contrôler liens et pièces, puis décider séparément de l’arrêt de l’ancien environnement.

## Coût et contraintes

La décision Notion du 16/10 estime Zoho Enterprise à environ **40 € HT/mois en annuel** ou **50 € HT/mois au mois**, avec un coût supérieur à la cible initiale de 30 €. Confirmer le devis et les options avant achat : [tarification Zoho CRM](https://www.zoho.com/fr/crm/zohocrm-pricing.html). Il s’agit d’une solution sans Lovable, mais pas sans abonnement.

Le cahier fonctionnel reste la source de vérité métier. GitHub reste la source du code et des traces techniques ; Zoho est la cible opérationnelle selon la décision actuelle ; Notion porte les spécifications et le suivi. Éviter une seconde base métier en parallèle.

## Limites de cet audit

Lecture du dépôt public et des documents Notion disponibles seulement. Aucun accès aux données clients, aucune vérification de l’état réel du compte Zoho ou de la base Lovable, aucun test d’intégration, aucune migration, aucun changement en production.