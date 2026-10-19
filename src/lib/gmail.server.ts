/**
 * Compatibilité des imports historiques pendant la migration du CRM vers IONOS.
 * Toute lecture/écriture de boîte passe désormais par l'adaptateur IMAP/SMTP.
 */
export * from "@/lib/ionos-mail.server";
