import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { EmailResume } from "@/lib/gmail.server";
import { estEmailInterne, estAdresseAutomatique } from "@/lib/domaines-internes";
import {
  brancherContexteEmail,
  cloturerContexteEmail,

  creerMetriquesContexte,
  type MetriquesContexte,
} from "@/lib/email-context-branchement.server";


/**
 * Exécution des agents IA (veille, finance, commercial, relation client) sur un
 * lot de messages de la boîte principale. Utilisé à l'ouverture de l'onglet
 * Emails et par le job planifié /api/public/scan-emails.
 */

type Admin = SupabaseClient<Database>;

export interface ResultatAgents {
  dossiers_crees: number;
  factures_creees: number;
  bordereaux_crees: number;
  veilles_creees: number;
  reponses_auto: number;
  brouillons_reponses: number;
  /** Emails dont le traitement automatique (dont l'étiquetage Gmail) a échoué. */
  erreurs: number;
  /** Mails repris via le label parent « Direction Commerciale » (rattrapage manuel). */
  rattrapages_traites: number;
  /** Mails de rattrapage jugés sans importance et mis à la corbeille Gmail. */
  mis_corbeille: number;
  /** Mails routés vers Service Partenaire d'après le domaine expéditeur. */
  partenaires_routes: number;
  /** Pièces jointes partenaires déposées sur la fiche du client identifié. */
  pieces_partenaires_rattachees: number;
  /** Pièces jointes partenaires conservées mais laissées à qualifier par un humain. */
  pieces_partenaires_a_classer: number;
  /** Emails partenaires porteurs d'une information exploitable (codes, offre, MAJ produit, challenge). */
  offres_partenaires: number;
  /** Fiches compagnie créées automatiquement (statut inactif). */
  compagnies_creees: number;
  /** Produits créés automatiquement (statut en test). */
  produits_crees: number;
  /**
   * CD-SI-001-B ACTION 43 — métriques STRICTEMENT ADDITIVES du branchement
   * Lot 2 → Lot 3 (dry-run). Aucun champ historique n'est modifié.
   */
  contexte: MetriquesContexte;



}

/**
 * Rattachement automatique d'un lot de messages : expéditeur connu d'un client,
 * ou domaine d'une compagnie partenaire. Sert au job planifié (l'onglet Emails
 * fait ce rattachement dans son propre flux).
 */
export async function rattacherLot(
  admin: Admin,
  params: { messages: EmailResume[]; userId: string },
): Promise<{ rattaches_client: number; rattaches_compagnie: number }> {
  const { messages, userId } = params;
  const ids = messages.map((m) => m.id);
  if (!ids.length) return { rattaches_client: 0, rattaches_compagnie: 0 };

  const { data: liens } = await admin.from("crm_emails").select("gmail_message_id").in("gmail_message_id", ids);
  const dejaLies = new Set((liens ?? []).map((l) => l.gmail_message_id));

  const [{ data: clients }, { data: compagnies }] = await Promise.all([
    admin.from("clients").select("id, email, email2"),
    admin.from("compagnies").select("id, contact_email, site_web"),
  ]);

  const clientParEmail = new Map<string, string>();
  for (const c of clients ?? []) {
    for (const e of [c.email, c.email2]) if (e) clientParEmail.set(e.toLowerCase().trim(), c.id);
  }
  const domaine = (v: string | null) => {
    if (!v) return null;
    const m = v.toLowerCase().match(/([a-z0-9-]+\.[a-z.]{2,})/);
    return m ? m[1]!.replace(/^www\./, "") : null;
  };
  const compagnieParDomaine = new Map<string, string>();
  for (const cp of compagnies ?? []) {
    for (const d of [domaine(cp.contact_email), domaine(cp.site_web)]) if (d) compagnieParDomaine.set(d, cp.id);
  }

  let rattachesClient = 0;
  let rattachesCompagnie = 0;
  for (const m of messages) {
    if (dejaLies.has(m.id) || !m.expediteur_email) continue;
    const expediteur = m.expediteur_email.toLowerCase().trim();
    const clientId = clientParEmail.get(expediteur) ?? null;
    const compagnieId = clientId ? null : compagnieParDomaine.get(domaine(expediteur) ?? "") ?? null;
    if (!clientId && !compagnieId) continue;

    const { error } = await admin.from("crm_emails").upsert(
      {
        gmail_message_id: m.id,
        gmail_thread_id: m.thread_id ?? null,
        direction: m.etiquettes.includes("SENT") ? "sortant" : "entrant",
        recu_le: m.date ?? null,
        client_id: clientId,
        compagnie_id: compagnieId,
        notes: clientId
          ? "Rattaché automatiquement (tri planifié — email client connu)"
          : "Rattaché automatiquement (tri planifié — domaine compagnie)",
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "gmail_message_id" },
    );
    if (error) {
      console.error("[scan-emails] rattachement", m.id, error.message);
      continue;
    }
    if (clientId) rattachesClient++;
    else rattachesCompagnie++;
  }

  return { rattaches_client: rattachesClient, rattaches_compagnie: rattachesCompagnie };
}


