# Choix d’architecture — CRM Assurance après l’abandon de Zoho

**État au 19/10/2026 : choix ouvert.** Erwan annule Zoho CRM après un tarif annoncé de **70 €/mois**, jugé trop élevé. Aucun outil de remplacement n’est retenu. La cible budgétaire reste **30 €/mois hors Google Workspace**. Lovable reste exclu de la cible.

Cette note remplace la recommandation antérieure de conserver Zoho CRM Enterprise. Elle ne vaut ni souscription, ni résiliation, ni migration, ni suppression de données.

## Contexte fonctionnel

Le [cahier des charges CRM Assurance dans Notion](https://app.notion.com/p/9cf30bc51a254a7ca50a23e4c1079d8b) définit un CRM métier complet : clients particuliers et professionnels, dossiers et contrats, produits d’assurance, recueils, tâches, e-mails, documents, sinistres, réclamations, conformité, commissions et suivi financier. Les parcours, validations humaines, droits et règles de gestion doivent être vérifiés exigence par exigence.

## Constats sur le dépôt

Audit statique de la branche principale le 19/10/2026 :

- Le dépôt utilise React, TanStack Start/Vite et Supabase ; ce n’est pas un projet WordPress.
- Il comprend environ 90 fichiers de routes, 143 composants React et 202 migrations SQL Supabase.
- Le code référence encore des services Lovable pour l’authentification, les e-mails, les webhooks et l’outillage ; `AGENTS.md` indique une connexion du dépôt à Lovable.
- Ces éléments attestent d’un socle de code à auditer. Ils ne prouvent ni l’état de production ni qu’une fonctionnalité est complète et opérationnelle.

Sources : [dépôt EJ-Assurances](https://github.com/ejassurances/EJ-Assurances), [package.json](https://github.com/ejassurances/EJ-Assurances/blob/main/package.json), [AGENTS.md](https://github.com/ejassurances/EJ-Assurances/blob/main/AGENTS.md), [routes](https://github.com/ejassurances/EJ-Assurances/tree/main/src/routes), [migrations](https://github.com/ejassurances/EJ-Assurances/tree/main/supabase/migrations).

## Options à comparer

1. **Reprendre l’application existante sans Lovable** : identifier les services à remplacer, les frais, l’effort de détachement et la maintenance.
2. **WordPress avec un CRM et des extensions métier** : vérifier les fonctions réelles pour les parcours assurance, les rôles, les pièces, les automatisations et les données financières ; intégrer l’hébergement, les licences, le développement, les sauvegardes et la maintenance.
3. **Un autre CRM SaaS** : vérifier l’offre et son prix réel, puis cartographier les fonctions incluses, la configuration nécessaire, les intégrations payantes et les lacunes.
4. **Une solution hybride ou un autre produit** : ne la retenir que si elle couvre les exigences sans créer deux référentiels métier incohérents.

Comparer toutes les options sur les mêmes scénarios et sur le même périmètre. Le coût total comprend les abonnements et consommations (hébergement, e-mail, IA, signature, automatisation), la mise en place, la reprise ou ressaisie des données, les sauvegardes et la maintenance humaine. Si la cible de 30 €/mois ne permet pas de couvrir le cahier complet, proposer un MVP progressif avec coûts et arbitrages explicites.

## Étapes de travail

1. Établir une matrice de couverture de toutes les exigences, avec critères d’acceptation et preuves.
2. Auditer le code, les services actifs, le déploiement, la base et les documents à préserver ou reprendre.
3. Chiffrer les options et leurs coûts de mise en place et d’exploitation.
4. Recetter un MVP : création client + dossier, recherche de doublons, tâches, documents et droits d’accès.
5. Étendre les parcours et automatisations après recette ; distinguer systématiquement prévu, configuré et opérationnel.

Le choix Zoho du 16/10/2026 est remplacé par la décision du 19/10/2026 de rouvrir l’étude. L’état d’un éventuel essai ou abonnement Zoho n’a pas été vérifié ; cette note n’effectue aucune résiliation de compte ni aucun changement de production.
