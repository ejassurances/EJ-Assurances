import * as React from "react";
import type { ComponentType } from "react";

export interface TemplateEntry {
  component: ComponentType<any>;
  subject: string | ((data: Record<string, any>) => string);
  displayName?: string;
  previewData?: Record<string, any>;
  to?: string;
}

function DerEnvoiEmail(props: { clientName?: string; cabinetName?: string; link?: string }) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour " +
    (props.clientName || "") +
    ",</p>" +
    "<p>Conformement a la reglementation, veuillez trouver ci-dessous le Document d'Entree en Relation (DER) du cabinet " +
    nom +
    ".</p>" +
    "<p><a href='" +
    (props.link || "") +
    "'>Consulter et signer le DER</a></p>" +
    "<p>Ce document precise le statut de votre courtier, les compagnies partenaires et les modalites de remuneration.</p>" +
    "<p>Cordialement,<br/>L'equipe " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

function LettreMissionEnvoiEmail(props: {
  clientName?: string;
  cabinetName?: string;
  reference?: string;
  link?: string;
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour " +
    (props.clientName || "") +
    ",</p>" +
    "<p>Votre lettre de mission concernant votre dossier " +
    (props.reference || "") +
    " est disponible dans votre espace client. Elle recapitule les informations recueillies et la mission confiee au cabinet " +
    nom +
    ".</p>" +
    "<p><a href='" +
    (props.link || "") +
    "'>Consulter et signer la lettre de mission</a></p>" +
    "<p>Une fois signee, nous pourrons engager la recherche des solutions les plus adaptees a votre situation.</p>" +
    "<p>Cordialement,<br/>L'equipe " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

function DevoirConseilEnvoiEmail(props: {
  clientName?: string;
  cabinetName?: string;
  reference?: string;
  link?: string;
  /** Resume des ajustements apportes suite a une demande du client (2e envoi). */
  notesModification?: string;
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  const notes = (props.notesModification || "").trim();
  return React.createElement(
    "div",
    { style: style },
    React.createElement("p", { key: "intro" }, "Bonjour " + (props.clientName || "") + ","),
    notes
      ? React.createElement(
          "p",
          {
            key: "notes",
            style: {
              backgroundColor: "#f7f3e8",
              borderLeft: "3px solid #b98f2b",
              padding: "12px 14px",
              margin: "0 0 16px",
            },
          },
          notes,
        )
      : null,
    React.createElement(
      "p",
      { key: "corps" },
      "Votre devoir de conseil relatif au dossier " +
        (props.reference || "") +
        " est disponible dans votre espace client. Il presente la solution recommandee et les motifs de ce conseil.",
    ),
    React.createElement(
      "p",
      { key: "lien" },
      React.createElement(
        "a",
        { href: props.link || "" },
        "Consulter, accepter ou refuser la recommandation",
      ),
    ),
    React.createElement("p", { key: "reponse" }, "Votre reponse est necessaire avant toute souscription."),
    React.createElement("p", { key: "signature" }, "Cordialement,", React.createElement("br"), "L'equipe " + nom),
  );
}


function CompteClientCreeEmail(props: {
  clientName?: string;
  email?: string;
  motDePasseProvisoire?: string;
  cabinetName?: string;
  link?: string;
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour " +
    (props.clientName || "") +
    ",</p>" +
    "<p>Votre espace client " +
    nom +
    " a ete cree. Vous y retrouverez votre projet, vos pieces justificatives et vos documents a signer.</p>" +
    "<p><strong>Identifiant :</strong> " +
    (props.email || "") +
    "<br/><strong>Mot de passe provisoire :</strong> " +
    (props.motDePasseProvisoire || "") +
    "</p>" +
    "<p><a href='" +
    (props.link || "") +
    "'>Acceder a mon espace client</a></p>" +
    "<p>Pour votre securite, le changement de ce mot de passe provisoire est obligatoire lors de votre premiere connexion.</p>" +
    "<p>Cordialement,<br/>L'equipe " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

function PiecesManquantesEmail(props: {
  clientName?: string;
  cabinetName?: string;
  reference?: string;
  pieces?: string[];
  link?: string;
  /** Premiere relance J+2 : ajoute l'accuse de reception de la demande. */
  accuse?: boolean;
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const liste = (props.pieces || []).map((p) => "<li>" + p + "</li>").join("");
  const html =
    "<p>Bonjour " +
    (props.clientName || "") +
    ",</p>" +
    (props.accuse
      ? "<p>Nous accusons reception de votre demande et vous remercions de votre confiance. Votre dossier " +
        (props.reference || "") +
        " est en cours d'etude par nos equipes.</p>"
      : "") +
    "<p>Afin de poursuivre l'etude de votre dossier " +
    (props.reference || "") +
    ", il nous manque les pieces suivantes :</p>" +
    "<ul>" +
    liste +
    "</ul>" +

    "<p><a href='" +
    (props.link || "") +
    "'>Deposer mes pieces dans mon espace client</a></p>" +
    "<p>Cordialement,<br/>L'equipe " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

function DocumentsExpirationEmail(props: {
  clientName?: string;
  cabinetName?: string;
  documents?: string[];
  link?: string;
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const liste = (props.documents || []).map((d) => "<li>" + d + "</li>").join("");
  const html =
    "<p>Bonjour " +
    (props.clientName || "") +
    ",</p>" +
    "<p>Certains documents de votre dossier arrivent a expiration :</p>" +
    "<ul>" +
    liste +
    "</ul>" +
    "<p>Afin de maintenir votre dossier a jour, merci de nous transmettre les pieces renouvelees.</p>" +
    "<p><a href='" +
    (props.link || "") +
    "'>Deposer mes pieces dans mon espace client</a></p>" +
    "<p>Cordialement,<br/>L'equipe " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

function MotDePasseReinitialisationEmail(props: { prenom?: string; cabinetName?: string; link?: string }) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour " +
    (props.prenom || "") +
    ",</p>" +
    "<p>Vous avez demande la definition d'un nouveau mot de passe pour votre espace " +
    nom +
    ".</p>" +
    "<p><a href='" +
    (props.link || "") +
    "'>Definir mon nouveau mot de passe</a></p>" +
    "<p>Ce lien est valable une seule fois et pour une duree limitee. Vous serez connecte automatiquement a votre espace une fois le nouveau mot de passe enregistre.</p>" +
    "<p>Si vous n'etes pas a l'origine de cette demande, ignorez simplement ce message : votre mot de passe actuel reste inchange.</p>" +
    "<p>Cordialement,<br/>L'equipe " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

/**
 * E-mail court de renvoi du lien de connexion : aucun rappel du DER ni
 * presentation du cabinet, uniquement l'acces a l'espace client.
 */
function LienConnexionEmail(props: {
  clientName?: string;
  email?: string;
  cabinetName?: string;
  link?: string;
  motDePasseProvisoire?: string;
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const bloc = props.motDePasseProvisoire
    ? "<p><strong>Identifiant :</strong> " +
      (props.email || "") +
      "<br/><strong>Nouveau mot de passe provisoire :</strong> " +
      props.motDePasseProvisoire +
      "</p>"
    : "<p><strong>Identifiant :</strong> " + (props.email || "") + "</p>";
  const html =
    "<p>Bonjour " +
    (props.clientName || "") +
    ",</p>" +
    "<p>Voici le lien de connexion a votre espace client " +
    nom +
    " :</p>" +
    bloc +
    "<p><a href='" +
    (props.link || "") +
    "'>Acceder a mon espace client</a></p>" +
    "<p>Cordialement,<br/>L'equipe " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

/** Envoi du dossier de souscription à la compagnie (destinataire : service souscription). */
function SouscriptionCompagnieEmail(props: {
  compagnieName?: string;
  cabinetName?: string;
  reference?: string;
  clientName?: string;
  produit?: string;
  branche?: string;
  commentaire?: string;
  link?: string;
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour,</p>" +
    "<p>Veuillez trouver ci-dessous une demande de souscription transmise par le cabinet " +
    nom +
    " :</p>" +
    "<ul>" +
    "<li><strong>Reference dossier :</strong> " +
    (props.reference || "") +
    "</li>" +
    "<li><strong>Client :</strong> " +
    (props.clientName || "") +
    "</li>" +
    "<li><strong>Branche :</strong> " +
    (props.branche || "") +
    "</li>" +
    "<li><strong>Produit :</strong> " +
    (props.produit || "") +
    "</li>" +
    "</ul>" +
    (props.commentaire ? "<p>" + props.commentaire + "</p>" : "") +
    "<p>Le devoir de conseil a ete signe par le client et les pieces justificatives sont disponibles sur demande.</p>" +
    "<p>Merci de nous confirmer la prise en charge ainsi que le numero de contrat attribue.</p>" +
    "<p>Cordialement,<br/>Le service souscription " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

/** Relance automatique de la compagnie sans retour sur une souscription. */
function SouscriptionRelanceEmail(props: {
  cabinetName?: string;
  reference?: string;
  clientName?: string;
  produit?: string;
  jours?: number;
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour,</p>" +
    "<p>Sauf erreur de notre part, la demande de souscription suivante reste sans retour depuis " +
    String(props.jours || 3) +
    " jours :</p>" +
    "<ul>" +
    "<li><strong>Reference dossier :</strong> " +
    (props.reference || "") +
    "</li>" +
    "<li><strong>Client :</strong> " +
    (props.clientName || "") +
    "</li>" +
    "<li><strong>Produit :</strong> " +
    (props.produit || "") +
    "</li>" +
    "</ul>" +
    "<p>Pourriez-vous nous indiquer l'etat d'avancement du dossier et, le cas echeant, les pieces complementaires attendues ?</p>" +
    "<p>Cordialement,<br/>Le service souscription " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

function SouscriptionSignatureClientEmail(props: {
  clientName?: string;
  cabinetName?: string;
  link?: string;
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour " +
    (props.clientName || "") +
    ",</p>" +
    "<p>Vos documents de souscription (bulletin d'adhesion et mandat de prelevement) sont prets a etre signes dans votre espace client.</p>" +
    "<p><a href='" +
    (props.link || "") +
    "'>Consulter et signer mes documents</a></p>" +
    "<p>Des la signature, votre adhesion est transmise a l'assureur pour mise en gestion.</p>" +
    "<p>Cordialement,<br/>L'equipe " +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

/** Reponse de l'agent relation client : paragraphes + tableau de donnees reelles. */
function RelationClientReponseEmail(props: {
  clientName?: string;
  cabinetName?: string;
  titre?: string;
  paragraphes?: string[];
  lignes?: { libelle: string; valeur: string }[];
}) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  const paragraphes = Array.isArray(props.paragraphes) ? props.paragraphes : [];
  const lignes = Array.isArray(props.lignes) ? props.lignes : [];
  return React.createElement(
    "div",
    { style: style },
    props.titre
      ? React.createElement("p", { key: "titre", style: { fontWeight: 600, margin: "0 0 12px" } }, props.titre)
      : null,
    React.createElement("p", { key: "intro" }, "Bonjour " + (props.clientName || "") + ","),
    paragraphes.map((p, i) => React.createElement("p", { key: "p" + i }, p)),
    lignes.length
      ? React.createElement(
          "table",
          { key: "table", style: { borderCollapse: "collapse", margin: "8px 0 16px", width: "100%" } },
          React.createElement(
            "tbody",
            null,
            lignes.map((l, i) =>
              React.createElement(
                "tr",
                { key: "l" + i },
                React.createElement(
                  "td",
                  {
                    style: {
                      padding: "6px 10px",
                      borderBottom: "1px solid #e5e7eb",
                      color: "#374151",
                      width: "45%",
                    },
                  },
                  l.libelle,
                ),
                React.createElement(
                  "td",
                  { style: { padding: "6px 10px", borderBottom: "1px solid #e5e7eb", fontWeight: 600 } },
                  l.valeur,
                ),
              ),
            ),
          ),
        )
      : null,
    React.createElement("p", { key: "signature" }, "Cordialement,", React.createElement("br"), "L'equipe " + nom),
  );
}

/**
 * Conseil dans la duree — point de suivi periodique sur les contrats du client.
 * Texte valide par le cabinet : ne pas modifier la formulation.
 */
function SuiviContratsEmail(props: { prenom?: string; listeContrats?: string }) {
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  const paragraphes = [
    "Bonjour " + (props.prenom || "") + ",",
    "Dans le cadre du suivi que nous assurons sur vos contrats d'assurance, nous faisons un point régulier pour vérifier qu'ils correspondent toujours à votre situation.",
    "Vous êtes actuellement couvert(e) chez nous pour : " + (props.listeContrats || "") + ".",
    "Votre situation personnelle, familiale ou professionnelle a-t-elle évolué depuis la souscription (déménagement, changement familial, nouveaux besoins) ? Si c'est le cas, ou si vous avez simplement une question sur vos garanties actuelles, il vous suffit de répondre à cet email — nous reviendrons vers vous rapidement.",
    "Si votre situation n'a pas changé, vous n'avez rien à faire : vos contrats continuent normalement.",
  ];
  return React.createElement(
    "div",
    { style: style },
    ...paragraphes.map((p, i) => React.createElement("p", { key: "p" + i }, p)),
    React.createElement(
      "p",
      { key: "signature" },
      "Cordialement,",
      React.createElement("br"),
      "L'equipe EJ Partners Assurances",
    ),
  );
}

/**
 * Texte validé par le cabinet — à ne pas modifier.
 * Mise en place de l'espace client pour les dossiers reconstitués a posteriori.
 */
function EspaceClientMiseEnPlaceEmail(props: { prenom?: string }) {
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  const p = { margin: "0 0 16px" };
  return React.createElement(
    "div",
    { style: style },
    React.createElement("p", { key: "1", style: p }, "Bonjour " + (props.prenom || "") + ","),
    React.createElement(
      "p",
      { key: "2", style: p },
      "Nous mettons en place un espace client en ligne, qui vous donnera accès à tout moment aux documents de votre contrat d'assurance chez nous : votre document d'entrée en relation, votre lettre de mission, et le détail de vos garanties.",
    ),
    React.createElement(
      "p",
      { key: "3", style: p },
      "Cet espace est ouvert progressivement aux assurés ayant un contrat actif chez nous — c'est votre cas, ce qui explique ce message.",
    ),
    React.createElement(
      "p",
      { key: "4", style: p },
      "Dans le cadre de cette mise en place, nous actualisons également votre dossier afin qu'il soit parfaitement en règle avec les obligations réglementaires qui encadrent notre activité de courtier (document d'entrée en relation et lettre de mission). Vous allez recevoir, séparément, un email contenant ces deux documents : nous vous remercions de bien vouloir les consulter et les signer électroniquement, cela ne prendra que quelques minutes.",
    ),
    React.createElement(
      "p",
      { key: "5", style: p },
      "Si vous avez la moindre question, vous pouvez nous répondre directement à cet email.",
    ),
    React.createElement(
      "p",
      { key: "6", style: p },
      "Cordialement,",
      React.createElement("br", { key: "b1" }),
      "Erwan Jaffrelot",
      React.createElement("br", { key: "b2" }),
      "EJ Partners Assurances",
    ),
  );
}

function PrequalificationEmprunteurEmail(props: { prenom?: string; cabinetName?: string }) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour " +
    (props.prenom || "") +
    ",</p>" +
    "<p>Suite a notre echange, je reviens vers vous pour lancer l'etude de votre assurance de pret.</p>" +
    "<p>Pour vous proposer les meilleures conditions, j'ai besoin des elements suivants :</p>" +
    "<ul>" +
    "<li>Votre offre de pret (ou a defaut le tableau d'amortissement)</li>" +
    "<li>Une copie de votre carte d'identite</li>" +
    "<li>Un justificatif de domicile</li>" +
    "<li>Votre date de naissance (sauf si la carte d'identite nous est transmise)</li>" +
    "<li>Si vous etes fumeur ou non</li>" +
    "<li>Votre profession</li>" +
    "<li>Si vous parcourez plus de 20 000 km par an dans le cadre de votre activite</li>" +
    "<li>Toute autre information que vous jugez utile pour cette etude</li>" +
    "</ul>" +
    "<p>Vous pouvez me transmettre l'ensemble de ces elements directement en reponse a ce mail.</p>" +
    "<p>Cordialement,<br/>Erwan Jaffrelot<br/>" +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

function InvitationProfilVieEmail(props: { prenom?: string; cabinetName?: string; lien?: string }) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour " +
    (props.prenom || "") +
    ",</p>" +
    "<p>Suite a votre interet pour la mise en place d'une assurance vie avec les economies realisees sur votre assurance emprunteur, je vous propose de renseigner votre profil epargne avant notre rendez-vous telephonique :</p>" +
    "<p><a href=\"" +
    (props.lien || "") +
    "\">Renseigner mon profil epargne</a></p>" +
    "<p>Cela nous permettra de nous concentrer directement, lors de notre echange, sur la mise en place de votre contrat.</p>" +
    "<p>Cordialement,<br/>Erwan Jaffrelot<br/>" +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

function InvitationSignatureContratMandataireEmail(props: { prenom?: string; cabinetName?: string; lien?: string }) {
  const nom = props.cabinetName || "EJ Partners Assurances";
  const html =
    "<p>Bonjour " +
    (props.prenom || "") +
    ",</p>" +
    "<p>Votre contrat de mandataire avec " +
    nom +
    " est pret a etre signe. Vous pouvez le consulter et le signer directement en ligne :</p>" +
    "<p><a href=\"" +
    (props.lien || "") +
    "\">Consulter et signer mon contrat</a></p>" +
    "<p>Cordialement,<br/>Erwan Jaffrelot<br/>" +
    nom +
    "</p>";
  const style = { fontFamily: "Arial, sans-serif", color: "#1a1a1a", fontSize: "15px", lineHeight: "1.6" };
  return React.createElement("div", { style: style, dangerouslySetInnerHTML: { __html: html } });
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  "invitation-signature-contrat-mandataire": {
    component: InvitationSignatureContratMandataireEmail,
    subject: (data: Record<string, any>) =>
      "Votre contrat mandataire à signer — " + (data && data.reference ? data.reference : ""),
    displayName: "Mandataire - Invitation à signer le contrat interne",
    previewData: { prenom: "Jean", reference: "CM-2026-0001", lien: "https://example.com" },
  },

  "invitation-profil-vie": {
    component: InvitationProfilVieEmail,
    subject: (data: Record<string, any>) =>
      "Votre profil épargne — assurance vie — " + (data && data.reference ? data.reference : ""),
    displayName: "Assurance vie - Invitation à renseigner le profil épargne",
    previewData: { prenom: "Jean", reference: "EJ-2026-VIE-0001", lien: "https://example.com" },
  },

  "prequalification-emprunteur": {
    component: PrequalificationEmprunteurEmail,
    subject: (data: Record<string, any>) =>
      "Votre etude assurance emprunteur — " + (data && data.reference ? data.reference : ""),
    displayName: "Pre-qualification - Assurance emprunteur",
    previewData: { prenom: "Jean", reference: "EJ-2026-EMP-0001" },
  },

  "espace-client-mise-en-place": {
    component: EspaceClientMiseEnPlaceEmail,
    subject: "Votre espace client EJ Partners Assurances — mise à jour de votre dossier",
    displayName: "Espace client - Mise en place (dossier reconstitué)",
    previewData: { prenom: "Jean" },
  },

  "suivi-contrats": {
    component: SuiviContratsEmail,
    subject: "Point sur votre/vos contrat(s) d'assurance — EJ Partners Assurances",
    displayName: "Conseil dans la duree - Point de suivi contrats",
    previewData: {
      prenom: "Jean",
      listeContrats: "votre complementaire sante et votre assurance emprunteur",
    },
  },
  "lien-connexion": {
    component: LienConnexionEmail,
    subject: (data: Record<string, any>) =>
      (data && data.cabinetName ? data.cabinetName : "EJ Partners Assurances") +
      " - Votre lien de connexion a votre espace client",
    displayName: "Espace client - Lien de connexion (renvoi)",
    previewData: {
      clientName: "Jean Dupont",
      email: "jean.dupont@example.com",
      cabinetName: "EJ Partners Assurances",
      link: "https://ejpartners.fr/auth",
    },
  },
  "mot-de-passe-reinitialisation": {
    component: MotDePasseReinitialisationEmail,
    subject: (data: Record<string, any>) =>
      (data && data.cabinetName ? data.cabinetName : "EJ Partners Assurances") +
      " - Definition de votre nouveau mot de passe",
    displayName: "Mot de passe - Reinitialisation",
    previewData: {
      prenom: "Jean",
      cabinetName: "EJ Partners",
      link: "https://ejpartners.fr/reset-password",
    },
  },
  "documents-expiration": {
    component: DocumentsExpirationEmail,
    subject: "Vos documents arrivent a expiration",
    displayName: "Relance - Documents expirant",
    previewData: {
      clientName: "Jean Dupont",
      documents: ["Carte d'identite (valide jusqu'au 01/09/2026)"],
      link: "https://example.com/espace/mon-espace",
    },
  },

  "compte-client-cree": {
    component: CompteClientCreeEmail,
    subject: (data: Record<string, any>) =>
      (data && data.cabinetName ? data.cabinetName : "EJ Partners Assurances") + " - Vos acces a votre espace client",
    displayName: "Espace client - Acces provisoires",
    previewData: {
      clientName: "Jean Dupont",
      email: "jean.dupont@example.com",
      motDePasseProvisoire: "Xk4mQr9pTz2v!7",
      link: "https://example.com/auth",
    },
  },
  "pieces-manquantes": {
    component: PiecesManquantesEmail,
    subject: (data: Record<string, any>) =>
      "Votre dossier " + (data && data.reference ? data.reference : "") + " - pieces manquantes",
    displayName: "Relance - Pieces manquantes",
    previewData: {
      clientName: "Jean Dupont",
      reference: "DOSS-2025-001",
      pieces: ["Piece d'identite", "RIB"],
      link: "https://example.com/espace/mon-espace",
    },
  },
  "der-envoi": {
    component: DerEnvoiEmail,
    subject: (data: Record<string, any>) =>
      (data && data.cabinetName ? data.cabinetName : "EJ Partners Assurances") +
      " - Document d'Entree en Relation (DER)",
    displayName: "DER - Envoi client",
    previewData: {
      clientName: "Jean Dupont",
      cabinetName: "EJ Partners Assurances",
      link: "https://example.com/der.pdf",
    },
  },
  "lettre-mission-envoi": {
    component: LettreMissionEnvoiEmail,
    subject: (data: Record<string, any>) =>
      (data && data.cabinetName ? data.cabinetName : "EJ Partners Assurances") +
      " - Votre lettre de mission",
    displayName: "Lettre de mission - Envoi client",
    previewData: {
      clientName: "Jean Dupont",
      cabinetName: "EJ Partners Assurances",
      reference: "DOSS-2025-001",
      link: "https://example.com/signer",
    },
  },
  "devoir-conseil-envoi": {
    component: DevoirConseilEnvoiEmail,
    subject: (data: Record<string, any>) =>
      (data && data.cabinetName ? data.cabinetName : "EJ Partners Assurances") +
      " - Votre devoir de conseil",
    displayName: "Devoir de conseil - Envoi client",
    previewData: {
      clientName: "Jean Dupont",
      cabinetName: "EJ Partners Assurances",
      reference: "DOSS-2025-001",
      link: "https://example.com/signer-devoir-conseil",
    },
  },
  "souscription-compagnie": {
    component: SouscriptionCompagnieEmail,
    subject: (data: Record<string, any>) =>
      "Demande de souscription - dossier " + (data && data.reference ? data.reference : ""),
    displayName: "Souscription - Envoi compagnie",
    previewData: {
      compagnieName: "April",
      cabinetName: "EJ Partners Assurances",
      reference: "DOSS-2025-001",
      clientName: "Jean Dupont",
      produit: "Emprunteur Solution",
      branche: "Assurance emprunteur",
    },
  },
  "souscription-relance-compagnie": {
    component: SouscriptionRelanceEmail,
    subject: (data: Record<string, any>) =>
      "Relance - demande de souscription dossier " + (data && data.reference ? data.reference : ""),
    displayName: "Souscription - Relance compagnie",
    previewData: {
      cabinetName: "EJ Partners Assurances",
      reference: "DOSS-2025-001",
      clientName: "Jean Dupont",
      produit: "Emprunteur Solution",
      jours: 3,
    },
  },
  "souscription-signature-client": {
    component: SouscriptionSignatureClientEmail,
    subject: (data: Record<string, any>) =>
      (data && data.cabinetName ? data.cabinetName : "EJ Partners Assurances") +
      " - Signature de vos documents de souscription",
    displayName: "Souscription - Signature client",
    previewData: {
      clientName: "Jean Dupont",
      cabinetName: "EJ Partners Assurances",
      link: "https://example.com/espace/signer-souscription",
    },
  },
  "relation-client-reponse": {
    component: RelationClientReponseEmail,
    subject: (data: Record<string, any>) =>
      (data && data.titre ? data.titre : "Votre demande") +
      " - " +
      (data && data.cabinetName ? data.cabinetName : "EJ Partners Assurances"),
    displayName: "Relation client - Reponse automatique",
    previewData: {
      clientName: "Jean Dupont",
      cabinetName: "EJ Partners Assurances",
      titre: "Les informations de votre contrat en cours",
      paragraphes: ["Vous trouverez ci-dessous les informations de votre contrat en cours."],
      lignes: [
        { libelle: "Numero de contrat", valeur: "C-2025-001" },
        { libelle: "Cotisation annuelle", valeur: "480,00 EUR" },
      ],
    },
  },
};
