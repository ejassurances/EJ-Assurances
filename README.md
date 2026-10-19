# CRM EJ Assurances

CRM interne d'EJ Assurances, préparé pour un hébergement Cloudflare Workers. L'application s'appuie sur Supabase pour l'authentification, la base et le stockage ; Brevo pour les emails transactionnels ; les API Google pour Gmail/Drive ; et l'API Gemini pour les fonctions IA lorsqu'elles sont configurées.

## Développement local

```sh
bun install
bun run dev
```

## Cloudflare

Le Worker est configuré dans [`wrangler.jsonc`](./wrangler.jsonc). Les secrets ne doivent jamais être ajoutés au dépôt. Avant déploiement, suivre le [guide de préparation Cloudflare](./docs/deploiement-crm-cloudflare.md) et configurer les variables/secrets requis.

Les domaines `workers.dev` et les URL de prévisualisation sont désactivés dans la configuration. Le premier déploiement doit se faire avec une base de test, sans données clients réelles.

## Migrations Supabase

Les migrations versionnées sont dans [`supabase/migrations`](./supabase/migrations). Pour les outils de migration Drizzle, fournir `SUPABASE_DB_URL` dans l'environnement local ; ne pas enregistrer cette URL ni son mot de passe dans Git.

## État

La migration d'hébergement et de services est en cours. Le code de cette branche n'a pas encore été déployé sur Cloudflare. Les intégrations externes nécessitent leurs propres comptes, secrets et autorisations.
