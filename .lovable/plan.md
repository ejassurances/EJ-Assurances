# Frais de distribution et barèmes de commission compagnie

Audit lecture seule fait. Rien n'a été modifié. Ce plan attend votre accord.

## Ce qui existe déjà
- `commission_bareme` : un barème par branche ou par branche + compagnie, fixe ou en %, base « prime » ou « économie réalisée ». Il ne gère ni le précompte, ni de dates d'effet, ni d'historique, et un seul barème est permis par compagnie et branche.
- `contrats` contient déjà `mode_commissionnement` (precompte / lineaire / degressif), `duree_mois`, `economie_realisee`, `economie_cout_groupe` et `economie_cout_delegue`.
- `commission_previsions` : une ligne par dossier. Elle est mise à jour au fil des commissions versées (la table `commissions`).
- `finance_revenus` distingue déjà les types `commission` et `frais_distribution`.
- Risque repéré : aujourd'hui, la règle « 5 % des économies » peut être saisie comme une commission (base « économie réalisée »). Cela mélange les frais de distribution et la commission, ce que vous voulez éviter.
- Écrans : `commission-bareme-config.tsx`, `compagnie-taux-commission.tsx` (fiche compagnie), `commission-contrat-card.tsx`.

## Ce que je propose
1. **Règle de calcul unique** dans `src/lib/remuneration-contrat.ts`, partagée par les tests et les écrans :
   - emprunteur : frais = économie totale sur toute la durée × 5 %. Si l'économie ou la durée manque, ou si les chiffres se contredisent, le statut est « à vérifier » et aucun montant n'est affiché ;
   - assurance vie : 0 € ;
   - autres contrats : 20 €.
   - commission linéaire : même taux appliqué à la prime de chaque année ;
   - commission en précompte : un taux pour l'année 1 et un autre pour les années suivantes ;
   - sans barème applicable : « non calculable — barème à configurer ».
2. **Migration versionnée, sans rien supprimer** :
   - ajout dans `commission_bareme` de `mode` (lineaire / precompte), `taux_annee_1`, `taux_renouvellement`, `date_effet`, `date_fin` et `produit_id` (facultatif) ;
   - remplacement des index uniques actuels par une règle « pas de périodes qui se chevauchent » pour la même compagnie, branche et produit. On garde ainsi l'historique des barèmes ;
   - nouvelle table `contrat_remuneration_previsionnelle` : une ligne par contrat, par type (frais / commission) et par année. Elle garde une trace du barème utilisé et de sa version, avec une clé unique qui empêche les doublons ;
   - fonction `recalculer_remuneration_contrat(contrat_id)`. Elle remplace seulement les lignes prévisionnelles et ne touche jamais `commissions`, les paiements ou `finance_revenus` ;
   - recalcul automatique quand on crée ou modifie un contrat, et quand on modifie un barème (pour les contrats concernés).
3. **Interface** :
   - fiche compagnie : formulaire de barème avec le mode, la base de calcul, les taux de l'année 1 et des années suivantes, la périodicité, les dates d'effet et l'historique. Aucun taux n'est pré-rempli ;
   - fiche contrat : deux blocs séparés, « Frais de distribution » et « Commission compagnie (prévisionnelle / versée) ».
   - les barèmes déjà saisis sur la base « économie réalisée » ne sont pas modifiés. Ils seront signalés « à revoir : relève des frais de distribution ».
4. **Tests** (vitest) : emprunteur sur 120, 180 et 240 mois ; 20 € ; 0 € ; linéaire ; précompte ; sans barème ; changement de barème ; changement de durée ; recalcul répété sans doublon.

## Points à confirmer
- Assiette « économie totale » : je prends `economie_realisee` si elle est remplie, sinon (coût groupe − coût délégué). Si les deux existent et ne concordent pas, le statut est « à vérifier ». Est-ce correct ?
- La base de données était en pause lors du dernier contrôle. Elle doit être relancée pour appliquer la migration.
- D'après la règle « un chantier à la fois », d'autres chantiers sont encore ouverts (contrats UGIP, nomenclatures, import portefeuille). Je les laisse en attente pendant celui-ci.
