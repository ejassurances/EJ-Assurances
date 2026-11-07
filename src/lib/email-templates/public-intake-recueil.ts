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
 * Lien du recueil des besoins : le formulaire public génère un jeton ; le
 * recueil vit dans le CRM (app.ej-assurances.fr/recueil-besoins).
 */
export function lienRecueilCrm(recueilUrl: unknown): string {
  const base = "https://app.ej-assurances.fr/recueil-besoins";
  try {
    const token = new URL(String(recueilUrl ?? "")).searchParams.get("token") ?? "";
    return /^[a-f0-9]{48}$/.test(token) ? `${base}?token=${token}` : base;
  } catch {
    return base;
  }
}

export function PublicIntakeRecueilEmail(props: {
  prenom?: string;
  dossier_reference?: string;
  recueil_url?: string;
  documents?: string[];
}) {
  const lien = lienRecueilCrm(props.recueil_url);
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
    "<p><b>Étape 1 — Votre recueil des besoins (5 à 10 minutes)</b><br/>" +
    "Quelques questions sur votre prêt et votre situation, pour que l’étude corresponde vraiment à votre besoin :</p>" +
    "<p><a href='" +
    lien +
    "'>Compléter mon recueil des besoins</a></p>" +
    "<p>Vos réponses sont enregistrées à chaque étape : vous pouvez reprendre plus tard avec le même lien, valable 30 jours.</p>" +
    "<p><b>Étape 2 — Les documents utiles</b></p>" +
    "<ul>" +
    documents.map((d) => "<li>" + echapperHtml(d) + "</li>").join("") +
    "</ul>" +
    "<p>Vous pouvez nous les transmettre en réponse à cet e-mail. N’y joignez aucune information médicale : si l’assureur en a besoin, il prévoit son propre questionnaire sécurisé.</p>" +
    "<p>L’étude est gratuite et sans engagement. Je reviens vers vous sous 72 heures après réception de votre recueil.</p>" +
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
      recueil_url: "https://ej-assurances.fr/recueil-besoins?token=" + "a".repeat(48),
    },
  },
};
