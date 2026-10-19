/**
 * URL publique canonique du CRM (domaine personnalisé de production).
 * Tous les liens envoyés par e-mail doivent l'utiliser, jamais l'origine
 * de la requête (qui peut être une URL de déploiement temporaire).
 */
export const APP_URL = (process.env['PUBLIC_APP_URL'] || 'https://ejpartners.fr').replace(/\/+$/, '')

/** Construit une URL absolue sur le domaine de production. */
export function appUrl(path = '/'): string {
  return `${APP_URL}${path.startsWith('/') ? path : `/${path}`}`
}
