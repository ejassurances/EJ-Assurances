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
          "Offre de prêt ou tableau d’amortissement",
          "Conditions de l’assurance actuelle si déjà assurée",
          "Pièce d’identité",
        ];
  const html =
    "<p>Bonjour " +
    echapperHtml(props.prenom) +
    ",</p>" +
    "<p>Merci pour votre demande d’étude d’assurance de prêt" +
    (props.dossier_reference ? " (dossier " + echapperHtml(props.dossier_reference) + ")" : "") +
    ". Elle est bien enregistrée.</p>" +
    "<p>Votre espace client sécurisé vient d’être ouvert : vous recevez dans un e-mail séparé vos identifiants provisoires, ainsi que notre Document d’Entrée en Relation.</p>" +
    "<p><b>Étape suivante — votre recueil des besoins</b>, au choix depuis votre espace :</p>" +
    "<ul>" +
    "<li>remplir le recueil en ligne (5 à 10 minutes) ;</li>" +
    "<li>ou déposer vos documents : offre de prêt, tableau d’amortissement et pièce d’identité de chaque assuré.</li>" +
    "</ul>" +
    "<p><a href='" +
    lien +
    "'>Accéder à mon espace client</a></p>" +
    "<p>Documents utiles pour votre étude :</p>" +
    "<ul>" +
    documents.map((d) => "<li>" + echapperHtml(d) + "</li>").join("") +
    "</ul>" +
    "<p>Une fois votre recueil transmis, vous recevrez votre lettre de mission à signer dans votre espace. L’étude est gratuite et sans engagement, et je reviens vers vous sous 72 heures.</p>" +
    "<p>Cordialement,<br/>Erwan Jaffrelot<br/>EJ Partners Assurances</p>";
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
      "Votre étude assurance de prêt — votre recueil des besoins" +
      (data["dossier_reference"] ? " — " + String(data["dossier_reference"]) : ""),
    displayName: "Site public - Recueil des besoins emprunteur",
    previewData: {
      prenom: "Jean",
      dossier_reference: "EJ-2026-EMP-0001",
    },
  },
};
