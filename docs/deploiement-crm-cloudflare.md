# Préparation du CRM EJ Assurances sur Cloudflare

Ce document recense les réglages nécessaires avant un premier déploiement. Les clés doivent être ajoutées dans les variables/secrets Cloudflare, jamais dans GitHub, `wrangler.jsonc` ou le code source.

## Réglages de sécurité déjà prévus

- Le Worker s'appelle `ej-assurances`.
- `workers_dev` et `preview_urls` sont désactivés dans `wrangler.jsonc`.
- Les inscriptions libres au CRM sont désactivées : les comptes doivent être invités dans Supabase.
- Les appels Brevo et Gemini vont directement vers leurs API officielles.
- La boîte e-mail du CRM utilise IONOS en IMAP/SMTP TLS ; les étiquettes de traitement restent dans la base du CRM.
- Google OAuth ne sert qu'à l'intégration Drive.

## Variables de build public

À renseigner dans la configuration de build Cloudflare :

| Variable | Usage |
| --- | --- |
| `VITE_SUPABASE_URL` | URL du projet Supabase utilisé par le CRM |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé publique Supabase intégrée au navigateur |

Ces deux valeurs ne remplacent pas la configuration serveur ci-dessous.

## Secrets et variables du Worker

À ajouter dans **Settings → Variables and Secrets** du Worker :

| Nom | Type | Nécessaire pour |
| --- | --- | --- |
| `SUPABASE_URL` | Variable | Authentification et accès au projet Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Variable | Vérification des sessions Supabase côté serveur |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Tâches serveur autorisées ; cette clé contourne les règles RLS |
| `PUBLIC_APP_URL` | Variable | Liens du CRM envoyés par e-mail, par exemple `https://crm.ej-assurances.fr` |
| `BREVO_API_KEY` | Secret | Envoi des e-mails transactionnels et synchronisation des contacts |
| `IONOS_EMAIL_ADDRESS` | Variable | Adresse complète de la boîte lue par le CRM |
| `IONOS_EMAIL_PASSWORD` | Secret | Mot de passe de cette boîte IONOS |
| `IONOS_IMAP_HOST` | Variable, facultative | Hôte IMAP ; valeur par défaut `imap.ionos.fr` |
| `IONOS_SMTP_HOST` | Variable, facultative | Hôte SMTP ; valeur par défaut `smtp.ionos.fr` |
| `GOOGLE_OAUTH_CLIENT_ID` | Secret | Accès Google Drive côté serveur |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secret | Accès Google Drive côté serveur |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Secret | Renouvellement automatique du jeton Drive |
| `GEMINI_API_KEY` | Secret | Assistants et analyses IA |

Gemini reste désactivé fonctionnellement tant que cette clé n'est pas présente. Avant de l'activer sur des données CRM réelles, vérifier les conditions de traitement applicables aux données personnelles et de santé.

Les tâches planifiées Supabase nécessitent aussi deux entrées dans **Supabase Vault** : `crm_public_job_token` (jeton transmis dans l'en-tête des tâches) et `crm_public_base_url` (l'origine HTTPS du CRM, sans chemin ni barre oblique finale). La migration `20261019140000_crm_cloudflare_runtime_url.sql` fait échouer ces appels si l'une des deux valeurs manque ; elle ne les dirige plus vers l'ancienne URL.

## Connexion de la boîte IONOS

Le Worker se connecte à la boîte avec IMAP TLS sur le port `993` (`imap.ionos.fr`) et envoie les réponses par SMTP TLS sur le port `465` (`smtp.ionos.fr`). IONOS documente les [paramètres IMAP/SMTP](https://www.ionos.fr/assistance/email/sujets-generaux/messagerie-ionos-donnees-de-serveur-pour-imap-pop3-et-smtp/) et le [webmail](https://www.ionos.fr/assistance/email/webmail/se-connecter-facilement-a-webmail/). Les secrets d'adresse et de mot de passe doivent être créés dans les paramètres du Worker ; ils ne doivent jamais être copiés dans Git ou dans une conversation.

Les étiquettes métier (directions, brouillons à relire, alertes et archives) sont enregistrées par le CRM dans `crm_email_labels`. La migration `20261019153000_crm_ionos_mail_labels.sql` doit être appliquée à Supabase avant d'activer les fonctions de boîte. Les dossiers IMAP `Envoyés`, `Brouillons`, `Archives` et `Corbeille` sont utilisés pour les actions correspondantes.

## Connexion Google Drive

Seule l'intégration Drive utilise OAuth Google. Le projet Google doit activer Drive API et le jeton d'actualisation doit autoriser `https://www.googleapis.com/auth/drive`. Google documente le renouvellement des jetons dans [OAuth 2.0 pour les applications Web serveur](https://developers.google.com/identity/protocols/oauth2/web-server).

## Intégrations facultatives

Les intégrations assureurs/partenaires ne sont pas nécessaires pour ouvrir une première version interne. Leurs variables (`NEOLIANE_*`, `SIMULASSUR_*`, `UGIP_*`, `OPENSANCTIONS_API_KEY` et jetons de webhooks) ne doivent être ajoutées que si le flux correspondant est activé et configuré.

Pour exécuter les outils de migration Drizzle depuis un poste de développement, définir `SUPABASE_DB_URL` localement. Ne pas l'ajouter aux secrets du Worker ; cette URL donne un accès direct à la base et n'est pas nécessaire à l'exécution du CRM.

## Avant de déployer

1. Vérifier que le projet Supabase utilisé est accessible indépendamment de la plateforme d'origine, puis renseigner son URL et ses clés dans Cloudflare.
2. Définir le sous-domaine du CRM et aligner `PUBLIC_APP_URL` avec celui-ci.
3. Ajouter les secrets Brevo, IONOS et Google Drive seulement après avoir validé les comptes et autorisations nécessaires.
4. Créer les comptes CRM autorisés dans Supabase ; ne pas réactiver l'inscription publique.
5. Faire un déploiement de test sans données clients, puis vérifier la connexion IMAP, l'envoi SMTP, l'archivage, les brouillons et le rattachement des e-mails aux fiches CRM.

Ne pas déployer tant que ces valeurs et le domaine CRM ne sont pas prêts.
