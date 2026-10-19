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

type PendingDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      dossiers_lies: PendingTable<DossierLink, "dossier_id_1" | "dossier_id_2">;
      mandataires_contrats: PendingTable<MandataireContract, "user_id" | "reference">;
      crm_email_labels: PendingTable<CrmEmailLabel, "message_id" | "label">;
    };
    Functions: Database["public"]["Functions"] & {
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