export async function executerAgents(
  admin: Admin,
  params: {
    messages: EmailResume[];
    ids: string[];
    userId: string;
    /**
     * Messages posés manuellement par le staff sur le seul label parent
     * « Direction Commerciale » (filet de rattrapage) : le label est retiré
     * après traitement, et un mail jugé sans importance part à la corbeille.
     */
    rattrapage?: string[];
    /**
     * Nombre maximum de mails traités par catégorie (commercial / relation
     * client) sur un passage. Défaut 5 (cadence normale) ; une valeur plus
     * haute sert au rattrapage d'un retard accumulé.
     */
    limite?: number;
  },
): Promise<ResultatAgents> {
  const { messages, ids } = params;
  const { userId } = params;
  const limite = Math.max(1, Math.min(params.limite ?? 5, 30));
  const rattrapage = new Set(params.rattrapage ?? []);

  // Lot 7 — session parente de journalisation de l'orchestrateur emails
  // (best-effort, jamais bloquant). Les sous-agents (finance, réclamations,
  // sinistres) journalisent déjà leurs actions avec leur propre idempotence.
  let agentRunId: string | null = null;
  try {
    const { demarrerRun } = await import("@/lib/agent-gouvernance.server");
    agentRunId = await demarrerRun(admin, {
      agentName: "emails-orchestrateur",
      triggerType: "batch",
      triggerRef: params.ids[0] ?? null,
      context: { nb_messages: params.messages.length, limite },
    });
  } catch (e) {
    console.error("[agents-emails] run non démarré", e);
  }


    // Agent commercial : les messages entrants qui ne correspondent à aucun
    // client sont analysés par l'IA. Classification confiante -> prospect,
    // dossier, recueil et lettre de mission créés ; sinon suggestion affichée.
    let dossiersCrees = 0;
    let erreurs = 0;
    let corbeille = 0;
    let rattrapagesTraites = 0;
    let partenairesRoutes = 0;
    let piecesPartenairesRattachees = 0;
    let piecesPartenairesAClasser = 0;
    let offresPartenaires = 0;
    let compagniesCreees = 0;
    let produitsCrees = 0;

    // ACTION 43 — compteurs additifs du greffon de branchement (dry-run).
    const metriquesContexte = creerMetriquesContexte();

    // Annuaire des domaines de compagnies / partenaires : sert de garde-fou en
    // amont de toute classification IA prospect ou relation client.
    const { chargerAnnuairePartenaires, compagnieDeExpediteur, routerEmailPartenaire } = await import(
      "@/lib/partenaires-emails.server"
    );
    const { traiterEmailPartenaireOffre } = await import("@/lib/partenaires-offres.server");
    const annuairePartenaires = await chargerAnnuairePartenaires(admin);





    let facturesCreees = 0;
    let bordereauxCrees = 0;
    let veillesCreees = 0;
    const { data: liensApres } = ids.length
      ? await admin.from("crm_emails").select("gmail_message_id, client_id").in("gmail_message_id", ids)
      : { data: [] };
    const avecClient = new Set((liensApres ?? []).filter((l) => l.client_id).map((l) => l.gmail_message_id));

    // Source de vérité du « déjà traité » : les libellés Gmail (« Archives » /
    // « A valider »), pas `triage_ia`. Un mail resté dans la file sans libellé
    // d'état est repris, même si un agent avait déjà écrit une ligne en base
    // (aiguillage, analyse partielle, passage interrompu).
    const candidats = messages.filter(
      (m) => !!m.expediteur_email && !m.etiquettes.includes("SENT") && !avecClient.has(m.id),
    );

    // Aucune reprise depuis la base : la seule source de mails à traiter est la
    // file du service, posée manuellement par le staff.
    const aTrier = candidats.slice(0, limite * 10);


    if (aTrier.length) {
      const { lireMessage } = await import("@/lib/gmail.server");
      const {
        analyserEmailProspect,
        classificationConfiante,
        estPublicite,
        marquerEmailPublicite,
        creerDossierDepuisEmail,
        creerFicheProspectIncertaine,
      } = await import("@/lib/email-triage.server");
      const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
      const { poserLabelCabinet, mettreCorbeille, retirerLabelRattrapage, marquerEtat } = await import(
        "@/lib/gmail.server"
      );
      const { traiterEmailFinance } = await import("@/lib/finance-agent.server");
      const { traiterEmailVeille } = await import("@/lib/veille-reglementaire.server");
      for (const m of aTrier) {
        // ACTION 56 §13.3 : état mémoire d'itération du greffon (jamais persisté).
        let resultatContexte: Awaited<ReturnType<typeof brancherContexteEmail>> | null = null;
        try {
          const detail = await lireMessage(m.id);
          const entree = {
            sujet: detail.sujet ?? null,
            expediteur_nom: detail.expediteur_nom ?? null,
            expediteur_email: detail.expediteur_email ?? null,
            texte: detail.texte ?? detail.snippet ?? null,
            pieces_jointes: detail.pieces_jointes.map((p) => ({ nom: p.nom, mime: p.mime })),
          };

          // ── CD-SI-001-B ACTION 43 — POINT D'INSERTION UNIQUE DU BRANCHEMENT
          // Lot 2 → Lot 3 (dry-run strict). Placé après `lireMessage(m.id)`
          // (corps complet disponible, AUCUN appel Gmail supplémentaire) et
          // AVANT tout `continue` métier, de sorte que chaque message du lot
          // passe exactement une fois devant le greffon. `try/catch` DÉDIÉ :
          // une erreur du greffon n'atteint jamais le catch historique, ne crée
          // aucune tâche administrative et n'incrémente jamais `erreurs`.
          try {
            resultatContexte = await brancherContexteEmail({
              gmailMessageId: m.id,
              email: {
                sujet: entree.sujet,
                expediteur_nom: entree.expediteur_nom,
                expediteur_email: entree.expediteur_email,
                texte: entree.texte,
                pieces_jointes: entree.pieces_jointes.map((p) => ({ nom: p.nom })),
              },
              estSortant: m.etiquettes.includes("SENT"),
              metriques: metriquesContexte,
            });
          } catch (e) {
            metriquesContexte.contexte_erreurs++;
            console.error("[branchement-contexte] erreur non capturée", m.id, e);
          }




          // Contrôle du domaine expéditeur AVANT toute classification IA : un
          // email de compagnie / partenaire connu n'est ni un prospect ni une
          // demande client, il part directement en Service Partenaire.
          // « +Simple » est notre fournisseur RC Pro : jamais un partenaire
          // assureur, ses mails relèvent de la Direction Financière (agent finance).
          const { estFournisseurFinance } = await import("@/lib/routage-specifique");
          const compagnieExp = estFournisseurFinance(entree.expediteur_email)
            ? null
            : compagnieDeExpediteur(annuairePartenaires, entree.expediteur_email);
          if (compagnieExp) {

            await routerEmailPartenaire(admin, {
              gmail_message_id: m.id,
              gmail_thread_id: detail.thread_id ?? m.thread_id ?? null,
              recu_le: m.date ?? detail.date ?? null,
              sujet: entree.sujet,
              texte: entree.texte,

              expediteur_email: entree.expediteur_email,
              compagnie: compagnieExp,
              userId,
              nettoyer: true,
            });
            partenairesRoutes++;

            // AGENT AUTONOME — PARTENAIRES / FOURNISSEURS : accusé et réponse de
            // gestion courante rédigés et programmés sans validation humaine.
            // La barrière ACPR / DDA bloque tout acte de distribution.
            {
              const { planifierReponseAutonome } = await import("@/lib/reponse-autonome.server");
              const auto = await planifierReponseAutonome(admin, {
                canal: "partenaire",
                gmail_message_id: m.id,
                gmail_thread_id: detail.thread_id ?? m.thread_id ?? null,
                pieces_jointes: detail.pieces_jointes.length,
                destinataire: entree.expediteur_email ?? null,
                correspondant: compagnieExp.nom ?? entree.expediteur_email ?? "Madame, Monsieur",
                sujet: entree.sujet,
                texte: entree.texte,
                recu_le: m.date ?? detail.date ?? null,
                liens: { compagnie_id: compagnieExp.id ?? null },
              });
              console.info(
                `[agent-autonome] partenaire ${m.id} · ${auto.planifiee ? "programmée" : "refusée"} · ${auto.motif}`,
              );
            }



            // Les pièces jointes d'un mail partenaire appartiennent souvent à un
            // client du cabinet (attestation, avenant…). Gemini lit la pièce,
            // identifie le titulaire et la pièce est déposée / rattachée. Aucune
            // fiche n'est créée : sans certitude, tâche humaine.
            if (detail.pieces_jointes.length > 0) {
              const { traiterPiecesJointesPartenaire } = await import("@/lib/pieces-partenaire.server");
              const pieces = await traiterPiecesJointesPartenaire(admin, {
                gmail_message_id: m.id,
                sujet: entree.sujet,
                texte: entree.texte,
                compagnie: compagnieExp.nom ?? null,
                pieces_jointes: detail.pieces_jointes.map((p) => ({
                  nom: p.nom,
                  mime: p.mime,
                  attachment_id: p.attachment_id,
                })),
                userId,
              }).catch((e: unknown) => {
                console.error("[pieces-partenaire] traitement impossible", m.id, e);
                return null;
              });
              if (pieces) {
                piecesPartenairesRattachees += pieces.rattachees;
                piecesPartenairesAClasser += pieces.a_classer;
                if (pieces.a_classer > 0) await poserLabelCabinet(m.id, "sp_a_traiter");
              }
            }


            // Le mail partenaire contient-il une information exploitable
            // (codes courtier, offre, mise à jour produit, challenge) ? Dans ce
            // cas il repasse en « Service Partenaire/A_Traiter ».
            const offre = await traiterEmailPartenaireOffre(admin, {
              email: entree,
              gmail_message_id: m.id,
              recu_le: m.date ?? detail.date ?? null,
              userId,
              compagnie_connue: compagnieExp,
            }).catch((e: unknown) => {
              console.error("[partenaires-offres] traitement impossible", m.id, e);
              return null;
            });
            if (offre && offre.action !== "ignore") {
              offresPartenaires++;
              if (offre.compagnie_creee) compagniesCreees++;
              produitsCrees += offre.produits_crees.length;
              await poserLabelCabinet(m.id, "sp_a_traiter");
            }

            if (rattrapage.has(m.id)) {
              await retirerLabelRattrapage(m.id);
              rattrapagesTraites++;
            }
            continue;
          }




          // Agent veille réglementaire : newsletter ACPR (aucun traitement CRM
          // commercial ou comptable sur ces mails).
          const veille = await traiterEmailVeille(admin, {
            email: entree,
            gmail_message_id: m.id,
            recu_le: m.date ?? null,
            userId: userId,
          });
          if (veille.action !== "ignore") {
            veillesCreees++;
            await admin.from("crm_emails").upsert(
              {
                gmail_message_id: m.id,
                gmail_thread_id: m.thread_id ?? null,
                direction: "entrant",
                recu_le: m.date ?? null,
                notes: `Agent veille réglementaire — ${veille.impact_assurance ? "impact assurance" : "non impacté"}`,
                triage_ia: JSON.parse(JSON.stringify({ agent: "veille", ...veille })),
                triage_le: new Date().toISOString(),
                created_by: userId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "gmail_message_id" },
            );
            // Traitement terminé : « Archives » (le libellé de direction posé
            // par le staff reste en place).
            await marquerEtat(m.id, "archives");
            if (rattrapage.has(m.id)) {
              await retirerLabelRattrapage(m.id);
              rattrapagesTraites++;
            }
            continue;

          }

          // Agent finance ensuite : facture fournisseur ou bordereau de
          // commissions. Si ce n'est pas du ressort de la finance, le tri
          // prospect (agent commercial) prend la suite.
          const finance = await traiterEmailFinance(admin, {
            email: {
              ...entree,
              pieces_jointes: detail.pieces_jointes.map((p) => ({
                nom: p.nom,
                mime: p.mime,
                attachment_id: p.attachment_id,
              })),
            },
            gmail_message_id: m.id,
            recu_le: m.date ?? null,
            userId: userId,
          });
          if (finance.action !== "ignore") {
            if (finance.action === "facture_creee") facturesCreees++;
            if (finance.action === "bordereau_cree") bordereauxCrees++;
            await admin.from("crm_emails").upsert(
              {
                gmail_message_id: m.id,
                gmail_thread_id: m.thread_id ?? null,
                direction: "entrant",
                recu_le: m.date ?? null,
                notes: `Agent finance — ${finance.categorie} (${finance.action})`,
                triage_ia: JSON.parse(JSON.stringify({ agent: "finance", ...finance })),
                triage_le: new Date().toISOString(),
                created_by: userId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "gmail_message_id" },
            );
            // Facture / bordereau enregistré : « Archives ».
            await marquerEtat(m.id, "archives");
            if (rattrapage.has(m.id)) {
              await retirerLabelRattrapage(m.id);
              rattrapagesTraites++;
            }
            continue;

          }

          // Agent Service Partenaire — expéditeur INCONNU de l'annuaire : le
          // mail peut malgré tout apporter une information exploitable (codes
          // courtier, offre de partenariat, mise à jour produit, challenge).
          // Dans ce cas la compagnie et ses produits sont référencés (inactif /
          // en test), une tâche décrit l'ajout, et le mail n'est JAMAIS ignoré.
          const offreInconnue = await traiterEmailPartenaireOffre(admin, {
            email: entree,
            gmail_message_id: m.id,
            recu_le: m.date ?? detail.date ?? null,
            userId,
          }).catch((e: unknown) => {
            console.error("[partenaires-offres] traitement impossible", m.id, e);
            return null;
          });
          if (offreInconnue && offreInconnue.action !== "ignore") {
            offresPartenaires++;
            if (offreInconnue.compagnie_creee) compagniesCreees++;
            produitsCrees += offreInconnue.produits_crees.length;
            await poserLabelCabinet(m.id, "sp_a_traiter");
            if (rattrapage.has(m.id)) {
              await retirerLabelRattrapage(m.id);
              rattrapagesTraites++;
            }
            continue;
          }



          // Garde-fou INTERNE : un mail envoyé depuis une adresse du cabinet
          // (transfert, note interne) n'est jamais un prospect. Aucune fiche
          // client, aucun dossier : on dépose une tâche d'arbitrage humain.
          const estInterne = estEmailInterne(entree.expediteur_email);
          const estAutomate = !estInterne && estAdresseAutomatique(entree.expediteur_email);

          // EXCEPTION offre de prêt : un mail (même interne, ex. transfert par
          // le dirigeant) portant une offre de prêt ou un tableau
          // d'amortissement alimente le métier — dossier emprunteur créé ou
          // complété, pièces archivées, tâche de vérification humaine.
          if (detail.pieces_jointes.length > 0) {
            const { traiterOffrePretEmail } = await import("@/lib/offre-pret-email.server");
            const pret = await traiterOffrePretEmail(admin, {
              gmail_message_id: m.id,
              sujet: entree.sujet,
              expediteur_email: entree.expediteur_email,
              pieces_jointes: detail.pieces_jointes.map((p) => ({
                nom: p.nom,
                mime: p.mime,
                attachment_id: p.attachment_id,
              })),
              userId,
            });
            if (pret.action !== "ignore") {
              await admin.from("crm_emails").upsert(
                {
                  gmail_message_id: m.id,
                  gmail_thread_id: detail.thread_id ?? m.thread_id ?? null,
                  dossier_id: pret.dossier_id,
                  direction: "entrant",
                  recu_le: m.date ?? detail.date ?? null,
                  notes: pret.motif,
                  triage_ia: JSON.parse(
                    JSON.stringify({ agent: "offre_pret", action: pret.action, documents: pret.documents }),
                  ),
                  triage_le: new Date().toISOString(),
                  created_by: userId,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "gmail_message_id" },
              );
              await marquerEtat(m.id, "a_valider");
              if (rattrapage.has(m.id)) {
                await retirerLabelRattrapage(m.id);
                rattrapagesTraites++;
              }
              continue;
            }
          }

          if (estInterne || estAutomate) {
            await creerTacheAdmin(admin, {
              titre: `${estInterne ? "Mail interne" : "Expéditeur automatique non répertorié"} à qualifier — ${entree.sujet ?? "(sans objet)"}`.slice(0, 200),
              description: [
                `Objet de la demande : ${entree.sujet ?? "(sans objet)"}`,
                estInterne
                  ? `Motif : mail envoyé depuis une adresse interne du cabinet (${entree.expediteur_email}) — probable transfert.`
                  : `Motif : adresse automatique d'un domaine NON répertorié (${entree.expediteur_email}) — ni partenaire connu, ni client. À répertorier si c'est un partenaire.`,
                `Ce qui bloque : aucun agent ne peut décider à partir d'un expéditeur interne (ni prospect, ni client, ni partenaire identifiable automatiquement).`,
                `Conseil : ouvrir le mail et indiquer la suite à donner (rattacher au client concerné, transmettre au service partenaire, ou saisir en comptabilité). Aucune fiche client n'a été créée.`,
                `Email : https://mail.google.com/mail/u/0/#all/${m.id}`,
              ].join("\n"),
              priorite: "normale",
              created_by: userId,
            });
            await admin.from("crm_emails").upsert(
              {
                gmail_message_id: m.id,
                gmail_thread_id: detail.thread_id ?? m.thread_id ?? null,
                direction: "entrant",
                recu_le: m.date ?? detail.date ?? null,
                notes: estInterne
                  ? "Mail interne (expéditeur du cabinet) — aucune fiche client créée"
                  : "Expéditeur automatique d'un domaine non répertorié — à qualifier (aucune fiche client créée)",
                triage_ia: JSON.parse(
                  JSON.stringify({ agent: estInterne ? "interne" : "automate_non_repertorie", expediteur: entree.expediteur_email, sujet: entree.sujet }),
                ),
                triage_le: new Date().toISOString(),
                created_by: userId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "gmail_message_id" },
            );
            // Arbitrage humain attendu (tâche créée) : « A valider ».
            await marquerEtat(m.id, "a_valider");
            if (rattrapage.has(m.id)) {
              await retirerLabelRattrapage(m.id);
              rattrapagesTraites++;
            }
            continue;
          }

          // LOT 1 — analyse d'intention AVANT toute décision de statut.
          const { analyserIntentionEmail } = await import("@/lib/email-intention.server");
          const analyseGemini = await analyserIntentionEmail({
            sujet: entree.sujet,
            expediteur_nom: entree.expediteur_nom,
            expediteur_email: entree.expediteur_email,
            texte: entree.texte,
            pieces_jointes: detail.pieces_jointes.map((p) => ({ nom: p.nom })),
          });

          const triage = await analyserEmailProspect(entree);

          // Le libellé de service a déjà été posé manuellement par le staff :
          // l'agent ne fait que faire évoluer le sous-état du mail.

          if (estPublicite(triage)) {
            // Publicité / newsletter / spam : ni fiche client, ni tâche.
            await marquerEmailPublicite(admin, {
              email: entree,
              triage,
              gmail_message_id: m.id,
              gmail_thread_id: m.thread_id ?? null,
              recu_le: m.date ?? null,
              userId: userId,
            });
            if (rattrapage.has(m.id)) {
              // Rattrapage manuel + mail sans importance : corbeille Gmail.
              await mettreCorbeille(m.id);
              corbeille++;
              console.info(
                `[rattrapage] mail sans importance mis à la corbeille — id=${m.id} · expéditeur=${
                  m.expediteur_email ?? "inconnu"
                } · objet=${m.sujet ?? "(sans objet)"} · analyse=${triage.prospect} — ${triage.resume}`,
              );
            } else {
              await poserLabelCabinet(m.id, "a_ignorer", { retirer: ["gc_a_traiter"] });
            }
          } else if (classificationConfiante(triage)) {
            await creerDossierDepuisEmail(admin, {
              email: entree,
              triage,
              gmail_message_id: m.id,
              gmail_thread_id: m.thread_id ?? null,
              recu_le: m.date ?? null,
              userId: userId,
            });
            dossiersCrees++;
            // Traitement automatique complet : prospect traité par l'IA.
            await poserLabelCabinet(m.id, "gc_archive", { retirer: ["gc_a_traiter"] });
          } else {
            // Classification incertaine : fiche prospect + LCB-FT + tâche
            // humaine de qualification, mais aucun dossier créé.
            await creerFicheProspectIncertaine(admin, {
              email: entree,
              triage,
              gmail_message_id: m.id,
              gmail_thread_id: m.thread_id ?? null,
              recu_le: m.date ?? null,
              userId: userId,
            });
            // Qualification humaine attendue : décision prise par le moteur CRM
            // (expéditeur non identifié ou analyse incertaine → « A valider »).
            const { deciderStatutEmail } = await import("@/lib/email-decision");
            const decision = deciderStatutEmail({
              analyse: analyseGemini,
              client_id: null,
              action_executee: false,
            });
            await marquerEtat(m.id, decision.etat);
            await admin
              .from("crm_emails")
              .update({
                triage_ia: JSON.parse(
                  JSON.stringify({
                    agent: "commercial",
                    triage,
                    analyse_gemini: analyseGemini,
                    decision_crm: decision,
                  }),
                ),
                triage_le: new Date().toISOString(),
              })
              .eq("gmail_message_id", m.id);
            console.info(
              `[decision-crm] ${m.id} · intention=${analyseGemini?.intention ?? "indisponible"} · statut=${
                decision.statut_metier
              } · etat=${decision.etat} · source=${decision.source}`,
            );
          }
          if (rattrapage.has(m.id)) {
            await retirerLabelRattrapage(m.id);
            rattrapagesTraites++;
          }

        } catch (e) {
          erreurs++;
          console.error("[agent-commercial] triage email", m.id, e);
          // Aucune étape ne doit échouer silencieusement : une tâche décrit l'erreur.
          await creerTacheAdmin(admin, {
            titre: `Traitement automatique d'un email entrant impossible — ${m.expediteur_email ?? "expéditeur inconnu"}`,
            description: [
              `Objet : ${m.sujet ?? "(sans objet)"}`,
              `Erreur : ${e instanceof Error ? e.message : "erreur inconnue"}`,
              "Email à qualifier manuellement depuis l'onglet Emails.",
            ].join("\n"),
            created_by: userId,
          });
        } finally {
          // ── CD-SI-001-B ACTION 56 §13.3-4/§13.7 — CLÔTURE DU GREFFON.
          // Dernière étape LOGIQUE DU GREFFON, exécutée même après un `continue`
          // métier. Une seule seconde LECTURE `SELECT crm_emails`, réutilisation
          // du même detail Gmail (jamais de second `lireMessage`), aucune
          // écriture. `try/catch` dédié : jamais le catch historique.
          try {
            await cloturerContexteEmail(resultatContexte, metriquesContexte);
          } catch (e) {
            metriquesContexte.contexte_erreurs++;
            console.error("[branchement-contexte] erreur non capturée (clôture)", m.id, e);
          }
        }

      }

    }

    // Agent relation client : emails rattachés à un client existant et pas
    // encore analysés. Niveau 0 (sinistre/réclamation/santé/paiement) -> tâche
    // urgente ; niveau 1 -> réponse automatique cadrée ; sinon brouillon.
    //
    // Le rattachement (rattacherLot, ou création de fiche par l'agent
    // commercial) va plus vite que l'analyse : on reprend donc TOUS les mails
    // rattachés à un client dont l'agent relation client n'a pas encore
    // tourné, indépendamment du lot Gmail courant. Un `triage_ia` posé par un
    // autre agent (commercial, finance, veille) ne compte pas comme analyse
    // relation client. Borne de travail par passage : `limite * 10`.
    let reponsesAuto = 0;
    let brouillons = 0;
    const plafondClient = Math.max(limite, limite * 10);
    type LienClient = {
      gmail_message_id: string;
      client_id: string;
      triage_ia: { agent?: string } | null;
      direction: string | null;
    };
    const { data: liensClients } = await admin
      .from("crm_emails")
      .select("gmail_message_id, client_id, triage_ia, direction, recu_le")
      .not("client_id", "is", null)
      .neq("direction", "sortant")
      .order("recu_le", { ascending: true, nullsFirst: false })
      .limit(500);

    const analyseFaite = (l: LienClient) => {
      const agent = (l.triage_ia as { agent?: string } | null)?.agent;
      // Un mail déjà routé « partenaire » ne repasse jamais par l'agent client.
      return agent === "relation_client" || agent === "partenaire";
    };


    // Un mail encore présent dans la file du service (donc sans libellé d'état)
    // est repris même si `triage_ia` porte déjà une analyse : les libellés Gmail
    // sont la source de vérité du traitement.
    const dansLaFile = new Set(messages.map((m) => m.id));
    const aRepondre = ((liensClients ?? []) as unknown as LienClient[])
      .filter(
        (l) =>
          !analyseFaite(l) || rattrapage.has(l.gmail_message_id) || dansLaFile.has(l.gmail_message_id),
      )
      .filter((l) => {
        // Un mail sortant du lot courant est exclu ; les mails hors lot sont
        // repris (leur direction en base a déjà été filtrée).
        const m = messages.find((x) => x.id === l.gmail_message_id);
        return !m || !m.etiquettes.includes("SENT");
      })
      .sort((a, b) => Number(rattrapage.has(b.gmail_message_id)) - Number(rattrapage.has(a.gmail_message_id)))
      .slice(0, plafondClient);

    if (aRepondre.length) {
      const { lireMessage, retirerLabelRattrapage: retirerRattrapageClient } = await import("@/lib/gmail.server");
      const { traiterEmailClient } = await import("@/lib/relation-client.server");
      const { analyserIntentionEmail } = await import("@/lib/email-intention.server");
      const { deciderStatutEmail } = await import("@/lib/email-decision");
      const { creerTacheAdmin } = await import("@/lib/agent-taches.server");

      for (const lien of aRepondre) {
        const messageId = lien.gmail_message_id;
        const resume = messages.find((x) => x.id === messageId) ?? null;
        try {
          const detail = await lireMessage(messageId);

          // Garde-fou : même rattaché à un client, un email envoyé par une
          // compagnie / partenaire connu ne doit pas être traité comme une
          // demande client (aucun brouillon de réponse généré).
          const compagniePart = compagnieDeExpediteur(annuairePartenaires, detail.expediteur_email);
          if (compagniePart) {
            await routerEmailPartenaire(admin, {
              gmail_message_id: messageId,
              gmail_thread_id: detail.thread_id ?? resume?.thread_id ?? null,
              recu_le: detail.date ?? resume?.date ?? null,
              sujet: detail.sujet ?? null,
              texte: detail.texte ?? detail.snippet ?? null,

              expediteur_email: detail.expediteur_email ?? null,
              compagnie: compagniePart,
              userId,
              nettoyer: true,
            });
            partenairesRoutes++;
            if (rattrapage.has(messageId)) {
              await retirerRattrapageClient(messageId);
              rattrapagesTraites++;
            }
            continue;
          }

          // LOT 1 — ANALYSE AVANT DÉCISION : Gemini analyse le contenu du mail
          // (intention, confiance, éléments détectés) avant que le CRM ne
          // choisisse le statut. Gemini n'exécute rien et ne décide rien.
          const entreeIntention = {
            sujet: detail.sujet ?? null,
            expediteur_nom: detail.expediteur_nom ?? null,
            expediteur_email: detail.expediteur_email ?? null,
            texte: detail.texte ?? detail.snippet ?? null,
            pieces_jointes: detail.pieces_jointes.map((p) => ({ nom: p.nom })),
          };
          const analyseGemini = await analyserIntentionEmail(entreeIntention);

          const resultat = await traiterEmailClient(admin, {

            client_id: lien.client_id,
            email: {
              sujet: detail.sujet ?? null,
              expediteur_nom: detail.expediteur_nom ?? null,
              expediteur_email: detail.expediteur_email ?? null,
              texte: detail.texte ?? detail.snippet ?? null,
              pieces_jointes: detail.pieces_jointes.map((p) => ({
                nom: p.nom,
                mime: p.mime,
                attachment_id: p.attachment_id,
              })),
            },
            gmail_message_id: messageId,
            gmail_thread_id: detail.thread_id ?? resume?.thread_id ?? null,
            userId: userId,
          });
          if (resultat.action === "reponse_envoyee") reponsesAuto++;
          if (resultat.action === "brouillon") brouillons++;

          // AGENT AUTONOME — GESTION COURANTE : quand le CRM n'a produit qu'un
          // brouillon et que la barrière ACPR / DDA l'autorise, la réponse est
          // rédigée et programmée (heures d'ouverture + délai métier 45 min,
          // annulable). Les actes réglementaires restent en validation humaine.
          if (resultat.action === "brouillon") {
            const { planifierReponseAutonome } = await import("@/lib/reponse-autonome.server");
            const auto = await planifierReponseAutonome(admin, {
              canal: "client",
              gmail_message_id: messageId,
              gmail_thread_id: detail.thread_id ?? resume?.thread_id ?? null,
              pieces_jointes: detail.pieces_jointes.length,
              destinataire: detail.expediteur_email ?? null,
              correspondant: detail.expediteur_nom ?? detail.expediteur_email ?? "Madame, Monsieur",
              sujet: detail.sujet ?? null,
              texte: detail.texte ?? detail.snippet ?? null,
              intention: analyseGemini?.intention ?? null,
              confiance: analyseGemini?.confidence ?? null,
              recu_le: detail.date ?? null,
              liens: { client_id: lien.client_id },
            });
            console.info(`[agent-autonome] ${messageId} · ${auto.planifiee ? "programmée" : "refusée"} · ${auto.motif}`);
            if (auto.planifiee) reponsesAuto++;
          }

          // Le projet du client avance seul sur les transitions non réglementaires.
          {
            const { avancerProjetsClient } = await import("@/lib/projet-avancement.server");
            await avancerProjetsClient(admin, { client_id: lien.client_id, par: userId });
          }



          // MOTEUR DE DÉCISION CRM : sécurité → intention → identification →
          // règles métier → libellé Gmail en simple repli. Le libellé
          // « Direction Commerciale » ne provoque plus « A valider » à lui seul.
          const decision = deciderStatutEmail({
            analyse: analyseGemini,
            client_id: lien.client_id,
            contrat_id: null,
            action_executee: resultat.action === "reponse_envoyee" || resultat.action === "rien",
          });

          await admin
            .from("crm_emails")
            .update({
              triage_ia: JSON.parse(
                JSON.stringify({
                  agent: "relation_client",
                  ...resultat,
                  analyse_gemini: analyseGemini,
                  decision_crm: decision,
                }),
              ),
              triage_le: new Date().toISOString(),
            })
            .eq("gmail_message_id", messageId);
          // Sortie de file OBLIGATOIRE : sans libellé d'état le mail serait
          // repris au passage suivant (et un accusé de réception renvoyé).
          {
            const { marquerEtat: marquerEtatClient } = await import("@/lib/gmail.server");
            await marquerEtatClient(messageId, decision.etat).catch((e) =>
              console.error("[agent-relation-client] libellé d'état non posé", messageId, e),
            );
            console.info(
              `[decision-crm] ${messageId} · intention=${analyseGemini?.intention ?? "indisponible"} · statut=${
                decision.statut_metier
              } · etat=${decision.etat} · source=${decision.source}`,
            );
          }

          if (rattrapage.has(messageId)) {
            await retirerRattrapageClient(messageId);
            rattrapagesTraites++;
          }


        } catch (e) {
          erreurs++;
          console.error("[agent-relation-client] traitement email", messageId, e);
          await creerTacheAdmin(admin, {
            titre: `Email client non traité automatiquement — ${resume?.expediteur_email ?? "expéditeur inconnu"}`,
            description: [
              `Objet : ${resume?.sujet ?? "(sans objet)"}`,
              `Identifiant Gmail : ${messageId}`,
              `Erreur : ${e instanceof Error ? e.message : "erreur inconnue"}`,
              "Email à traiter manuellement depuis l'onglet Emails.",
            ].join("\n"),
            client_id: lien.client_id,
            created_by: userId,
          });
        }
      }
    }
  const resultat: ResultatAgents = {
    dossiers_crees: dossiersCrees,
    factures_creees: facturesCreees,
    bordereaux_crees: bordereauxCrees,
    veilles_creees: veillesCreees,
    reponses_auto: reponsesAuto,
    brouillons_reponses: brouillons,
    erreurs,
    rattrapages_traites: rattrapagesTraites,
    mis_corbeille: corbeille,
    partenaires_routes: partenairesRoutes,
    pieces_partenaires_rattachees: piecesPartenairesRattachees,
    pieces_partenaires_a_classer: piecesPartenairesAClasser,
    offres_partenaires: offresPartenaires,
    compagnies_creees: compagniesCreees,
    produits_crees: produitsCrees,
    contexte: metriquesContexte,
  };

  // Lot 7 — synthèse journalisée + clôture de session (best-effort).
  try {
    const { journaliserAction, terminerRun } = await import("@/lib/agent-gouvernance.server");
    await journaliserAction(admin, {
      runId: agentRunId,
      actionType: "traitement_emails",
      status: "executed",
      outputSummary: [
        `dossiers=${resultat.dossiers_crees}`,
        `factures=${resultat.factures_creees}`,
        `bordereaux=${resultat.bordereaux_crees}`,
        `reponses_auto=${resultat.reponses_auto}`,
        `brouillons=${resultat.brouillons_reponses}`,
        `partenaires=${resultat.partenaires_routes}`,
        `erreurs=${resultat.erreurs}`,
      ].join(" · "),
    });
    if (agentRunId) {
      await terminerRun(admin, agentRunId, {
        status: "completed",
        summary: `Passage emails : ${resultat.dossiers_crees} dossier(s), ${resultat.reponses_auto} réponse(s) auto, ${resultat.erreurs} erreur(s)`,
      });
    }
  } catch (e) {
    console.error("[agents-emails] journalisation agent échouée", e);
  }

  return resultat;
}
