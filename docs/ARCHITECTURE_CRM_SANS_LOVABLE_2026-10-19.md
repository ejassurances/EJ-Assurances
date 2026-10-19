# Étude d’architecture — CRM Assurance sans Lovable

**État au 19/10/2026 : aucun outil n’est retenu.** Erwan annule Zoho CRM après un tarif annoncé de **70 €/mois**, jugé trop élevé. La cible budgétaire reste **30 €/mois hors Google Workspace**. Lovable reste exclu.

La recommandation antérieure en faveur de Zoho est retirée. Cette étude ne vaut ni achat, ni résiliation d’un compte, ni migration, ni suppression de données.

## Ce que le CRM doit couvrir

Le [cahier des charges CRM Assurance](https://app.notion.com/p/9cf30bc51a254a7ca50a23e4c1079d8b) prévoit un vrai CRM métier : clients particuliers et professionnels, plusieurs produits et dossiers, contrats, recueils, tâches, e-mails, documents, sinistres, réclamations, conformité, commissions et encaissements. Les règles de dates, les validations humaines et les contrôles d’accès font partie du besoin. Une fonctionnalité évoquée dans le cahier ne doit pas être déclarée prête sans preuve et recette.

## Constats sur le dépôt EJ-Assurances

Audit statique de la branche principale le 19/10/2026 :

- L’application utilise React, TanStack Start/Vite et Supabase. Ce n’est pas un projet WordPress.
- Le dépôt comprend environ 90 fichiers de routes, 143 composants React et 202 migrations SQL Supabase.
- Des références à Lovable subsistent pour l’authentification, les e-mails, les webhooks et l’outillage ; `AGENTS.md` indique que le dépôt est relié à Lovable.
- Ce volume de code constitue une base potentiellement réutilisable, pas une preuve que les fonctions sont terminées, cohérentes ou en production. Il faut auditer les parcours, dépendances, données et tests avant d’estimer l’effort de reprise.

Sources : [dépôt](https://github.com/ejassurances/EJ-Assurances), [package.json](https://github.com/ejassurances/EJ-Assurances/blob/main/package.json), [AGENTS.md](https://github.com/ejassurances/EJ-Assurances/blob/main/AGENTS.md), [routes](https://github.com/ejassurances/EJ-Assurances/tree/main/src/routes), [migrations](https://github.com/ejassurances/EJ-Assurances/tree/main/supabase/migrations).

## Comparaison des pistes

### A. Reprendre l’application existante sans Lovable — priorité d’audit

C’est le seul candidat identifié qui possède déjà des écrans et un modèle métier propres au projet. Le premier travail est de vérifier ce qui fonctionne, ce qui est incomplet et ce qui dépend encore de Lovable, puis d’établir le coût de correction et de maintenance.

Repères d’hébergement, pas un devis de déploiement : Supabase Pro commence à **25 USD/mois** et inclut des sauvegardes quotidiennes conservées 7 jours ; le plan Cloudflare Workers payant démarre à **5 USD/mois**. Cette combinaison représenterait environ **30 USD/mois avant taxes**, e-mails, IA, signature et adaptation technique. Cloudflare Pages sert gratuitement les fichiers statiques, mais les requêtes qui invoquent des fonctions sont facturées selon Workers. L’application EJ doit d’abord être vérifiée sur cette cible. Sources : [tarifs Supabase](https://supabase.com/pricing), [tarifs Workers](https://developers.cloudflare.com/workers/platform/pricing/), [fonctions Pages](https://developers.cloudflare.com/pages/functions/pricing/).

### B. EspoCRM auto-hébergé — meilleur candidat standard à éprouver

EspoCRM est un CRM open source qui peut être auto-hébergé. Son outil d’administration permet de créer des entités, champs et relations personnalisés. Ses workflows graphiques et processus BPM sont toutefois fournis par l’Advanced Pack payant ; le prix actuel de cette licence auto-hébergée reste à obtenir. L’offre cloud Basic est affichée à **15 USD/utilisateur/mois avec un minimum de trois utilisateurs**, soit 45 USD/mois, et dépasse donc la cible telle qu’affichée. Il faut tester la couverture métier, le coût des extensions et la charge d’exploitation avant de retenir cette option.

Sources : [téléchargement et licence](https://www.espocrm.com/download/), [entités personnalisées](https://docs.espocrm.com/administration/entity-manager/), [workflows](https://docs.espocrm.com/administration/workflows/), [Advanced Pack](https://docs.espocrm.com/extensions/advanced-pack/overview/), [offre cloud](https://www.espocrm.com/cloud/).

### C. WordPress + Jetpack CRM — démarrage rapide, couverture métier non démontrée

Jetpack CRM affiche une offre Entrepreneur à **17 USD/mois, facturée annuellement**, en plus de l’hébergement WordPress. L’éditeur décrit la gestion des contacts, entreprises, ventes, factures, paiements et extensions. Les documents consultés ne démontrent pas la couverture des dossiers d’assurance multi-produits, des recueils, des commissions versées par les compagnies, des sinistres et des règles métier du cahier. Ajouter un plugin métier EJ exigerait du développement spécifique et une maintenance.

Sources : [tarifs Jetpack CRM](https://jetpackcrm.com/pricing/), [présentation](https://jetpackcrm.com/).

### D. Développer un plugin CRM spécifique pour WordPress

C’est techniquement faisable, mais WordPress ne fournit pas seul le CRM assurance demandé. Il faudrait construire le modèle relationnel, les permissions, le journal, les dossiers, les automatisations, les documents et les intégrations. Le faible coût de l’hébergement ne permet pas d’estimer le coût du développement, des mises à jour et de la maintenance. Cette option doit être comparée à la reprise de l’application existante et à EspoCRM, sur les mêmes parcours.

### E. Zoho CRM

Écarté par Erwan au tarif annoncé de 70 €/mois. Les précédents prix estimatifs inscrits dans Notion sont remplacés par ce tarif communiqué pour la décision actuelle.

## Orientation provisoire

La prochaine étape recommandée est d’**auditer d’abord les parcours et dépendances de l’application EJ existante**, en parallèle d’un petit essai EspoCRM sur des données fictives. Comparer ensuite le résultat à une solution WordPress avec des critères identiques. Ce n’est pas encore un choix de production : retenir l’application existante seulement si son détachement de Lovable, sa couverture et son coût sont acceptables. Ne choisir WordPress que si l’essai prouve une meilleure couverture ou un coût total inférieur.

La matrice de comparaison doit distinguer pour chaque exigence : fonction disponible, configuration, développement, intégration payante, lacune, coût et scénario de recette. Si les 30 €/mois ne couvrent pas tout le cahier, proposer un MVP progressif et un coût complet, sans promettre une couverture intégrale gratuite.

## Protection des données

Le cahier touche à l’assurance santé et aux pièces client. Certaines informations peuvent révéler la santé et être des données sensibles au sens du RGPD. Avant de charger de vrais dossiers, préciser les données nécessaires, accès, conservation, sous-traitants et localisation d’hébergement. Le champ d’application de la certification HDS dépend du contexte juridique et ne doit pas être présumé automatiquement ; à vérifier avant de choisir un hébergeur.

Sources : [définition CNIL des données de santé](https://www.cnil.fr/fr/quest-ce-ce-quune-donnee-de-sante), [référentiel officiel HDS](https://esante.gouv.fr/sites/default/files/media/document/Referentiel-Certification-HDS-FR-Revision-20230723.pdf), [registre CNIL des traitements](https://www.cnil.fr/fr/RGPD-le-registre-des-activites-de-traitement).

## Limites et état opérationnel

Cette note est une étude documentaire et un audit statique du dépôt. Les données de production, l’instance WordPress, le déploiement, les comptes, la base Supabase, le compte Zoho et les licences n’ont pas été vérifiés. Aucun test utilisateur, abonnement, migration, suppression de données ou changement de production n’a été effectué.