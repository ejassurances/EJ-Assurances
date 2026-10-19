import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { IconShieldLock } from "@tabler/icons-react";

export const Route = createFileRoute("/espace/confidentialite")({
  head: () => ({
    meta: [
      { title: "Politique de confidentialité — EJ Partners Assurances" },
      {
        name: "description",
        content:
          "Politique de confidentialité de la plateforme client EJ Partners Assurances : finalités, destinataires, durées de conservation et droits RGPD.",
      },
      { property: "og:title", content: "Politique de confidentialité — EJ Partners Assurances" },
      {
        property: "og:description",
        content:
          "Traitement des données personnelles de la plateforme client EJ Partners Assurances : bases légales, destinataires et droits RGPD.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Confidentialite,
});

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink">{titre}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

function Confidentialite() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <PageHeader
        eyebrow="Protection des données"
        title="Politique de confidentialité"
        description="Comment nous collectons, utilisons et protégeons vos données personnelles."
        icon={IconShieldLock}
      />

      <Bloc titre="Responsable de traitement">
        <p>
          EJ Partners Assurances, courtier en assurance immatriculé à l'ORIAS sous le n° 25005811, 71 Rue du Docteur
          Roux, 95600 Eaubonne, est responsable du traitement des données personnelles collectées via cette
          plateforme.
        </p>
      </Bloc>

      <Bloc titre="Finalités et base légale">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Gestion de la relation commerciale et étude des besoins d'assurance — exécution des mesures
            précontractuelles et du contrat de courtage (article 6.1.b du RGPD)
          </li>
          <li>
            Respect des obligations légales et réglementaires du courtier (devoir de conseil, lutte contre le
            blanchiment et le financement du terrorisme, conservation des preuves DDA) — obligation légale (article
            6.1.c)
          </li>
          <li>
            Gestion de l'espace client et de son accès sécurisé — exécution du contrat de service (article 6.1.b)
          </li>
          <li>
            Amélioration du service et statistiques internes — intérêt légitime du cabinet (article 6.1.f)
          </li>
        </ul>
      </Bloc>

      <Bloc titre="Données collectées">
        <p>
          Identité, coordonnées, situation familiale et professionnelle, données relatives au projet d'assurance
          (montants, garanties souhaitées), pièces justificatives déposées dans l'espace client. Aucune donnée de
          santé n'est collectée ou traitée par le cabinet : le questionnaire médical, lorsqu'il est requis, est géré
          directement entre le client et l'assureur.
        </p>
      </Bloc>

      <Bloc titre="Destinataires des données">
        <ul className="list-disc space-y-1 pl-5">
          <li>Le personnel habilité du cabinet EJ Partners Assurances</li>
          <li>
            Les compagnies d'assurance partenaires, dans la limite nécessaire à l'étude et à la souscription du
            contrat
          </li>
          <li>
            Les prestataires techniques utilisés par la plateforme : Cloudflare (hébergement et exécution), Supabase
            (authentification, base de données et stockage), Google (Gmail, Drive et, lorsque l'IA est activée,
            Gemini) et Brevo (emails transactionnels).
          </li>
        </ul>
        <p>Aucune donnée n'est vendue ni cédée à des fins commerciales tierces.</p>
      </Bloc>

      <Bloc titre="Recours à l'intelligence artificielle">
        <p>
          Dans le cadre de son activité, le cabinet peut recourir à des outils d'intelligence artificielle pour
          l'aide à l'analyse de documents (conditions générales, tableaux de garanties) et à la préparation de
          certains documents (devoir de conseil, comparatifs d'offres). Ces traitements sont systématiquement soumis
          à la validation d'un collaborateur habilité du cabinet avant toute utilisation ou envoi : l'intelligence
          artificielle assiste le conseil, elle ne se substitue jamais à la décision humaine. Ces outils sont
          fournis via l'API Gemini de Google lorsque cette intégration est activée.
        </p>
      </Bloc>

      <Bloc titre="Durée de conservation">
        <p>
          Les données sont conservées pendant la durée de la relation commerciale, puis archivées pendant les délais
          imposés par les obligations légales du courtier (notamment les délais de prescription applicables en
          matière d'assurance et les obligations de conservation DDA/LCB-FT), avant suppression ou anonymisation.
        </p>
      </Bloc>

      <Bloc titre="Droits des personnes">
        <p>
          Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation,
          d'opposition et de portabilité de vos données, ainsi que du droit de définir des directives relatives à
          leur sort après votre décès. Ces droits s'exercent par écrit auprès du cabinet à l'adresse
          contact@ej-assurances.fr. Vous disposez également du droit d'introduire une réclamation auprès de la CNIL
          (www.cnil.fr).
        </p>
      </Bloc>
    </main>
  );
}
