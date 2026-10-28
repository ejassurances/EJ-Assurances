import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

// Types for migrations committed in the repository but not yet present in
// the connected database. This adapter does not create or apply any schema.
type PendingTable<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

type DossierLink = {
  id: string;
  dossier_id_1: string;
  dossier_id_2: string;
  motif: string | null;
  created_at: string;
  created_by: string | null;
};

type MandataireContract = {
  id: string;
  user_id: string;
  reference: string;
  statut: "envoye" | "signe";
  contenu: Json;
  hash: string | null;
  pdf_path: string | null;
  signature_png: string | null;
  signed_at: string | null;
  signed_ip: string | null;
  signed_ua: string | null;
  envoye_le: string;
  created_by: string | null;
  created_at: string;
};

type CrmEmailLabel = {
  message_id: string;
  label: string;
  created_at: string;
};

/** Colonnes ajoutées par docs/pending-migrations/remuneration_contrat.sql (non appliquée). */
export type BaremeVersionneRow = {
  id: string;
  compagnie_id: string | null;
  branche: string;
  produit_id: string | null;
  mode: "lineaire" | "precompte" | null;
  taux_annee_1: number | null;
  taux_renouvellement: number | null;
  date_effet: string | null;
  date_fin: string | null;
  notes: string | null;
};

export type RemunerationPrevRow = {
  id: string;
  cle: string;
  contrat_id: string;
  type: "frais_distribution" | "commission";
  annee: number;
  statut: "calcule" | "a_verifier" | "non_calculable" | "remplace";
  base: number | null;
  taux: number | null;
  montant: number | null;
  motif: string | null;
  bareme_id: string | null;
  bareme_snapshot: Json | null;
  calcule_le: string;
  created_at: string;
};

type PendingDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      dossiers_lies: PendingTable<DossierLink, "dossier_id_1" | "dossier_id_2">;
      mandataires_contrats: PendingTable<MandataireContract, "user_id" | "reference">;
      crm_email_labels: PendingTable<CrmEmailLabel, "message_id" | "label">;
      commission_bareme_versionne: PendingTable<BaremeVersionneRow, "branche">;
      contrat_remuneration_previsionnelle: PendingTable<
        RemunerationPrevRow,
        "cle" | "contrat_id" | "type" | "statut"
      >;
    };
    Functions: Database["public"]["Functions"] & {
      creer_client_manuel_securise: {
        Args: {
          p_client: Json;
          p_user_id: string;
          p_confirmed_duplicate_id?: string | null;
        };
        Returns: Json;
      };
      creer_client_dossier_rapide: {
        Args: {
          p_client: Json;
          p_dossier: Json;
          p_piece_rows: Json;
          p_user_id: string;
          p_confirmed_client_id?: string | null;
        };
        Returns: Json;
      };
    };
  };
};

export function withPendingSchema(client: SupabaseClient<Database>): SupabaseClient<PendingDatabase> {
  return client as unknown as SupabaseClient<PendingDatabase>;
}
