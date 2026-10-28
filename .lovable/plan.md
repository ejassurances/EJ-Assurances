# Audit (lecture seule) — Ajouter un client déjà en portefeuille à partir d'un contrat/attestation PDF

Aucun fichier, aucune donnée et aucun réglage n'a été modifié. Aucun parcours à l'écran n'a été testé : le backend est en pause, donc ni la base, ni le stockage, ni les règles d'accès n'ont pu être interrogés en direct. Les constats ci-dessous viennent uniquement de la lecture du code et des migrations.

## Conclusion
Le parcours complet « déposer un PDF de contrat → l'IA extrait → préremplit une fiche client + contrat → validation humaine → détection de doublon » **n'existe pas en un seul flux**. Les briques existent, mais séparément et ailleurs :

| Brique | Existe ? | Où |
|---|---|---|
| Dépôt d'un PDF sur un contrat **déjà créé** | Oui | `src/components/contrat-documents-panel.tsx` (`onUpload`) |
| Classement du type de document par IA | Oui | `classifierDocument` — `src/lib/classification-documentaire.server.ts` |
| Extraction IA du contenu (Gemini) | Oui, mais n'écrit **rien** dans clients/contrats (choix voulu : résultat dans `doc_extractions` seulement) | `extraireDocument` — `src/lib/extraction-documentaire.server.ts` |
| Préremplissage à partir de l'extraction | Seulement pour les **offres de prêt** (recueil emprunteur) | `src/lib/recueil-documents.functions.ts` + `documents-pret-panel.tsx` |
| Préremplissage depuis un e-mail entrant | Oui (pièces jointes d'e-mails) | `src/lib/relation-client.server.ts` (l. 777, 820) |
| Détection de doublon client | Oui (nom/prénom/e-mail/téléphone normalisés, testée) | `trouverClientExistant` — `src/lib/client-dedoublonnage.server.ts` (+ test) ; appelée par création rapide, recueil, tri e-mail |
| Création rapide client + dossier | Code présent mais la fonction de base `creer_client_dossier_rapide` **n'est pas appliquée** en base | `src/lib/creation-rapide-client-dossier.functions.ts` |
| Écran « nouveau client depuis un contrat PDF » avec validation champ par champ | **Absent** | — |
| Création de contrat depuis une extraction de certificat/attestation | **Absent** (`creerContratDepuisDossier` part d'un dossier, pas d'un PDF) | `src/lib/contrat-depuis-dossier.server.ts` |

Ce qui manque donc : un point d'entrée pour déposer le PDF **avant** que le client existe, l'association extraction → champs client/contrat, l'écran de validation humaine, et l'appel à la détection de doublons dans ce flux.

## Cause probable de « Invalid key: …/contrats/…/<timestamp>-Certificat adhesion santé - Lisa LOUIS.pdf »
Dans `contrat-documents-panel.tsx`, le chemin de stockage reprend le nom du fichier **tel quel** :
`${clientId}/contrats/${contratId}/${Date.now()}-${file.name}`.
Le stockage refuse les clés contenant des caractères non ASCII : ici le **« é » de « santé »** (les espaces sont plus tolérés, mais risqués). Le fichier n'est jamais envoyé et aucune ligne n'est créée. Les autres dépôts du CRM nettoient déjà le nom (ex. `dossier-automation.server.ts` l. 117, `bulletins-commissions.functions.ts`), pas celui-ci. Correction attendue (non faite) : nettoyer uniquement la clé de stockage (accents retirés, caractères spéciaux remplacés par `_`) et garder le nom d'origine dans `file_name`.

## Second risque constaté (à confirmer quand le backend sera relancé)
La règle d'accès d'origine du dossier `dossier-documents` (migration `20260722092823`) contrôle le 1er segment du chemin avec `can_access_dossier(...)`, c'est-à-dire un **identifiant de dossier**, alors que ce panneau met l'**identifiant client** en 1er segment. Si aucune migration ultérieure n'a changé cette règle, l'envoi échouera ensuite par un refus d'accès, même après correction du nom. Je dois lire la règle réellement en vigueur en base pour le confirmer.

## Erreurs probables du parcours actuel
- Fichiers dont le nom contient des accents ou certains caractères spéciaux : refus « Invalid key ».
- Possible refus d'accès lié au 1er segment du chemin (voir ci-dessus).
- Création rapide client/dossier : échoue tant que la fonction de base n'est pas appliquée.
- Extraction des certificats : le type `attestation_assurance` est reconnu, mais rien ne vient remplir le contrat.

## Tests réellement possibles
- Possibles maintenant : relancer le test de dédoublonnage existant (`client-dedoublonnage.server.test.ts`) ; écrire un test unitaire de nettoyage de clé sur « Certificat adhesion santé - Lisa LOUIS.pdf ».
- Une fois le backend relancé : lire les règles d'accès en vigueur sur le stockage, vérifier si `creer_client_dossier_rapide` existe, puis déposer un PDF en étant connecté (navigateur automatisé) pour reproduire l'erreur et confirmer la correction.
- Pas possible sans développement : tester le parcours complet PDF → préremplissage → validation, puisqu'il n'existe pas.

## Suite proposée (à valider, un chantier à la fois)
1. Petit correctif : nettoyer la clé de stockage dans le panneau des documents de contrat (+ test), après vérification de la règle d'accès.
2. Chantier séparé, si vous le souhaitez : écran « Ajouter un client en portefeuille depuis un contrat PDF » qui réutilise classement, extraction et dédoublonnage, avec une validation humaine avant toute écriture.
