import * as React from "react";

import type { TemplateEntry } from "./registry";

function echapperHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * E-mail envoyé après une demande d'étude sur le site public. L'espace client
 * vient d'être créé (identifiants provisoires et DER envoyés à part).
 */
export function PublicIntakeRecueilEmail(props: {
  prenom?: string;
  dossier_reference?: string;
  documents?: string[];
}) {
  const lien = "https://app.ej-assurances.fr/auth";
  const documents =
    Array.isArray(props.documents) && props.documents.length > 0
      ? props.documents
      : [
          "Offre de prêt et tableau d’amortissement",
          "Contrat d’assurance de prêt actuel (certificat d’adhésion ou conditions particulières)",
        ];
  // Parcours du 11/11/2026 : formulaire en 3 écrans puis rendez-vous de pré-qualification.
  const html =
    "<p>Bonjour " +
    echapperHtml(props.prenom) +
    ",</p>" +
    "<p>Merci pour votre demande d’étude d’assurance de prêt" +
    (props.dossier_reference ? " (dossier " + echapperHtml(props.dossier_reference) + ")" : "") +
    ". Elle est bien enregistrée.</p>" +
    "<p><b>Prochaine étape : votre rendez-vous de pré-qualification.</b> Nous vous appelons sous 24 heures (jours ouvrés) pour le fixer, par téléphone ou en visio. Pendant ce rendez-vous, nous complétons ensemble les dernières informations, nous vous donnons une première estimation et nous vous expliquons la suite. Sans engagement.</p>" +
    "<p>Votre espace client sécurisé vient d’être ouvert : vous recevez dans un e-mail séparé vos identifiants provisoires et notre Document d’Entrée en Relation.</p>" +
    "<p>Si vous ne les avez pas encore déposés, vous pouvez y ajouter ces documents avant le rendez-vous :</p>" +
    "<ul>" +
    documents.map((d) => "<li>" + echapperHtml(d) + "</li>").join("") +
    "</ul>" +
    "<p>Le contrat d’assurance actuel est indispensable pour calculer votre économie : certaines banques le prévoient à part, hors offre de prêt.</p>" +
    "<p><a href='" +
    lien +
    "'>Accéder à mon espace client</a></p>" +
    "<p>À très vite,<br/>L’équipe EJ Assurances</p>";
  const style = {
    fontFamily: "Arial, sans-serif",
    color: "#1a1a1a",
    fontSize: "15px",
    lineHeight: "1.6",
  };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

/** Modèles du parcours site public → CRM (hors registre historique). */
export const TEMPLATES_PARCOURS_PUBLIC: Record<string, TemplateEntry> = {
  "public-intake-recueil": {
    component: PublicIntakeRecueilEmail,
    subject: (data: Record<string, unknown>) =>
      "Votre demande d’étude d’assurance de prêt est bien reçue" +
      (data["dossier_reference"] ? " — " + String(data["dossier_reference"]) : ""),
    displayName: "Site public - Demande reçue, rendez-vous de pré-qualification",
    previewData: {
      prenom: "Jean",
      dossier_reference: "EJ-2026-EMP-0001",
    },
  },
};
