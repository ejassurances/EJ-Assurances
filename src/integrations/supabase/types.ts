export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      public_intake_idempotency: {
        Row: {
          endpoint: string
          idempotency_key: string
          status: string
          client_id: string | null
          dossier_ref: string | null
          created_at: string
          completed_at: string | null
        }
        Insert: {
          endpoint: string
          idempotency_key: string
          status?: string
          client_id?: string | null
          dossier_ref?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          endpoint?: string
          idempotency_key?: string
          status?: string
          client_id?: string | null
          dossier_ref?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_intake_idempotency_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      activites: {
        Row: {
          client_id: string
          contenu: string | null
          contrat_id: string | null
          created_at: string
          created_by: string | null
          id: string
          titre: string | null
          type: Database["public"]["Enums"]["activite_type"]
        }
        Insert: {
          client_id: string
          contenu?: string | null
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          titre?: string | null
          type?: Database["public"]["Enums"]["activite_type"]
        }
        Update: {
          client_id?: string
          contenu?: string | null
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          titre?: string | null
          type?: Database["public"]["Enums"]["activite_type"]
        }
        Relationships: [
          {
            foreignKeyName: "activites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activites_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
        ]
      }
      assurance_regles_fiscales: {
        Row: {
          actif: boolean
          code: string
          contribution_fixe: number
          created_at: string
          date_debut: string
          date_fin: string | null
          id: string
          libelle: string
          notes: string | null
          taux: number | null
          unite_contribution: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          contribution_fixe?: number
          created_at?: string
          date_debut: string
          date_fin?: string | null
          id?: string
          libelle: string
          notes?: string | null
          taux?: number | null
          unite_contribution?: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          contribution_fixe?: number
          created_at?: string
          date_debut?: string
          date_fin?: string | null
          id?: string
          libelle?: string
          notes?: string | null
          taux?: number | null
          unite_contribution?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_role: string | null
          created_at: string
          id: string
          metadata: Json | null
          new_data: Json | null
          old_data: Json | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      bibliotheque_cg_clients: {
        Row: {
          avertissements: string | null
          branche: string
          compagnie_nom: string
          created_at: string
          created_by: string | null
          edition_annee: string | null
          famille_code: string | null
          grille_version: number | null
          id: string
          mime_type: string | null
          modele_ia: string | null
          nom_fichier: string | null
          statut: string
          storage_path: string
          updated_at: string
          uploaded_from: string | null
          valeurs: Json
          valeurs_proposees: Json | null
          valide: boolean
          valide_le: string | null
          valide_par: string | null
        }
        Insert: {
          avertissements?: string | null
          branche: string
          compagnie_nom: string
          created_at?: string
          created_by?: string | null
          edition_annee?: string | null
          famille_code?: string | null
          grille_version?: number | null
          id?: string
          mime_type?: string | null
          modele_ia?: string | null
          nom_fichier?: string | null
          statut?: string
          storage_path: string
          updated_at?: string
          uploaded_from?: string | null
          valeurs?: Json
          valeurs_proposees?: Json | null
          valide?: boolean
          valide_le?: string | null
          valide_par?: string | null
        }
        Update: {
          avertissements?: string | null
          branche?: string
          compagnie_nom?: string
          created_at?: string
          created_by?: string | null
          edition_annee?: string | null
          famille_code?: string | null
          grille_version?: number | null
          id?: string
          mime_type?: string | null
          modele_ia?: string | null
          nom_fichier?: string | null
          statut?: string
          storage_path?: string
          updated_at?: string
          uploaded_from?: string | null
          valeurs?: Json
          valeurs_proposees?: Json | null
          valide?: boolean
          valide_le?: string | null
          valide_par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bibliotheque_cg_clients_uploaded_from_fkey"
            columns: ["uploaded_from"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      bordereau_lignes: {
        Row: {
          assiette: number | null
          bordereau_id: string
          brut: Json | null
          client_id: string | null
          client_nom_detecte: string | null
          commission_id: string | null
          confiance: number | null
          contrat_id: string | null
          created_at: string
          dossier_id: string | null
          id: string
          montant: number
          numero_contrat_detecte: string | null
          periode_detectee: string | null
          produit_detecte: string | null
          statut: string
          taux: number | null
          updated_at: string
        }
        Insert: {
          assiette?: number | null
          bordereau_id: string
          brut?: Json | null
          client_id?: string | null
          client_nom_detecte?: string | null
          commission_id?: string | null
          confiance?: number | null
          contrat_id?: string | null
          created_at?: string
          dossier_id?: string | null
          id?: string
          montant?: number
          numero_contrat_detecte?: string | null
          periode_detectee?: string | null
          produit_detecte?: string | null
          statut?: string
          taux?: number | null
          updated_at?: string
        }
        Update: {
          assiette?: number | null
          bordereau_id?: string
          brut?: Json | null
          client_id?: string | null
          client_nom_detecte?: string | null
          commission_id?: string | null
          confiance?: number | null
          contrat_id?: string | null
          created_at?: string
          dossier_id?: string | null
          id?: string
          montant?: number
          numero_contrat_detecte?: string | null
          periode_detectee?: string | null
          produit_detecte?: string | null
          statut?: string
          taux?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bordereau_lignes_bordereau_id_fkey"
            columns: ["bordereau_id"]
            isOneToOne: false
            referencedRelation: "bordereaux_commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bordereau_lignes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bordereau_lignes_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bordereau_lignes_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bordereau_lignes_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      bordereaux_commissions: {
        Row: {
          analyse_avertissement: string | null
          analyse_le: string | null
          assureur: string
          created_at: string
          created_by: string | null
          fichier_nom: string | null
          fichier_path: string | null
          fichier_source: string | null
          id: string
          montant_total: number
          nb_lignes: number
          notes: string | null
          periode: string
          statut: string
          updated_at: string
        }
        Insert: {
          analyse_avertissement?: string | null
          analyse_le?: string | null
          assureur: string
          created_at?: string
          created_by?: string | null
          fichier_nom?: string | null
          fichier_path?: string | null
          fichier_source?: string | null
          id?: string
          montant_total?: number
          nb_lignes?: number
          notes?: string | null
          periode: string
          statut?: string
          updated_at?: string
        }
        Update: {
          analyse_avertissement?: string | null
          analyse_le?: string | null
          assureur?: string
          created_at?: string
          created_by?: string | null
          fichier_nom?: string | null
          fichier_path?: string | null
          fichier_source?: string | null
          id?: string
          montant_total?: number
          nb_lignes?: number
          notes?: string | null
          periode?: string
          statut?: string
          updated_at?: string
        }
        Relationships: []
      }
      cartographie_risques: {
        Row: {
          categorie: string
          created_at: string
          created_by: string | null
          facteur: string
          id: string
          impact: number
          mesures_maitrise: string | null
          niveau_maitrise: number
          probabilite: number
          revise_le: string | null
          risque_residuel: string
          updated_at: string
          version: number
        }
        Insert: {
          categorie: string
          created_at?: string
          created_by?: string | null
          facteur: string
          id?: string
          impact?: number
          mesures_maitrise?: string | null
          niveau_maitrise?: number
          probabilite?: number
          revise_le?: string | null
          risque_residuel?: string
          updated_at?: string
          version?: number
        }
        Update: {
          categorie?: string
          created_at?: string
          created_by?: string | null
          facteur?: string
          id?: string
          impact?: number
          mesures_maitrise?: string | null
          niveau_maitrise?: number
          probabilite?: number
          revise_le?: string | null
          risque_residuel?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      client_conjoint: {
        Row: {
          client_id: string
          created_at: string
          date_naissance: string | null
          fumeur: boolean
          id: string
          nom: string | null
          notes: string | null
          prenom: string | null
          profession: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          date_naissance?: string | null
          fumeur?: boolean
          id?: string
          nom?: string | null
          notes?: string | null
          prenom?: string | null
          profession?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          date_naissance?: string | null
          fumeur?: boolean
          id?: string
          nom?: string | null
          notes?: string | null
          prenom?: string | null
          profession?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_conjoint_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_der_envois: {
        Row: {
          client_id: string
          created_at: string
          der_modele_id: string | null
          document_hash: string | null
          document_url_snapshot: string | null
          email_destinataire: string | null
          envoye_le: string | null
          envoye_par: string | null
          id: string
          notes: string | null
          signature_png: string | null
          signed_at: string | null
          signed_ip: string | null
          signed_ua: string | null
          statut: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          der_modele_id?: string | null
          document_hash?: string | null
          document_url_snapshot?: string | null
          email_destinataire?: string | null
          envoye_le?: string | null
          envoye_par?: string | null
          id?: string
          notes?: string | null
          signature_png?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_ua?: string | null
          statut?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          der_modele_id?: string | null
          document_hash?: string | null
          document_url_snapshot?: string | null
          email_destinataire?: string | null
          envoye_le?: string | null
          envoye_par?: string | null
          id?: string
          notes?: string | null
          signature_png?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_ua?: string | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_der_envois_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_der_envois_der_modele_id_fkey"
            columns: ["der_modele_id"]
            isOneToOne: false
            referencedRelation: "der_modele"
            referencedColumns: ["id"]
          },
        ]
      }
      client_enfants: {
        Row: {
          a_charge: boolean
          client_id: string
          created_at: string
          date_naissance: string | null
          id: string
          notes: string | null
          prenom: string
          updated_at: string
        }
        Insert: {
          a_charge?: boolean
          client_id: string
          created_at?: string
          date_naissance?: string | null
          id?: string
          notes?: string | null
          prenom: string
          updated_at?: string
        }
        Update: {
          a_charge?: boolean
          client_id?: string
          created_at?: string
          date_naissance?: string | null
          id?: string
          notes?: string | null
          prenom?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_enfants_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_entreprise: {
        Row: {
          chiffre_affaires: number | null
          client_id: string
          code_ape: string | null
          created_at: string
          date_creation: string | null
          effectif: number | null
          forme_juridique: string | null
          id: string
          notes: string | null
          raison_sociale: string | null
          siret: string | null
          updated_at: string
        }
        Insert: {
          chiffre_affaires?: number | null
          client_id: string
          code_ape?: string | null
          created_at?: string
          date_creation?: string | null
          effectif?: number | null
          forme_juridique?: string | null
          id?: string
          notes?: string | null
          raison_sociale?: string | null
          siret?: string | null
          updated_at?: string
        }
        Update: {
          chiffre_affaires?: number | null
          client_id?: string
          code_ape?: string | null
          created_at?: string
          date_creation?: string | null
          effectif?: number | null
          forme_juridique?: string | null
          id?: string
          notes?: string | null
          raison_sociale?: string | null
          siret?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_entreprise_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_equipements: {
        Row: {
          client_id: string
          created_at: string
          date_acquisition: string | null
          id: string
          libelle: string
          notes: string | null
          type: string
          updated_at: string
          valeur: number | null
        }
        Insert: {
          client_id: string
          created_at?: string
          date_acquisition?: string | null
          id?: string
          libelle: string
          notes?: string | null
          type: string
          updated_at?: string
          valeur?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string
          date_acquisition?: string | null
          id?: string
          libelle?: string
          notes?: string | null
          type?: string
          updated_at?: string
          valeur?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_equipements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_gel_avoirs: {
        Row: {
          client_id: string
          created_at: string
          drive_file_id: string | null
          drive_url: string | null
          effectue: boolean
          effectue_le: string
          effectue_par: string | null
          id: string
          observations: string | null
          resultat: string
        }
        Insert: {
          client_id: string
          created_at?: string
          drive_file_id?: string | null
          drive_url?: string | null
          effectue?: boolean
          effectue_le?: string
          effectue_par?: string | null
          id?: string
          observations?: string | null
          resultat?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          drive_file_id?: string | null
          drive_url?: string | null
          effectue?: boolean
          effectue_le?: string
          effectue_par?: string | null
          id?: string
          observations?: string | null
          resultat?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_gel_avoirs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_kyc_documents: {
        Row: {
          client_id: string
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          drive_url: string | null
          id: string
          nom: string
          notes: string | null
          rappel_expiration_envoye_le: string | null
          statut: string
          storage_path: string
          type: Database["public"]["Enums"]["client_kyc_type"]
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          date_emission?: string | null
          date_expiration?: string | null
          drive_url?: string | null
          id?: string
          nom: string
          notes?: string | null
          rappel_expiration_envoye_le?: string | null
          statut?: string
          storage_path: string
          type: Database["public"]["Enums"]["client_kyc_type"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          date_emission?: string | null
          date_expiration?: string | null
          drive_url?: string | null
          id?: string
          nom?: string
          notes?: string | null
          rappel_expiration_envoye_le?: string | null
          statut?: string
          storage_path?: string
          type?: Database["public"]["Enums"]["client_kyc_type"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_kyc_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_lcb_verifications: {
        Row: {
          client_id: string
          created_at: string
          fournisseur: string
          id: string
          nb_correspondances: number
          notes: string | null
          requete: Json
          resultats: Json
          score_correspondance: number | null
          statut: string
          type: string
          updated_at: string
          valide_jusqua: string | null
          verifie_le: string
          verifie_par: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          fournisseur?: string
          id?: string
          nb_correspondances?: number
          notes?: string | null
          requete: Json
          resultats?: Json
          score_correspondance?: number | null
          statut?: string
          type: string
          updated_at?: string
          valide_jusqua?: string | null
          verifie_le?: string
          verifie_par?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          fournisseur?: string
          id?: string
          nb_correspondances?: number
          notes?: string | null
          requete?: Json
          resultats?: Json
          score_correspondance?: number | null
          statut?: string
          type?: string
          updated_at?: string
          valide_jusqua?: string | null
          verifie_le?: string
          verifie_par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_lcb_verifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_reponses_ia: {
        Row: {
          categorie: string
          client_id: string
          confiance: number | null
          contrat_id: string | null
          corps: string | null
          created_at: string
          created_by: string | null
          destinataire: string | null
          email_sujet: string | null
          envoye_le: string | null
          envoye_par: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          intention: string | null
          motif: string | null
          motif_signalement: string | null
          objet: string | null
          resume: string | null
          signalee_incorrecte: boolean
          signalee_le: string | null
          signalee_par: string | null
          statut: string
          updated_at: string
        }
        Insert: {
          categorie: string
          client_id: string
          confiance?: number | null
          contrat_id?: string | null
          corps?: string | null
          created_at?: string
          created_by?: string | null
          destinataire?: string | null
          email_sujet?: string | null
          envoye_le?: string | null
          envoye_par?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          intention?: string | null
          motif?: string | null
          motif_signalement?: string | null
          objet?: string | null
          resume?: string | null
          signalee_incorrecte?: boolean
          signalee_le?: string | null
          signalee_par?: string | null
          statut?: string
          updated_at?: string
        }
        Update: {
          categorie?: string
          client_id?: string
          confiance?: number | null
          contrat_id?: string | null
          corps?: string | null
          created_at?: string
          created_by?: string | null
          destinataire?: string | null
          email_sujet?: string | null
          envoye_le?: string | null
          envoye_par?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          intention?: string | null
          motif?: string | null
          motif_signalement?: string | null
          objet?: string | null
          resume?: string | null
          signalee_incorrecte?: boolean
          signalee_le?: string | null
          signalee_par?: string | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_reponses_ia_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_reponses_ia_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
        ]
      }
      client_risque_lcbft: {
        Row: {
          client_id: string
          created_at: string
          decide_le: string | null
          decide_par: string | null
          facteurs: Json
          id: string
          justification: string | null
          niveau_vigilance: string
          ppe_detecte: boolean
          prochaine_revue_le: string | null
          score_risque: number
          statut: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          decide_le?: string | null
          decide_par?: string | null
          facteurs?: Json
          id?: string
          justification?: string | null
          niveau_vigilance?: string
          ppe_detecte?: boolean
          prochaine_revue_le?: string | null
          score_risque?: number
          statut?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          decide_le?: string | null
          decide_par?: string | null
          facteurs?: Json
          id?: string
          justification?: string | null
          niveau_vigilance?: string
          ppe_detecte?: boolean
          prochaine_revue_le?: string | null
          score_risque?: number
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_risque_lcbft_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          adresse: string | null
          apporteur_id: string | null
          besoins: string[]
          civilite: string | null
          client_origine_id: string | null
          code_postal: string | null
          commercial_id: string | null
          complement_adresse: string | null
          conformite_derniere_verif: string | null
          conformite_niveau: string | null
          conformite_prochaine_verif: string | null
          conformite_score: number | null
          created_at: string
          created_by: string | null
          csp: string | null
          date_naissance: string | null
          dda_statut: string
          drive_folder_id: string | null
          drive_folder_url: string | null
          drive_sync_le: string | null
          email: string | null
          email2: string | null
          etiquettes: string[] | null
          fumeur: boolean | null
          id: string
          lieu_naissance: string | null
          marque: string
          metier: string | null
          mobile: string | null
          mobile2: string | null
          nationalite: string | null
          nb_enfants: number | null
          nom: string
          nom_naissance: string | null
          numero_secu: string | null
          origine: Database["public"]["Enums"]["client_origine"] | null
          pays: string | null
          pays_naissance: string | null
          ppe: boolean
          ppe_fonction: string | null
          ppe_pays: string | null
          preference_contact: string | null
          prenom: string | null
          reference: string
          remarque: string | null
          revenus_annuels: number | null
          situation_familiale: string | null
          statut: Database["public"]["Enums"]["client_statut"]
          telephone: string | null
          telephone2: string | null
          updated_at: string
          user_id: string | null
          ville: string | null
          ville_naissance: string | null
        }
        Insert: {
          adresse?: string | null
          apporteur_id?: string | null
          besoins?: string[]
          civilite?: string | null
          client_origine_id?: string | null
          code_postal?: string | null
          commercial_id?: string | null
          complement_adresse?: string | null
          conformite_derniere_verif?: string | null
          conformite_niveau?: string | null
          conformite_prochaine_verif?: string | null
          conformite_score?: number | null
          created_at?: string
          created_by?: string | null
          csp?: string | null
          date_naissance?: string | null
          dda_statut?: string
          drive_folder_id?: string | null
          drive_folder_url?: string | null
          drive_sync_le?: string | null
          email?: string | null
          email2?: string | null
          etiquettes?: string[] | null
          fumeur?: boolean | null
          id?: string
          lieu_naissance?: string | null
          marque?: string
          metier?: string | null
          mobile?: string | null
          mobile2?: string | null
          nationalite?: string | null
          nb_enfants?: number | null
          nom: string
          nom_naissance?: string | null
          numero_secu?: string | null
          origine?: Database["public"]["Enums"]["client_origine"] | null
          pays?: string | null
          pays_naissance?: string | null
          ppe?: boolean
          ppe_fonction?: string | null
          ppe_pays?: string | null
          preference_contact?: string | null
          prenom?: string | null
          reference?: string
          remarque?: string | null
          revenus_annuels?: number | null
          situation_familiale?: string | null
          statut?: Database["public"]["Enums"]["client_statut"]
          telephone?: string | null
          telephone2?: string | null
          updated_at?: string
          user_id?: string | null
          ville?: string | null
          ville_naissance?: string | null
        }
        Update: {
          adresse?: string | null
          apporteur_id?: string | null
          besoins?: string[]
          civilite?: string | null
          client_origine_id?: string | null
          code_postal?: string | null
          commercial_id?: string | null
          complement_adresse?: string | null
          conformite_derniere_verif?: string | null
          conformite_niveau?: string | null
          conformite_prochaine_verif?: string | null
          conformite_score?: number | null
          created_at?: string
          created_by?: string | null
          csp?: string | null
          date_naissance?: string | null
          dda_statut?: string
          drive_folder_id?: string | null
          drive_folder_url?: string | null
          drive_sync_le?: string | null
          email?: string | null
          email2?: string | null
          etiquettes?: string[] | null
          fumeur?: boolean | null
          id?: string
          lieu_naissance?: string | null
          marque?: string
          metier?: string | null
          mobile?: string | null
          mobile2?: string | null
          nationalite?: string | null
          nb_enfants?: number | null
          nom?: string
          nom_naissance?: string | null
          numero_secu?: string | null
          origine?: Database["public"]["Enums"]["client_origine"] | null
          pays?: string | null
          pays_naissance?: string | null
          ppe?: boolean
          ppe_fonction?: string | null
          ppe_pays?: string | null
          preference_contact?: string | null
          prenom?: string | null
          reference?: string
          remarque?: string | null
          revenus_annuels?: number | null
          situation_familiale?: string | null
          statut?: Database["public"]["Enums"]["client_statut"]
          telephone?: string | null
          telephone2?: string | null
          updated_at?: string
          user_id?: string | null
          ville?: string | null
          ville_naissance?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_client_origine_id_fkey"
            columns: ["client_origine_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_bareme: {
        Row: {
          base_calcul: string
          branche: string
          compagnie_id: string | null
          created_at: string
          id: string
          montant_fixe: number | null
          niveau: string
          notes: string | null
          periodicite: string
          taux_pourcentage: number | null
          type: string
          updated_at: string
        }
        Insert: {
          base_calcul: string
          branche: string
          compagnie_id?: string | null
          created_at?: string
          id?: string
          montant_fixe?: number | null
          niveau: string
          notes?: string | null
          periodicite?: string
          taux_pourcentage?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          base_calcul?: string
          branche?: string
          compagnie_id?: string | null
          created_at?: string
          id?: string
          montant_fixe?: number | null
          niveau?: string
          notes?: string | null
          periodicite?: string
          taux_pourcentage?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_bareme_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_previsions: {
        Row: {
          branche: string | null
          compagnie_id: string | null
          confirme_le: string | null
          confirme_par: string | null
          contrat_id: string | null
          created_at: string
          date_estimation: string | null
          dossier_id: string | null
          id: string
          mois_debut_offset: number
          mois_restants_actuels: number | null
          mois_restants_initial: number | null
          montant_mensuel_estime: number | null
          montant_mensuel_reel: number | null
          montant_previsionnel_total: number | null
          periodicite: string
          reduction_courtage_pct: number | null
          statut: string
          updated_at: string
        }
        Insert: {
          branche?: string | null
          compagnie_id?: string | null
          confirme_le?: string | null
          confirme_par?: string | null
          contrat_id?: string | null
          created_at?: string
          date_estimation?: string | null
          dossier_id?: string | null
          id?: string
          mois_debut_offset?: number
          mois_restants_actuels?: number | null
          mois_restants_initial?: number | null
          montant_mensuel_estime?: number | null
          montant_mensuel_reel?: number | null
          montant_previsionnel_total?: number | null
          periodicite?: string
          reduction_courtage_pct?: number | null
          statut?: string
          updated_at?: string
        }
        Update: {
          branche?: string | null
          compagnie_id?: string | null
          confirme_le?: string | null
          confirme_par?: string | null
          contrat_id?: string | null
          created_at?: string
          date_estimation?: string | null
          dossier_id?: string | null
          id?: string
          mois_debut_offset?: number
          mois_restants_actuels?: number | null
          mois_restants_initial?: number | null
          montant_mensuel_estime?: number | null
          montant_mensuel_reel?: number | null
          montant_previsionnel_total?: number | null
          periodicite?: string
          reduction_courtage_pct?: number | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_previsions_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_previsions_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_previsions_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_regles: {
        Row: {
          assiette: string
          beneficiaire_id: string | null
          compagnie_id: string | null
          created_at: string
          date_effet: string
          date_fin: string | null
          famille_id: string | null
          id: string
          notes: string | null
          periodicite: string
          portee: string
          produit_id: string | null
          taux: number
          updated_at: string
        }
        Insert: {
          assiette?: string
          beneficiaire_id?: string | null
          compagnie_id?: string | null
          created_at?: string
          date_effet?: string
          date_fin?: string | null
          famille_id?: string | null
          id?: string
          notes?: string | null
          periodicite?: string
          portee: string
          produit_id?: string | null
          taux: number
          updated_at?: string
        }
        Update: {
          assiette?: string
          beneficiaire_id?: string | null
          compagnie_id?: string | null
          created_at?: string
          date_effet?: string
          date_fin?: string | null
          famille_id?: string | null
          id?: string
          notes?: string | null
          periodicite?: string
          portee?: string
          produit_id?: string | null
          taux?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_regles_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_regles_famille_id_fkey"
            columns: ["famille_id"]
            isOneToOne: false
            referencedRelation: "produit_familles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_regles_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          beneficiaire_id: string
          bordereau_id: string | null
          compte_produit: string
          contrat_id: string | null
          created_at: string
          date_versement: string | null
          dossier_id: string | null
          ecriture_id: string | null
          etat_encaissement: string
          id: string
          montant: number
          notes: string | null
          precomptee: boolean
          provision_reprise: number
          statut: Database["public"]["Enums"]["commission_statut"]
          updated_at: string
        }
        Insert: {
          beneficiaire_id: string
          bordereau_id?: string | null
          compte_produit?: string
          contrat_id?: string | null
          created_at?: string
          date_versement?: string | null
          dossier_id?: string | null
          ecriture_id?: string | null
          etat_encaissement?: string
          id?: string
          montant: number
          notes?: string | null
          precomptee?: boolean
          provision_reprise?: number
          statut?: Database["public"]["Enums"]["commission_statut"]
          updated_at?: string
        }
        Update: {
          beneficiaire_id?: string
          bordereau_id?: string | null
          compte_produit?: string
          contrat_id?: string | null
          created_at?: string
          date_versement?: string | null
          dossier_id?: string | null
          ecriture_id?: string | null
          etat_encaissement?: string
          id?: string
          montant?: number
          notes?: string | null
          precomptee?: boolean
          provision_reprise?: number
          statut?: Database["public"]["Enums"]["commission_statut"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissions_bordereau_id_fkey"
            columns: ["bordereau_id"]
            isOneToOne: false
            referencedRelation: "bordereaux_commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_ecriture_id_fkey"
            columns: ["ecriture_id"]
            isOneToOne: false
            referencedRelation: "ecritures"
            referencedColumns: ["id"]
          },
        ]
      }
      compagnie_documents: {
        Row: {
          compagnie_id: string
          created_at: string
          date_fin: string | null
          date_signature: string | null
          drive_chemin: string | null
          drive_file_id: string | null
          drive_url: string | null
          id: string
          nom: string
          notes: string | null
          reference: string | null
          storage_path: string | null
          type: Database["public"]["Enums"]["compagnie_doc_type"]
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          compagnie_id: string
          created_at?: string
          date_fin?: string | null
          date_signature?: string | null
          drive_chemin?: string | null
          drive_file_id?: string | null
          drive_url?: string | null
          id?: string
          nom: string
          notes?: string | null
          reference?: string | null
          storage_path?: string | null
          type?: Database["public"]["Enums"]["compagnie_doc_type"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          compagnie_id?: string
          created_at?: string
          date_fin?: string | null
          date_signature?: string | null
          drive_chemin?: string | null
          drive_file_id?: string | null
          drive_url?: string | null
          id?: string
          nom?: string
          notes?: string | null
          reference?: string | null
          storage_path?: string | null
          type?: Database["public"]["Enums"]["compagnie_doc_type"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compagnie_documents_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
        ]
      }
      compagnies: {
        Row: {
          api_active: boolean
          contact_email: string | null
          contact_nom: string | null
          contact_telephone: string | null
          created_at: string
          created_by: string | null
          description: string | null
          email_reclamations: string | null
          id: string
          logo_url: string | null
          nom: string
          notes: string | null
          site_web: string | null
          slug: string
          statut: Database["public"]["Enums"]["compagnie_statut"]
          tier_favori: number | null
          type_partenaire: string
          updated_at: string
        }
        Insert: {
          api_active?: boolean
          contact_email?: string | null
          contact_nom?: string | null
          contact_telephone?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          email_reclamations?: string | null
          id?: string
          logo_url?: string | null
          nom: string
          notes?: string | null
          site_web?: string | null
          slug: string
          statut?: Database["public"]["Enums"]["compagnie_statut"]
          tier_favori?: number | null
          type_partenaire?: string
          updated_at?: string
        }
        Update: {
          api_active?: boolean
          contact_email?: string | null
          contact_nom?: string | null
          contact_telephone?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          email_reclamations?: string | null
          id?: string
          logo_url?: string | null
          nom?: string
          notes?: string | null
          site_web?: string | null
          slug?: string
          statut?: Database["public"]["Enums"]["compagnie_statut"]
          tier_favori?: number | null
          type_partenaire?: string
          updated_at?: string
        }
        Relationships: []
      }
      compagnies_api_config: {
        Row: {
          api_auth_type: Database["public"]["Enums"]["api_auth_type"]
          api_base_url: string | null
          api_config: Json
          api_secret_name: string | null
          compagnie_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          api_auth_type?: Database["public"]["Enums"]["api_auth_type"]
          api_base_url?: string | null
          api_config?: Json
          api_secret_name?: string | null
          compagnie_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          api_auth_type?: Database["public"]["Enums"]["api_auth_type"]
          api_base_url?: string | null
          api_config?: Json
          api_secret_name?: string | null
          compagnie_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compagnies_api_config_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: true
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
        ]
      }
      config_labels_gmail: {
        Row: {
          actif: boolean
          adresse: string | null
          id: string
          label_direction: string
          libelle: string
          service_cle: string
          theme: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          adresse?: string | null
          id?: string
          label_direction: string
          libelle: string
          service_cle: string
          theme?: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          adresse?: string | null
          id?: string
          label_direction?: string
          libelle?: string
          service_cle?: string
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      conformite_documents: {
        Row: {
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          id: string
          nom: string
          notes: string | null
          statut: string
          storage_path: string
          type: Database["public"]["Enums"]["conformite_doc_type"]
          updated_at: string
          uploaded_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          date_emission?: string | null
          date_expiration?: string | null
          id?: string
          nom: string
          notes?: string | null
          statut?: string
          storage_path: string
          type: Database["public"]["Enums"]["conformite_doc_type"]
          updated_at?: string
          uploaded_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          date_emission?: string | null
          date_expiration?: string | null
          id?: string
          nom?: string
          notes?: string | null
          statut?: string
          storage_path?: string
          type?: Database["public"]["Enums"]["conformite_doc_type"]
          updated_at?: string
          uploaded_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      consentements_plateforme: {
        Row: {
          accepte_le: string
          adresse_ip: string | null
          client_id: string
          created_at: string
          id: string
          type: string
          updated_at: string
          version_texte: string
        }
        Insert: {
          accepte_le?: string
          adresse_ip?: string | null
          client_id: string
          created_at?: string
          id?: string
          type: string
          updated_at?: string
          version_texte: string
        }
        Update: {
          accepte_le?: string
          adresse_ip?: string | null
          client_id?: string
          created_at?: string
          id?: string
          type?: string
          updated_at?: string
          version_texte?: string
        }
        Relationships: [
          {
            foreignKeyName: "consentements_plateforme_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      contrat_echeances: {
        Row: {
          annee: number
          bordereau_id: string | null
          capital_restant_du_debut: number | null
          commission_cabinet_periode: number
          commission_mandataire_periode: number
          commission_prescripteur_periode: number
          contrat_id: string
          created_at: string
          date_debut_periode: string
          date_fin_periode: string
          id: string
          mandataire_id: string | null
          prescripteur_id: string | null
          prime_periode: number
          statut: string
          updated_at: string
        }
        Insert: {
          annee: number
          bordereau_id?: string | null
          capital_restant_du_debut?: number | null
          commission_cabinet_periode?: number
          commission_mandataire_periode?: number
          commission_prescripteur_periode?: number
          contrat_id: string
          created_at?: string
          date_debut_periode: string
          date_fin_periode: string
          id?: string
          mandataire_id?: string | null
          prescripteur_id?: string | null
          prime_periode?: number
          statut?: string
          updated_at?: string
        }
        Update: {
          annee?: number
          bordereau_id?: string | null
          capital_restant_du_debut?: number | null
          commission_cabinet_periode?: number
          commission_mandataire_periode?: number
          commission_prescripteur_periode?: number
          contrat_id?: string
          created_at?: string
          date_debut_periode?: string
          date_fin_periode?: string
          id?: string
          mandataire_id?: string | null
          prescripteur_id?: string | null
          prime_periode?: number
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contrat_echeances_bordereau_id_fkey"
            columns: ["bordereau_id"]
            isOneToOne: false
            referencedRelation: "bordereaux_commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrat_echeances_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
        ]
      }
      contrat_garanties: {
        Row: {
          contrat_id: string
          created_at: string
          franchise: string | null
          id: string
          montant: number | null
          notes: string | null
          quotite: number | null
          type: string
          updated_at: string
        }
        Insert: {
          contrat_id: string
          created_at?: string
          franchise?: string | null
          id?: string
          montant?: number | null
          notes?: string | null
          quotite?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          contrat_id?: string
          created_at?: string
          franchise?: string | null
          id?: string
          montant?: number | null
          notes?: string | null
          quotite?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contrat_garanties_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
        ]
      }
      contrats: {
        Row: {
          assiette: string | null
          assiette_commission_annuelle: number | null
          assureur: string
          capital_initial: number | null
          client_id: string
          co_emprunteur: Json | null
          commission_cabinet_taux: number | null
          compagnie_id: string | null
          contribution_attentat_annuelle: number
          created_at: string
          created_by: string | null
          date_echeance: string | null
          date_effet: string | null
          dernier_suivi_le: string | null
          devis_source_id: string | null
          dossier_id: string | null
          duree_mois: number | null
          economie_base: Json | null
          economie_calculee_le: string | null
          economie_cout_delegue: number | null
          economie_cout_groupe: number | null
          economie_realisee: number | null
          economie_taux_delegue: number | null
          economie_taux_groupe: number | null
          fiscalite_calculee_le: string | null
          fiscalite_detail: Json | null
          fractionnement: string
          id: string
          import_externe: boolean
          is_emprunteur: boolean
          mandataire_id: string | null
          mode_commissionnement: string
          notes: string | null
          numero: string | null
          prescripteur_id: string | null
          prime_annuelle: number | null
          prime_ht_annuelle: number | null
          prime_nette_annuelle: number | null
          prime_ttc_annuelle: number | null
          prochain_suivi_le: string | null
          produit: string
          produit_id: string | null
          projet_id: string | null
          quotite: number | null
          recommandation_personnalisee: boolean
          regime_fiscal: string
          source_prime_ttc: string | null
          statut: string
          taux_assurance_annuel: number | null
          taux_pret: number | null
          taxes_annuelles: number | null
          updated_at: string
        }
        Insert: {
          assiette?: string | null
          assiette_commission_annuelle?: number | null
          assureur: string
          capital_initial?: number | null
          client_id: string
          co_emprunteur?: Json | null
          commission_cabinet_taux?: number | null
          compagnie_id?: string | null
          contribution_attentat_annuelle?: number
          created_at?: string
          created_by?: string | null
          date_echeance?: string | null
          date_effet?: string | null
          dernier_suivi_le?: string | null
          devis_source_id?: string | null
          dossier_id?: string | null
          duree_mois?: number | null
          economie_base?: Json | null
          economie_calculee_le?: string | null
          economie_cout_delegue?: number | null
          economie_cout_groupe?: number | null
          economie_realisee?: number | null
          economie_taux_delegue?: number | null
          economie_taux_groupe?: number | null
          fiscalite_calculee_le?: string | null
          fiscalite_detail?: Json | null
          fractionnement?: string
          id?: string
          import_externe?: boolean
          is_emprunteur?: boolean
          mandataire_id?: string | null
          mode_commissionnement?: string
          notes?: string | null
          numero?: string | null
          prescripteur_id?: string | null
          prime_annuelle?: number | null
          prime_ht_annuelle?: number | null
          prime_nette_annuelle?: number | null
          prime_ttc_annuelle?: number | null
          prochain_suivi_le?: string | null
          produit: string
          produit_id?: string | null
          projet_id?: string | null
          quotite?: number | null
          recommandation_personnalisee?: boolean
          regime_fiscal?: string
          source_prime_ttc?: string | null
          statut?: string
          taux_assurance_annuel?: number | null
          taux_pret?: number | null
          taxes_annuelles?: number | null
          updated_at?: string
        }
        Update: {
          assiette?: string | null
          assiette_commission_annuelle?: number | null
          assureur?: string
          capital_initial?: number | null
          client_id?: string
          co_emprunteur?: Json | null
          commission_cabinet_taux?: number | null
          compagnie_id?: string | null
          contribution_attentat_annuelle?: number
          created_at?: string
          created_by?: string | null
          date_echeance?: string | null
          date_effet?: string | null
          dernier_suivi_le?: string | null
          devis_source_id?: string | null
          dossier_id?: string | null
          duree_mois?: number | null
          economie_base?: Json | null
          economie_calculee_le?: string | null
          economie_cout_delegue?: number | null
          economie_cout_groupe?: number | null
          economie_realisee?: number | null
          economie_taux_delegue?: number | null
          economie_taux_groupe?: number | null
          fiscalite_calculee_le?: string | null
          fiscalite_detail?: Json | null
          fractionnement?: string
          id?: string
          import_externe?: boolean
          is_emprunteur?: boolean
          mandataire_id?: string | null
          mode_commissionnement?: string
          notes?: string | null
          numero?: string | null
          prescripteur_id?: string | null
          prime_annuelle?: number | null
          prime_ht_annuelle?: number | null
          prime_nette_annuelle?: number | null
          prime_ttc_annuelle?: number | null
          prochain_suivi_le?: string | null
          produit?: string
          produit_id?: string | null
          projet_id?: string | null
          quotite?: number | null
          recommandation_personnalisee?: boolean
          regime_fiscal?: string
          source_prime_ttc?: string | null
          statut?: string
          taux_assurance_annuel?: number | null
          taux_pret?: number | null
          taxes_annuelles?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contrats_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrats_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrats_devis_source_id_fkey"
            columns: ["devis_source_id"]
            isOneToOne: false
            referencedRelation: "dossier_devis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrats_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrats_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrats_projet_id_fkey"
            columns: ["projet_id"]
            isOneToOne: false
            referencedRelation: "projets"
            referencedColumns: ["id"]
          },
        ]
      }
      controles_internes: {
        Row: {
          actions_correctives: string | null
          anomalies_constatees: string | null
          client_id: string
          controleur_id: string | null
          created_at: string
          date_controle: string | null
          id: string
          mode_selection: string
          motif_ciblage: string | null
          periode: string
          resultat: string
          statut: string
          updated_at: string
        }
        Insert: {
          actions_correctives?: string | null
          anomalies_constatees?: string | null
          client_id: string
          controleur_id?: string | null
          created_at?: string
          date_controle?: string | null
          id?: string
          mode_selection?: string
          motif_ciblage?: string | null
          periode: string
          resultat?: string
          statut?: string
          updated_at?: string
        }
        Update: {
          actions_correctives?: string | null
          anomalies_constatees?: string | null
          client_id?: string
          controleur_id?: string | null
          created_at?: string
          date_controle?: string | null
          id?: string
          mode_selection?: string
          motif_ciblage?: string | null
          periode?: string
          resultat?: string
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "controles_internes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_emails: {
        Row: {
          ai_context: Json
          brouillon_id: string | null
          client_id: string | null
          compagnie_id: string | null
          confiance: number | null
          contrat_id: string | null
          created_at: string
          created_by: string | null
          decision: string | null
          direction: string
          dossier_id: string | null
          expediteur_email: string | null
          expediteur_nom: string | null
          gmail_message_id: string
          gmail_thread_id: string | null
          id: string
          label_gmail: string | null
          lien_brouillon: string | null
          lien_gmail: string | null
          lien_reponse: string | null
          motif: string | null
          notes: string | null
          recu_le: string | null
          statut_traitement: string
          sujet: string | null
          traite_le: string | null
          triage_ia: Json | null
          triage_le: string | null
          updated_at: string
        }
        Insert: {
          ai_context?: Json
          brouillon_id?: string | null
          client_id?: string | null
          compagnie_id?: string | null
          confiance?: number | null
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          decision?: string | null
          direction?: string
          dossier_id?: string | null
          expediteur_email?: string | null
          expediteur_nom?: string | null
          gmail_message_id: string
          gmail_thread_id?: string | null
          id?: string
          label_gmail?: string | null
          lien_brouillon?: string | null
          lien_gmail?: string | null
          lien_reponse?: string | null
          motif?: string | null
          notes?: string | null
          recu_le?: string | null
          statut_traitement?: string
          sujet?: string | null
          traite_le?: string | null
          triage_ia?: Json | null
          triage_le?: string | null
          updated_at?: string
        }
        Update: {
          ai_context?: Json
          brouillon_id?: string | null
          client_id?: string | null
          compagnie_id?: string | null
          confiance?: number | null
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          decision?: string | null
          direction?: string
          dossier_id?: string | null
          expediteur_email?: string | null
          expediteur_nom?: string | null
          gmail_message_id?: string
          gmail_thread_id?: string | null
          id?: string
          label_gmail?: string | null
          lien_brouillon?: string | null
          lien_gmail?: string | null
          lien_reponse?: string | null
          motif?: string | null
          notes?: string | null
          recu_le?: string | null
          statut_traitement?: string
          sujet?: string | null
          traite_le?: string | null
          triage_ia?: Json | null
          triage_le?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_emails_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_emails_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_emails_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_emails_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      der_modele: {
        Row: {
          actif: boolean
          contenu: Json | null
          created_at: string
          id: string
          nom: string
          notes: string | null
          obsolete: boolean
          obsolete_le: string | null
          obsolete_motif: string | null
          statut: string
          storage_path: string | null
          updated_at: string
          updated_by: string | null
          valide_le: string | null
          valide_par: string | null
          version: string
        }
        Insert: {
          actif?: boolean
          contenu?: Json | null
          created_at?: string
          id?: string
          nom: string
          notes?: string | null
          obsolete?: boolean
          obsolete_le?: string | null
          obsolete_motif?: string | null
          statut?: string
          storage_path?: string | null
          updated_at?: string
          updated_by?: string | null
          valide_le?: string | null
          valide_par?: string | null
          version: string
        }
        Update: {
          actif?: boolean
          contenu?: Json | null
          created_at?: string
          id?: string
          nom?: string
          notes?: string | null
          obsolete?: boolean
          obsolete_le?: string | null
          obsolete_motif?: string | null
          statut?: string
          storage_path?: string | null
          updated_at?: string
          updated_by?: string | null
          valide_le?: string | null
          valide_par?: string | null
          version?: string
        }
        Relationships: []
      }
      devoir_conseil_refus_analyses: {
        Row: {
          created_at: string
          devis_alternatif_id: string | null
          devoir_id: string
          dossier_id: string
          execution_auto_detail: string | null
          execution_auto_le: string | null
          id: string
          modele_ia: string | null
          motif_client: string
          niveau: string | null
          niveau_justification: string | null
          recommandation_ia: string
          reduction_courtage_pct: number | null
          statut: string
          suggestion_contre_proposition: string | null
          synthese: string
          traite_le: string | null
          traite_par: string | null
        }
        Insert: {
          created_at?: string
          devis_alternatif_id?: string | null
          devoir_id: string
          dossier_id: string
          execution_auto_detail?: string | null
          execution_auto_le?: string | null
          id?: string
          modele_ia?: string | null
          motif_client: string
          niveau?: string | null
          niveau_justification?: string | null
          recommandation_ia: string
          reduction_courtage_pct?: number | null
          statut?: string
          suggestion_contre_proposition?: string | null
          synthese: string
          traite_le?: string | null
          traite_par?: string | null
        }
        Update: {
          created_at?: string
          devis_alternatif_id?: string | null
          devoir_id?: string
          dossier_id?: string
          execution_auto_detail?: string | null
          execution_auto_le?: string | null
          id?: string
          modele_ia?: string | null
          motif_client?: string
          niveau?: string | null
          niveau_justification?: string | null
          recommandation_ia?: string
          reduction_courtage_pct?: number | null
          statut?: string
          suggestion_contre_proposition?: string | null
          synthese?: string
          traite_le?: string | null
          traite_par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devoir_conseil_refus_analyses_devis_alternatif_id_fkey"
            columns: ["devis_alternatif_id"]
            isOneToOne: false
            referencedRelation: "dossier_devis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoir_conseil_refus_analyses_devoir_id_fkey"
            columns: ["devoir_id"]
            isOneToOne: false
            referencedRelation: "devoirs_conseil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoir_conseil_refus_analyses_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      devoirs_conseil: {
        Row: {
          archive_le: string | null
          client_id: string | null
          contenu: Json
          created_at: string
          created_by: string | null
          dossier_id: string
          echelonnement_demande: boolean
          echelonnement_montant_mensuel: number | null
          echelonnement_partenaire_confirme: boolean
          echelonnement_partenaire_confirme_le: string | null
          echelonnement_partenaire_confirme_par: string | null
          email_destinataire: string | null
          envoye_le: string | null
          hash: string | null
          id: string
          mises_en_garde: string | null
          motifs: string | null
          notes_modification: string | null
          pdf_path: string | null
          recommandation: string | null
          refus_motif: string | null
          refuse_le: string | null
          signature_png: string | null
          signed_at: string | null
          signed_ip: string | null
          signed_ua: string | null
          statut: string
          type_assurance: string
          updated_at: string
          valide_le: string | null
          valide_par: string | null
        }
        Insert: {
          archive_le?: string | null
          client_id?: string | null
          contenu?: Json
          created_at?: string
          created_by?: string | null
          dossier_id: string
          echelonnement_demande?: boolean
          echelonnement_montant_mensuel?: number | null
          echelonnement_partenaire_confirme?: boolean
          echelonnement_partenaire_confirme_le?: string | null
          echelonnement_partenaire_confirme_par?: string | null
          email_destinataire?: string | null
          envoye_le?: string | null
          hash?: string | null
          id?: string
          mises_en_garde?: string | null
          motifs?: string | null
          notes_modification?: string | null
          pdf_path?: string | null
          recommandation?: string | null
          refus_motif?: string | null
          refuse_le?: string | null
          signature_png?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_ua?: string | null
          statut?: string
          type_assurance?: string
          updated_at?: string
          valide_le?: string | null
          valide_par?: string | null
        }
        Update: {
          archive_le?: string | null
          client_id?: string | null
          contenu?: Json
          created_at?: string
          created_by?: string | null
          dossier_id?: string
          echelonnement_demande?: boolean
          echelonnement_montant_mensuel?: number | null
          echelonnement_partenaire_confirme?: boolean
          echelonnement_partenaire_confirme_le?: string | null
          echelonnement_partenaire_confirme_par?: string | null
          email_destinataire?: string | null
          envoye_le?: string | null
          hash?: string | null
          id?: string
          mises_en_garde?: string | null
          motifs?: string | null
          notes_modification?: string | null
          pdf_path?: string | null
          recommandation?: string | null
          refus_motif?: string | null
          refuse_le?: string | null
          signature_png?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_ua?: string | null
          statut?: string
          type_assurance?: string
          updated_at?: string
          valide_le?: string | null
          valide_par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devoirs_conseil_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devoirs_conseil_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_extractions: {
        Row: {
          confidence_score: number | null
          created_at: string
          document_id: string
          erreur: string | null
          extracted_data: Json | null
          id: string
          model: string | null
          raw_text: string | null
          statut: string
          type_document: string | null
          updated_at: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          document_id: string
          erreur?: string | null
          extracted_data?: Json | null
          id?: string
          model?: string | null
          raw_text?: string | null
          statut?: string
          type_document?: string | null
          updated_at?: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          document_id?: string
          erreur?: string | null
          extracted_data?: Json | null
          id?: string
          model?: string | null
          raw_text?: string | null
          statut?: string
          type_document?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doc_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          archive_le: string | null
          categorie: string
          classification_ia: Json | null
          classification_le: string | null
          client_id: string | null
          contrat_id: string | null
          created_at: string
          date_expiration: string | null
          dossier_id: string | null
          empreinte_fichier: string | null
          file_name: string
          file_size: number | null
          gmail_message_id: string | null
          id: string
          mime_type: string | null
          rappel_expiration_envoye_le: string | null
          storage_path: string
          type_document: string | null
          uploader_id: string
        }
        Insert: {
          archive_le?: string | null
          categorie?: string
          classification_ia?: Json | null
          classification_le?: string | null
          client_id?: string | null
          contrat_id?: string | null
          created_at?: string
          date_expiration?: string | null
          dossier_id?: string | null
          empreinte_fichier?: string | null
          file_name: string
          file_size?: number | null
          gmail_message_id?: string | null
          id?: string
          mime_type?: string | null
          rappel_expiration_envoye_le?: string | null
          storage_path: string
          type_document?: string | null
          uploader_id: string
        }
        Update: {
          archive_le?: string | null
          categorie?: string
          classification_ia?: Json | null
          classification_le?: string | null
          client_id?: string | null
          contrat_id?: string | null
          created_at?: string
          date_expiration?: string | null
          dossier_id?: string | null
          empreinte_fichier?: string | null
          file_name?: string
          file_size?: number | null
          gmail_message_id?: string | null
          id?: string
          mime_type?: string | null
          rappel_expiration_envoye_le?: string | null
          storage_path?: string
          type_document?: string | null
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      dora_incidents: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          detecte_le: string | null
          gravite: string
          id: string
          impact_donnees: boolean
          mesures_correctives: string | null
          notification_acpr: boolean
          notification_cnil: boolean
          resolu_le: string | null
          statut: string
          survenu_le: string
          systeme_id: string | null
          titre: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          detecte_le?: string | null
          gravite?: string
          id?: string
          impact_donnees?: boolean
          mesures_correctives?: string | null
          notification_acpr?: boolean
          notification_cnil?: boolean
          resolu_le?: string | null
          statut?: string
          survenu_le?: string
          systeme_id?: string | null
          titre: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          detecte_le?: string | null
          gravite?: string
          id?: string
          impact_donnees?: boolean
          mesures_correctives?: string | null
          notification_acpr?: boolean
          notification_cnil?: boolean
          resolu_le?: string | null
          statut?: string
          survenu_le?: string
          systeme_id?: string | null
          titre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dora_incidents_systeme_id_fkey"
            columns: ["systeme_id"]
            isOneToOne: false
            referencedRelation: "dora_systemes_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      dora_systemes_tiers: {
        Row: {
          actif: boolean
          categorie: string
          contrat_reference: string | null
          created_at: string
          created_by: string | null
          criticite: string
          derniere_revue_le: string | null
          donnees_traitees: string | null
          fournisseur: string | null
          id: string
          localisation_donnees: string | null
          nom: string
          plan_continuite: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          categorie?: string
          contrat_reference?: string | null
          created_at?: string
          created_by?: string | null
          criticite?: string
          derniere_revue_le?: string | null
          donnees_traitees?: string | null
          fournisseur?: string | null
          id?: string
          localisation_donnees?: string | null
          nom: string
          plan_continuite?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          categorie?: string
          contrat_reference?: string | null
          created_at?: string
          created_by?: string | null
          criticite?: string
          derniere_revue_le?: string | null
          donnees_traitees?: string | null
          fournisseur?: string | null
          id?: string
          localisation_donnees?: string | null
          nom?: string
          plan_continuite?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dossier_devis: {
        Row: {
          archive_le: string | null
          assiette_commission_annuelle: number | null
          assure_personne_id: string | null
          assure_rang: number | null
          assureur_porteur: string | null
          commission_base: string
          commission_source: string
          compagnie_id: string | null
          contribution_attentat_annuelle: number
          cotisation_max: number | null
          cotisation_mensuelle: number | null
          cotisation_min: number | null
          created_at: string
          document_id: string | null
          dossier_id: string
          est_retenu: boolean
          fiscalite_calculee_le: string | null
          fiscalite_detail: Json | null
          formule_id: string | null
          garanties_resume: string | null
          id: string
          montant_total_saisi: number | null
          prime_ht_annuelle: number | null
          prime_ttc_annuelle: number | null
          produit_id: string | null
          quotite_pct: number | null
          regime_fiscal: string
          saisi_par: string | null
          source: string
          source_prime_ttc: string | null
          taux_commission: number | null
          taxes_annuelles: number | null
          type_cotisation: string | null
          updated_at: string
        }
        Insert: {
          archive_le?: string | null
          assiette_commission_annuelle?: number | null
          assure_personne_id?: string | null
          assure_rang?: number | null
          assureur_porteur?: string | null
          commission_base?: string
          commission_source?: string
          compagnie_id?: string | null
          contribution_attentat_annuelle?: number
          cotisation_max?: number | null
          cotisation_mensuelle?: number | null
          cotisation_min?: number | null
          created_at?: string
          document_id?: string | null
          dossier_id: string
          est_retenu?: boolean
          fiscalite_calculee_le?: string | null
          fiscalite_detail?: Json | null
          formule_id?: string | null
          garanties_resume?: string | null
          id?: string
          montant_total_saisi?: number | null
          prime_ht_annuelle?: number | null
          prime_ttc_annuelle?: number | null
          produit_id?: string | null
          quotite_pct?: number | null
          regime_fiscal?: string
          saisi_par?: string | null
          source?: string
          source_prime_ttc?: string | null
          taux_commission?: number | null
          taxes_annuelles?: number | null
          type_cotisation?: string | null
          updated_at?: string
        }
        Update: {
          archive_le?: string | null
          assiette_commission_annuelle?: number | null
          assure_personne_id?: string | null
          assure_rang?: number | null
          assureur_porteur?: string | null
          commission_base?: string
          commission_source?: string
          compagnie_id?: string | null
          contribution_attentat_annuelle?: number
          cotisation_max?: number | null
          cotisation_mensuelle?: number | null
          cotisation_min?: number | null
          created_at?: string
          document_id?: string | null
          dossier_id?: string
          est_retenu?: boolean
          fiscalite_calculee_le?: string | null
          fiscalite_detail?: Json | null
          formule_id?: string | null
          garanties_resume?: string | null
          id?: string
          montant_total_saisi?: number | null
          prime_ht_annuelle?: number | null
          prime_ttc_annuelle?: number | null
          produit_id?: string | null
          quotite_pct?: number | null
          regime_fiscal?: string
          saisi_par?: string | null
          source?: string
          source_prime_ttc?: string | null
          taux_commission?: number | null
          taxes_annuelles?: number | null
          type_cotisation?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_devis_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_devis_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_devis_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_devis_formule_id_fkey"
            columns: ["formule_id"]
            isOneToOne: false
            referencedRelation: "produit_formules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_devis_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_devis_classements: {
        Row: {
          classement: Json
          created_at: string
          created_by: string | null
          devis_retenu_id: string | null
          dossier_id: string
          genere_le: string
          id: string
          modele_ia: string | null
          profils_specifiques: string[] | null
          route: string | null
          scores: Json | null
          statut: string
          updated_at: string
        }
        Insert: {
          classement?: Json
          created_at?: string
          created_by?: string | null
          devis_retenu_id?: string | null
          dossier_id: string
          genere_le?: string
          id?: string
          modele_ia?: string | null
          profils_specifiques?: string[] | null
          route?: string | null
          scores?: Json | null
          statut?: string
          updated_at?: string
        }
        Update: {
          classement?: Json
          created_at?: string
          created_by?: string | null
          devis_retenu_id?: string | null
          dossier_id?: string
          genere_le?: string
          id?: string
          modele_ia?: string | null
          profils_specifiques?: string[] | null
          route?: string | null
          scores?: Json | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_devis_classements_devis_retenu_id_fkey"
            columns: ["devis_retenu_id"]
            isOneToOne: false
            referencedRelation: "dossier_devis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_devis_classements_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_etapes_historique: {
        Row: {
          ancienne_etape: string | null
          commentaire: string | null
          created_at: string
          dossier_id: string
          id: string
          nouvelle_etape: string
          par: string | null
        }
        Insert: {
          ancienne_etape?: string | null
          commentaire?: string | null
          created_at?: string
          dossier_id: string
          id?: string
          nouvelle_etape: string
          par?: string | null
        }
        Update: {
          ancienne_etape?: string | null
          commentaire?: string | null
          created_at?: string
          dossier_id?: string
          id?: string
          nouvelle_etape?: string
          par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dossier_etapes_historique_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_pieces_requises: {
        Row: {
          categorie: string
          client_id: string | null
          code: string
          created_at: string
          document_id: string | null
          dossier_id: string
          id: string
          kyc_document_id: string | null
          libelle: string
          notes: string | null
          obligatoire: boolean
          recue_le: string | null
          statut: string
          updated_at: string
        }
        Insert: {
          categorie?: string
          client_id?: string | null
          code: string
          created_at?: string
          document_id?: string | null
          dossier_id: string
          id?: string
          kyc_document_id?: string | null
          libelle: string
          notes?: string | null
          obligatoire?: boolean
          recue_le?: string | null
          statut?: string
          updated_at?: string
        }
        Update: {
          categorie?: string
          client_id?: string | null
          code?: string
          created_at?: string
          document_id?: string | null
          dossier_id?: string
          id?: string
          kyc_document_id?: string | null
          libelle?: string
          notes?: string | null
          obligatoire?: boolean
          recue_le?: string | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_pieces_requises_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_pieces_requises_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_pieces_requises_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_pieces_requises_kyc_document_id_fkey"
            columns: ["kyc_document_id"]
            isOneToOne: false
            referencedRelation: "client_kyc_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_references_externes: {
        Row: {
          assure_rang: number | null
          compagnie_id: string | null
          contrat_id: string | null
          created_at: string
          created_by: string | null
          dossier_id: string
          id: string
          libelle: string | null
          reference: string
        }
        Insert: {
          assure_rang?: number | null
          compagnie_id?: string | null
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          dossier_id: string
          id?: string
          libelle?: string | null
          reference: string
        }
        Update: {
          assure_rang?: number | null
          compagnie_id?: string | null
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          dossier_id?: string
          id?: string
          libelle?: string | null
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossier_references_externes_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_references_externes_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_references_externes_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      dossiers: {
        Row: {
          accuse_reception_envoye_le: string | null
          age: number | null
          analyse_ia: Json | null
          analyse_ia_le: string | null
          analyse_ia_modele: string | null
          apporteur_id: string | null
          cadre_financement: string | null
          capital: number | null
          chance_reussite: string | null
          charge_de_projet: string | null
          client_email: string | null
          client_id: string | null
          client_nom: string
          client_phone: string | null
          compagnie_id: string | null
          created_at: string
          created_by: string | null
          cree_automatiquement: boolean
          date_butoir: string | null
          date_signature_pret: string | null
          duree_mois: number | null
          economie_estimee: number | null
          frais_dossier: number | null
          fumeur: boolean | null
          id: string
          mode_recommandation: string
          notes: string | null
          prime_annuelle: number | null
          prime_mensuelle: number | null
          prime_semestrielle: number | null
          prime_trimestrielle: number | null
          priorite: string | null
          produit_id: string | null
          projet_contexte: string | null
          projet_etat: string | null
          projet_prioritaire: boolean | null
          projet_type: string | null
          recueil_besoins: Json | null
          reference: string
          relance_pieces_envoyee_le: string | null
          souscription_email_compagnie: string | null
          souscription_envoyee_le: string | null
          souscription_relance_le: string | null
          souscription_relances_nb: number
          souscription_retour_le: string | null
          statut: Database["public"]["Enums"]["dossier_statut"]
          type_assurance: string
          updated_at: string
        }
        Insert: {
          accuse_reception_envoye_le?: string | null
          age?: number | null
          analyse_ia?: Json | null
          analyse_ia_le?: string | null
          analyse_ia_modele?: string | null
          apporteur_id?: string | null
          cadre_financement?: string | null
          capital?: number | null
          chance_reussite?: string | null
          charge_de_projet?: string | null
          client_email?: string | null
          client_id?: string | null
          client_nom: string
          client_phone?: string | null
          compagnie_id?: string | null
          created_at?: string
          created_by?: string | null
          cree_automatiquement?: boolean
          date_butoir?: string | null
          date_signature_pret?: string | null
          duree_mois?: number | null
          economie_estimee?: number | null
          frais_dossier?: number | null
          fumeur?: boolean | null
          id?: string
          mode_recommandation?: string
          notes?: string | null
          prime_annuelle?: number | null
          prime_mensuelle?: number | null
          prime_semestrielle?: number | null
          prime_trimestrielle?: number | null
          priorite?: string | null
          produit_id?: string | null
          projet_contexte?: string | null
          projet_etat?: string | null
          projet_prioritaire?: boolean | null
          projet_type?: string | null
          recueil_besoins?: Json | null
          reference?: string
          relance_pieces_envoyee_le?: string | null
          souscription_email_compagnie?: string | null
          souscription_envoyee_le?: string | null
          souscription_relance_le?: string | null
          souscription_relances_nb?: number
          souscription_retour_le?: string | null
          statut?: Database["public"]["Enums"]["dossier_statut"]
          type_assurance?: string
          updated_at?: string
        }
        Update: {
          accuse_reception_envoye_le?: string | null
          age?: number | null
          analyse_ia?: Json | null
          analyse_ia_le?: string | null
          analyse_ia_modele?: string | null
          apporteur_id?: string | null
          cadre_financement?: string | null
          capital?: number | null
          chance_reussite?: string | null
          charge_de_projet?: string | null
          client_email?: string | null
          client_id?: string | null
          client_nom?: string
          client_phone?: string | null
          compagnie_id?: string | null
          created_at?: string
          created_by?: string | null
          cree_automatiquement?: boolean
          date_butoir?: string | null
          date_signature_pret?: string | null
          duree_mois?: number | null
          economie_estimee?: number | null
          frais_dossier?: number | null
          fumeur?: boolean | null
          id?: string
          mode_recommandation?: string
          notes?: string | null
          prime_annuelle?: number | null
          prime_mensuelle?: number | null
          prime_semestrielle?: number | null
          prime_trimestrielle?: number | null
          priorite?: string | null
          produit_id?: string | null
          projet_contexte?: string | null
          projet_etat?: string | null
          projet_prioritaire?: boolean | null
          projet_type?: string | null
          recueil_besoins?: Json | null
          reference?: string
          relance_pieces_envoyee_le?: string | null
          souscription_email_compagnie?: string | null
          souscription_envoyee_le?: string | null
          souscription_relance_le?: string | null
          souscription_relances_nb?: number
          souscription_retour_le?: string | null
          statut?: Database["public"]["Enums"]["dossier_statut"]
          type_assurance?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossiers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossiers_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossiers_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      ecritures: {
        Row: {
          created_at: string
          created_by: string | null
          date_ecriture: string
          exercice_id: string
          id: string
          journal_code: string
          libelle: string
          mandataire_id: string | null
          numero_piece: string | null
          reference_externe: string | null
          source: string | null
          source_id: string | null
          statut: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date_ecriture: string
          exercice_id: string
          id?: string
          journal_code: string
          libelle: string
          mandataire_id?: string | null
          numero_piece?: string | null
          reference_externe?: string | null
          source?: string | null
          source_id?: string | null
          statut?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date_ecriture?: string
          exercice_id?: string
          id?: string
          journal_code?: string
          libelle?: string
          mandataire_id?: string | null
          numero_piece?: string | null
          reference_externe?: string | null
          source?: string | null
          source_id?: string | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecritures_exercice_id_fkey"
            columns: ["exercice_id"]
            isOneToOne: false
            referencedRelation: "exercices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecritures_journal_code_fkey"
            columns: ["journal_code"]
            isOneToOne: false
            referencedRelation: "journaux"
            referencedColumns: ["code"]
          },
        ]
      }
      ecritures_lignes: {
        Row: {
          compte_numero: string
          created_at: string
          credit: number
          debit: number
          ecriture_id: string
          id: string
          libelle: string | null
          mandataire_id: string | null
          numero_ligne: number
          tiers_id: string | null
        }
        Insert: {
          compte_numero: string
          created_at?: string
          credit?: number
          debit?: number
          ecriture_id: string
          id?: string
          libelle?: string | null
          mandataire_id?: string | null
          numero_ligne: number
          tiers_id?: string | null
        }
        Update: {
          compte_numero?: string
          created_at?: string
          credit?: number
          debit?: number
          ecriture_id?: string
          id?: string
          libelle?: string | null
          mandataire_id?: string | null
          numero_ligne?: number
          tiers_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ecritures_lignes_compte_numero_fkey"
            columns: ["compte_numero"]
            isOneToOne: false
            referencedRelation: "plan_comptable"
            referencedColumns: ["numero"]
          },
          {
            foreignKeyName: "ecritures_lignes_ecriture_id_fkey"
            columns: ["ecriture_id"]
            isOneToOne: false
            referencedRelation: "ecritures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecritures_lignes_tiers_id_fkey"
            columns: ["tiers_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      email_decisions: {
        Row: {
          confiance: number | null
          created_at: string
          crm_email_id: string
          decision: string
          gmail_message_id: string
          id: string
          label_gmail: string | null
          motif: string | null
          origine: string
          par: string | null
        }
        Insert: {
          confiance?: number | null
          created_at?: string
          crm_email_id: string
          decision: string
          gmail_message_id: string
          id?: string
          label_gmail?: string | null
          motif?: string | null
          origine?: string
          par?: string | null
        }
        Update: {
          confiance?: number | null
          created_at?: string
          crm_email_id?: string
          decision?: string
          gmail_message_id?: string
          id?: string
          label_gmail?: string | null
          motif?: string | null
          origine?: string
          par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_decisions_crm_email_id_fkey"
            columns: ["crm_email_id"]
            isOneToOne: false
            referencedRelation: "crm_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      emails_planifies: {
        Row: {
          contexte: Json
          created_at: string
          destinataire: string
          donnees: Json
          envoye_le: string | null
          envoyer_le: string
          erreur: string | null
          id: string
          idempotency_key: string | null
          lot: string | null
          statut: string
          template: string
          updated_at: string
        }
        Insert: {
          contexte?: Json
          created_at?: string
          destinataire: string
          donnees?: Json
          envoye_le?: string | null
          envoyer_le?: string
          erreur?: string | null
          id?: string
          idempotency_key?: string | null
          lot?: string | null
          statut?: string
          template: string
          updated_at?: string
        }
        Update: {
          contexte?: Json
          created_at?: string
          destinataire?: string
          donnees?: Json
          envoye_le?: string | null
          envoyer_le?: string
          erreur?: string | null
          id?: string
          idempotency_key?: string | null
          lot?: string | null
          statut?: string
          template?: string
          updated_at?: string
        }
        Relationships: []
      }
      etudes_epargne: {
        Row: {
          client_id: string | null
          comparatif: Json
          contrat_actuel: Json
          created_at: string
          created_by: string | null
          dossier_id: string
          hypotheses: Json
          id: string
          motif_indisponibilite: string | null
          offre_cabinet: Json
          produit_id: string | null
          profil_risque: string | null
          statut: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          comparatif?: Json
          contrat_actuel?: Json
          created_at?: string
          created_by?: string | null
          dossier_id: string
          hypotheses?: Json
          id?: string
          motif_indisponibilite?: string | null
          offre_cabinet?: Json
          produit_id?: string | null
          profil_risque?: string | null
          statut?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          comparatif?: Json
          contrat_actuel?: Json
          created_at?: string
          created_by?: string | null
          dossier_id?: string
          hypotheses?: Json
          id?: string
          motif_indisponibilite?: string | null
          offre_cabinet?: Json
          produit_id?: string | null
          profil_risque?: string | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "etudes_epargne_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etudes_epargne_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etudes_epargne_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      exercices: {
        Row: {
          cloture: boolean
          cloture_le: string | null
          cloture_par: string | null
          created_at: string
          date_debut: string
          date_fin: string
          id: string
          libelle: string
          updated_at: string
        }
        Insert: {
          cloture?: boolean
          cloture_le?: string | null
          cloture_par?: string | null
          created_at?: string
          date_debut: string
          date_fin: string
          id?: string
          libelle: string
          updated_at?: string
        }
        Update: {
          cloture?: boolean
          cloture_le?: string | null
          cloture_par?: string | null
          created_at?: string
          date_debut?: string
          date_fin?: string
          id?: string
          libelle?: string
          updated_at?: string
        }
        Relationships: []
      }
      factures_achat: {
        Row: {
          compte_charge: string
          compte_tva: string
          created_at: string
          created_by: string
          date_echeance: string | null
          date_facture: string
          date_paiement: string | null
          ecriture_id: string | null
          fichier_nom: string | null
          fichier_path: string | null
          fournisseur: string
          fournisseur_id: string | null
          id: string
          montant_ht: number
          montant_ttc: number
          montant_tva: number
          moyen_paiement: string | null
          notes: string | null
          numero_facture: string | null
          statut: string
          tiers_id: string | null
          updated_at: string
        }
        Insert: {
          compte_charge?: string
          compte_tva?: string
          created_at?: string
          created_by?: string
          date_echeance?: string | null
          date_facture?: string
          date_paiement?: string | null
          ecriture_id?: string | null
          fichier_nom?: string | null
          fichier_path?: string | null
          fournisseur: string
          fournisseur_id?: string | null
          id?: string
          montant_ht?: number
          montant_ttc?: number
          montant_tva?: number
          moyen_paiement?: string | null
          notes?: string | null
          numero_facture?: string | null
          statut?: string
          tiers_id?: string | null
          updated_at?: string
        }
        Update: {
          compte_charge?: string
          compte_tva?: string
          created_at?: string
          created_by?: string
          date_echeance?: string | null
          date_facture?: string
          date_paiement?: string | null
          ecriture_id?: string | null
          fichier_nom?: string | null
          fichier_path?: string | null
          fournisseur?: string
          fournisseur_id?: string | null
          id?: string
          montant_ht?: number
          montant_ttc?: number
          montant_tva?: number
          moyen_paiement?: string | null
          notes?: string | null
          numero_facture?: string | null
          statut?: string
          tiers_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "factures_achat_ecriture_id_fkey"
            columns: ["ecriture_id"]
            isOneToOne: false
            referencedRelation: "ecritures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_achat_fournisseur_id_fkey"
            columns: ["fournisseur_id"]
            isOneToOne: false
            referencedRelation: "fournisseurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_achat_tiers_id_fkey"
            columns: ["tiers_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      formations_personnel: {
        Row: {
          attestation_url: string | null
          collaborateur_id: string
          created_at: string
          created_by: string | null
          date_expiration: string | null
          date_formation: string
          id: string
          statut: string
          theme: string
          updated_at: string
        }
        Insert: {
          attestation_url?: string | null
          collaborateur_id: string
          created_at?: string
          created_by?: string | null
          date_expiration?: string | null
          date_formation: string
          id?: string
          statut?: string
          theme: string
          updated_at?: string
        }
        Update: {
          attestation_url?: string | null
          collaborateur_id?: string
          created_at?: string
          created_by?: string | null
          date_expiration?: string | null
          date_formation?: string
          id?: string
          statut?: string
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      formule_garanties: {
        Row: {
          created_at: string
          formule_id: string
          grille_version: number
          id: string
          statut: string
          updated_at: string
          updated_by: string | null
          valeurs: Json
          valide_le: string | null
          valide_par: string | null
        }
        Insert: {
          created_at?: string
          formule_id: string
          grille_version?: number
          id?: string
          statut?: string
          updated_at?: string
          updated_by?: string | null
          valeurs?: Json
          valide_le?: string | null
          valide_par?: string | null
        }
        Update: {
          created_at?: string
          formule_id?: string
          grille_version?: number
          id?: string
          statut?: string
          updated_at?: string
          updated_by?: string | null
          valeurs?: Json
          valide_le?: string | null
          valide_par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "formule_garanties_formule_id_fkey"
            columns: ["formule_id"]
            isOneToOne: true
            referencedRelation: "produit_formules"
            referencedColumns: ["id"]
          },
        ]
      }
      formule_garanties_propositions: {
        Row: {
          avertissements: string | null
          created_at: string
          created_by: string | null
          document_id: string | null
          formule_id: string | null
          formule_nom: string
          grille_version: number
          id: string
          modele_ia: string | null
          produit_id: string
          statut: string
          traite_le: string | null
          traite_par: string | null
          valeurs: Json
        }
        Insert: {
          avertissements?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          formule_id?: string | null
          formule_nom: string
          grille_version?: number
          id?: string
          modele_ia?: string | null
          produit_id: string
          statut?: string
          traite_le?: string | null
          traite_par?: string | null
          valeurs?: Json
        }
        Update: {
          avertissements?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          formule_id?: string | null
          formule_nom?: string
          grille_version?: number
          id?: string
          modele_ia?: string | null
          produit_id?: string
          statut?: string
          traite_le?: string | null
          traite_par?: string | null
          valeurs?: Json
        }
        Relationships: [
          {
            foreignKeyName: "formule_garanties_propositions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "produit_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formule_garanties_propositions_formule_id_fkey"
            columns: ["formule_id"]
            isOneToOne: false
            referencedRelation: "produit_formules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formule_garanties_propositions_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      formule_tarifs: {
        Row: {
          age_max: number
          age_min: number
          cotisation_mensuelle: number | null
          created_at: string
          formule_id: string
          id: string
          notes: string | null
          regime: string | null
          updated_at: string
        }
        Insert: {
          age_max?: number
          age_min?: number
          cotisation_mensuelle?: number | null
          created_at?: string
          formule_id: string
          id?: string
          notes?: string | null
          regime?: string | null
          updated_at?: string
        }
        Update: {
          age_max?: number
          age_min?: number
          cotisation_mensuelle?: number | null
          created_at?: string
          formule_id?: string
          id?: string
          notes?: string | null
          regime?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "formule_tarifs_formule_id_fkey"
            columns: ["formule_id"]
            isOneToOne: false
            referencedRelation: "produit_formules"
            referencedColumns: ["id"]
          },
        ]
      }
      fournisseurs: {
        Row: {
          adresse: string | null
          categorie: string
          compte_charge_defaut: string | null
          contact_nom: string | null
          contrat_reference: string | null
          created_at: string
          created_by: string | null
          domaines_email: string[]
          echeance_jours: number | null
          email: string | null
          id: string
          moyen_paiement_habituel: string | null
          nom: string
          notes: string | null
          numero_tva: string | null
          siret: string | null
          site_web: string | null
          slug: string
          statut: string
          telephone: string | null
          updated_at: string
        }
        Insert: {
          adresse?: string | null
          categorie?: string
          compte_charge_defaut?: string | null
          contact_nom?: string | null
          contrat_reference?: string | null
          created_at?: string
          created_by?: string | null
          domaines_email?: string[]
          echeance_jours?: number | null
          email?: string | null
          id?: string
          moyen_paiement_habituel?: string | null
          nom: string
          notes?: string | null
          numero_tva?: string | null
          siret?: string | null
          site_web?: string | null
          slug: string
          statut?: string
          telephone?: string | null
          updated_at?: string
        }
        Update: {
          adresse?: string | null
          categorie?: string
          compte_charge_defaut?: string | null
          contact_nom?: string | null
          contrat_reference?: string | null
          created_at?: string
          created_by?: string | null
          domaines_email?: string[]
          echeance_jours?: number | null
          email?: string | null
          id?: string
          moyen_paiement_habituel?: string | null
          nom?: string
          notes?: string | null
          numero_tva?: string | null
          siret?: string | null
          site_web?: string | null
          slug?: string
          statut?: string
          telephone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      journaux: {
        Row: {
          actif: boolean
          code: string
          compte_contrepartie: string | null
          created_at: string
          libelle: string
          type: string
        }
        Insert: {
          actif?: boolean
          code: string
          compte_contrepartie?: string | null
          created_at?: string
          libelle: string
          type: string
        }
        Update: {
          actif?: boolean
          code?: string
          compte_contrepartie?: string | null
          created_at?: string
          libelle?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "journaux_compte_contrepartie_fkey"
            columns: ["compte_contrepartie"]
            isOneToOne: false
            referencedRelation: "plan_comptable"
            referencedColumns: ["numero"]
          },
        ]
      }
      lettres_mission: {
        Row: {
          archive_envoye_le: string | null
          archive_le: string | null
          archive_reponse: string | null
          client_id: string | null
          contenu: Json
          created_at: string
          created_by: string | null
          document_hash: string | null
          dossier_id: string
          email_destinataire: string | null
          envoye_le: string | null
          envoye_par: string | null
          id: string
          pdf_storage_path: string | null
          signature_png: string | null
          signed_at: string | null
          signed_ip: string | null
          signed_ua: string | null
          statut: string
          type_assurance: string
          updated_at: string
        }
        Insert: {
          archive_envoye_le?: string | null
          archive_le?: string | null
          archive_reponse?: string | null
          client_id?: string | null
          contenu: Json
          created_at?: string
          created_by?: string | null
          document_hash?: string | null
          dossier_id: string
          email_destinataire?: string | null
          envoye_le?: string | null
          envoye_par?: string | null
          id?: string
          pdf_storage_path?: string | null
          signature_png?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_ua?: string | null
          statut?: string
          type_assurance: string
          updated_at?: string
        }
        Update: {
          archive_envoye_le?: string | null
          archive_le?: string | null
          archive_reponse?: string | null
          client_id?: string | null
          contenu?: Json
          created_at?: string
          created_by?: string | null
          document_hash?: string | null
          dossier_id?: string
          email_destinataire?: string | null
          envoye_le?: string | null
          envoye_par?: string | null
          id?: string
          pdf_storage_path?: string | null
          signature_png?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_ua?: string | null
          statut?: string
          type_assurance?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lettres_mission_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lettres_mission_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      mandataires_formations: {
        Row: {
          annee: number
          created_at: string
          date_session: string | null
          declare_par: string | null
          heures: number
          id: string
          intitule: string
          justificatif_storage_path: string | null
          organisme: string | null
          user_id: string
        }
        Insert: {
          annee: number
          created_at?: string
          date_session?: string | null
          declare_par?: string | null
          heures: number
          id?: string
          intitule: string
          justificatif_storage_path?: string | null
          organisme?: string | null
          user_id: string
        }
        Update: {
          annee?: number
          created_at?: string
          date_session?: string | null
          declare_par?: string | null
          heures?: number
          id?: string
          intitule?: string
          justificatif_storage_path?: string | null
          organisme?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mandataires_kyc_documents: {
        Row: {
          created_at: string
          date_emission: string | null
          date_expiration: string | null
          id: string
          nom: string
          notes: string | null
          statut: string
          storage_path: string
          type: string
          updated_at: string
          uploaded_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          date_emission?: string | null
          date_expiration?: string | null
          id?: string
          nom: string
          notes?: string | null
          statut?: string
          storage_path: string
          type: string
          updated_at?: string
          uploaded_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          date_emission?: string | null
          date_expiration?: string | null
          id?: string
          nom?: string
          notes?: string | null
          statut?: string
          storage_path?: string
          type?: string
          updated_at?: string
          uploaded_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mandataires_profils: {
        Row: {
          created_at: string
          equipe_activee: boolean
          equipe_activee_le: string | null
          equipe_activee_par: string | null
          manager_id: string | null
          taux_commission: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          equipe_activee?: boolean
          equipe_activee_le?: string | null
          equipe_activee_par?: string | null
          manager_id?: string | null
          taux_commission?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          equipe_activee?: boolean
          equipe_activee_le?: string | null
          equipe_activee_par?: string | null
          manager_id?: string | null
          taux_commission?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          auteur_id: string
          contenu: string
          created_at: string
          dossier_id: string
          id: string
        }
        Insert: {
          auteur_id: string
          contenu: string
          created_at?: string
          dossier_id: string
          id?: string
        }
        Update: {
          auteur_id?: string
          contenu?: string
          created_at?: string
          dossier_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      neoliane_evenements: {
        Row: {
          created_at: string
          erreur: string | null
          etat_rafraichi: Json | null
          event_name: string
          id: string
          payload: Json | null
          refresh_url: string | null
          ressource_id: string | null
          traite: boolean
        }
        Insert: {
          created_at?: string
          erreur?: string | null
          etat_rafraichi?: Json | null
          event_name: string
          id?: string
          payload?: Json | null
          refresh_url?: string | null
          ressource_id?: string | null
          traite?: boolean
        }
        Update: {
          created_at?: string
          erreur?: string | null
          etat_rafraichi?: Json | null
          event_name?: string
          id?: string
          payload?: Json | null
          refresh_url?: string | null
          ressource_id?: string | null
          traite?: boolean
        }
        Relationships: []
      }
      neoliane_parcours: {
        Row: {
          avertissements: Json
          cart_id: string | null
          client_id: string | null
          contract_ids: string[]
          created_at: string
          cree_par: string | null
          date_effet: string | null
          derniere_erreur: string | null
          derniere_reponse: Json | null
          dossier_id: string | null
          etape: string
          id: string
          offer_id: string | null
          pricing_ids: Json
          product_type: string
          profile_id: string | null
          signature_client_ip: string | null
          signature_client_le: string | null
          signature_client_statut: string
          signature_client_ua: string | null
          signature_demandee_le: string | null
          signature_erreur: string | null
          signature_jeton: string | null
          signature_signataire: string | null
          statut: string
          updated_at: string
        }
        Insert: {
          avertissements?: Json
          cart_id?: string | null
          client_id?: string | null
          contract_ids?: string[]
          created_at?: string
          cree_par?: string | null
          date_effet?: string | null
          derniere_erreur?: string | null
          derniere_reponse?: Json | null
          dossier_id?: string | null
          etape?: string
          id?: string
          offer_id?: string | null
          pricing_ids?: Json
          product_type?: string
          profile_id?: string | null
          signature_client_ip?: string | null
          signature_client_le?: string | null
          signature_client_statut?: string
          signature_client_ua?: string | null
          signature_demandee_le?: string | null
          signature_erreur?: string | null
          signature_jeton?: string | null
          signature_signataire?: string | null
          statut?: string
          updated_at?: string
        }
        Update: {
          avertissements?: Json
          cart_id?: string | null
          client_id?: string | null
          contract_ids?: string[]
          created_at?: string
          cree_par?: string | null
          date_effet?: string | null
          derniere_erreur?: string | null
          derniere_reponse?: Json | null
          dossier_id?: string | null
          etape?: string
          id?: string
          offer_id?: string | null
          pricing_ids?: Json
          product_type?: string
          profile_id?: string | null
          signature_client_ip?: string | null
          signature_client_le?: string | null
          signature_client_statut?: string
          signature_client_ua?: string | null
          signature_demandee_le?: string | null
          signature_erreur?: string | null
          signature_jeton?: string | null
          signature_signataire?: string | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "neoliane_parcours_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "neoliane_parcours_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      paiements_partenaires: {
        Row: {
          beneficiaire_id: string
          created_at: string
          created_by: string | null
          date_paiement: string | null
          id: string
          montant: number
          moyen_paiement: string | null
          notes: string | null
          periode: string
          portee: string
          reference: string | null
          updated_at: string
        }
        Insert: {
          beneficiaire_id: string
          created_at?: string
          created_by?: string | null
          date_paiement?: string | null
          id?: string
          montant?: number
          moyen_paiement?: string | null
          notes?: string | null
          periode: string
          portee: string
          reference?: string | null
          updated_at?: string
        }
        Update: {
          beneficiaire_id?: string
          created_at?: string
          created_by?: string | null
          date_paiement?: string | null
          id?: string
          montant?: number
          moyen_paiement?: string | null
          notes?: string | null
          periode?: string
          portee?: string
          reference?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      plan_comptable: {
        Row: {
          actif: boolean
          classe: number
          created_at: string
          description: string | null
          libelle: string
          numero: string
          parent_numero: string | null
          type: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          classe: number
          created_at?: string
          description?: string | null
          libelle: string
          numero: string
          parent_numero?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          classe?: number
          created_at?: string
          description?: string | null
          libelle?: string
          numero?: string
          parent_numero?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_comptable_parent_numero_fkey"
            columns: ["parent_numero"]
            isOneToOne: false
            referencedRelation: "plan_comptable"
            referencedColumns: ["numero"]
          },
        ]
      }
      precompte_lignes: {
        Row: {
          commission_id: string
          contrat_id: string | null
          created_at: string
          id: string
          montant: number
          precompte_id: string
        }
        Insert: {
          commission_id: string
          contrat_id?: string | null
          created_at?: string
          id?: string
          montant: number
          precompte_id: string
        }
        Update: {
          commission_id?: string
          contrat_id?: string | null
          created_at?: string
          id?: string
          montant?: number
          precompte_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "precompte_lignes_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: true
            referencedRelation: "commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precompte_lignes_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precompte_lignes_precompte_id_fkey"
            columns: ["precompte_id"]
            isOneToOne: false
            referencedRelation: "precomptes_mandataires"
            referencedColumns: ["id"]
          },
        ]
      }
      precomptes_mandataires: {
        Row: {
          created_at: string
          created_by: string | null
          envoye_le: string | null
          facture_numero: string | null
          facture_recue_le: string | null
          facture_storage_path: string | null
          facture_validee_le: string | null
          facture_validee_par: string | null
          id: string
          mandataire_id: string
          montant_total: number
          notes: string | null
          periode_debut: string
          periode_fin: string
          statut: string
          valide_le: string | null
          virement_effectue_le: string | null
          virement_effectue_par: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          envoye_le?: string | null
          facture_numero?: string | null
          facture_recue_le?: string | null
          facture_storage_path?: string | null
          facture_validee_le?: string | null
          facture_validee_par?: string | null
          id?: string
          mandataire_id: string
          montant_total?: number
          notes?: string | null
          periode_debut: string
          periode_fin: string
          statut?: string
          valide_le?: string | null
          virement_effectue_le?: string | null
          virement_effectue_par?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          envoye_le?: string | null
          facture_numero?: string | null
          facture_recue_le?: string | null
          facture_storage_path?: string | null
          facture_validee_le?: string | null
          facture_validee_par?: string | null
          id?: string
          mandataire_id?: string
          montant_total?: number
          notes?: string | null
          periode_debut?: string
          periode_fin?: string
          statut?: string
          valide_le?: string | null
          virement_effectue_le?: string | null
          virement_effectue_par?: string | null
        }
        Relationships: []
      }
      prescripteurs: {
        Row: {
          convention_acceptee_le: string | null
          created_at: string
          email: string
          id: string
          nom: string
          prenom: string | null
          statut: string
          telephone: string | null
          type: string
          user_id: string | null
          zone_activite: string | null
        }
        Insert: {
          convention_acceptee_le?: string | null
          created_at?: string
          email: string
          id?: string
          nom: string
          prenom?: string | null
          statut?: string
          telephone?: string | null
          type?: string
          user_id?: string | null
          zone_activite?: string | null
        }
        Update: {
          convention_acceptee_le?: string | null
          created_at?: string
          email?: string
          id?: string
          nom?: string
          prenom?: string | null
          statut?: string
          telephone?: string | null
          type?: string
          user_id?: string | null
          zone_activite?: string | null
        }
        Relationships: []
      }
      produit_documents: {
        Row: {
          created_at: string
          date_effet: string | null
          drive_chemin: string | null
          drive_file_id: string | null
          drive_url: string | null
          id: string
          interne: boolean
          mime_type: string | null
          nom: string
          produit_id: string
          storage_path: string | null
          taille_bytes: number | null
          type: Database["public"]["Enums"]["produit_document_type"]
          updated_at: string
          uploaded_by: string | null
          version: string | null
        }
        Insert: {
          created_at?: string
          date_effet?: string | null
          drive_chemin?: string | null
          drive_file_id?: string | null
          drive_url?: string | null
          id?: string
          interne?: boolean
          mime_type?: string | null
          nom: string
          produit_id: string
          storage_path?: string | null
          taille_bytes?: number | null
          type: Database["public"]["Enums"]["produit_document_type"]
          updated_at?: string
          uploaded_by?: string | null
          version?: string | null
        }
        Update: {
          created_at?: string
          date_effet?: string | null
          drive_chemin?: string | null
          drive_file_id?: string | null
          drive_url?: string | null
          id?: string
          interne?: boolean
          mime_type?: string | null
          nom?: string
          produit_id?: string
          storage_path?: string | null
          taille_bytes?: number | null
          type?: Database["public"]["Enums"]["produit_document_type"]
          updated_at?: string
          uploaded_by?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "produit_documents_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      produit_familles: {
        Row: {
          branches: string[]
          champs_standards: Json
          code: string
          created_at: string
          description: string | null
          id: string
          nom: string
          ordre: number
          updated_at: string
        }
        Insert: {
          branches?: string[]
          champs_standards?: Json
          code: string
          created_at?: string
          description?: string | null
          id?: string
          nom: string
          ordre?: number
          updated_at?: string
        }
        Update: {
          branches?: string[]
          champs_standards?: Json
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          nom?: string
          ordre?: number
          updated_at?: string
        }
        Relationships: []
      }
      produit_formules: {
        Row: {
          actif: boolean
          base_calcul: string
          code: string
          created_at: string
          id: string
          nom: string
          ordre: number
          produit_id: string
          tarif_fixe: number | null
        }
        Insert: {
          actif?: boolean
          base_calcul?: string
          code: string
          created_at?: string
          id?: string
          nom: string
          ordre?: number
          produit_id: string
          tarif_fixe?: number | null
        }
        Update: {
          actif?: boolean
          base_calcul?: string
          code?: string
          created_at?: string
          id?: string
          nom?: string
          ordre?: number
          produit_id?: string
          tarif_fixe?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "produit_formules_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      produit_garanties: {
        Row: {
          created_at: string
          created_by: string | null
          document_source_id: string | null
          famille_code: string
          grille_version: number
          id: string
          notes: string | null
          produit_id: string
          statut: string
          updated_at: string
          valeurs: Json
          valide_le: string | null
          valide_par: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_source_id?: string | null
          famille_code: string
          grille_version?: number
          id?: string
          notes?: string | null
          produit_id: string
          statut?: string
          updated_at?: string
          valeurs?: Json
          valide_le?: string | null
          valide_par?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_source_id?: string | null
          famille_code?: string
          grille_version?: number
          id?: string
          notes?: string | null
          produit_id?: string
          statut?: string
          updated_at?: string
          valeurs?: Json
          valide_le?: string | null
          valide_par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "produit_garanties_document_source_id_fkey"
            columns: ["document_source_id"]
            isOneToOne: false
            referencedRelation: "produit_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produit_garanties_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: true
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      produit_garanties_propositions: {
        Row: {
          assureur_porteur_confiance: number | null
          assureur_porteur_extrait: string | null
          assureur_porteur_propose: string | null
          avertissements: string | null
          created_at: string
          created_by: string | null
          document_id: string | null
          famille_code: string
          grille_version: number
          id: string
          modele_ia: string | null
          produit_id: string
          reference_contrat_propose: string | null
          statut: string
          traite_le: string | null
          traite_par: string | null
          updated_at: string
          valeurs: Json
        }
        Insert: {
          assureur_porteur_confiance?: number | null
          assureur_porteur_extrait?: string | null
          assureur_porteur_propose?: string | null
          avertissements?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          famille_code: string
          grille_version?: number
          id?: string
          modele_ia?: string | null
          produit_id: string
          reference_contrat_propose?: string | null
          statut?: string
          traite_le?: string | null
          traite_par?: string | null
          updated_at?: string
          valeurs?: Json
        }
        Update: {
          assureur_porteur_confiance?: number | null
          assureur_porteur_extrait?: string | null
          assureur_porteur_propose?: string | null
          avertissements?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          famille_code?: string
          grille_version?: number
          id?: string
          modele_ia?: string | null
          produit_id?: string
          reference_contrat_propose?: string | null
          statut?: string
          traite_le?: string | null
          traite_par?: string | null
          updated_at?: string
          valeurs?: Json
        }
        Relationships: [
          {
            foreignKeyName: "produit_garanties_propositions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "produit_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produit_garanties_propositions_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      produit_options: {
        Row: {
          actif: boolean
          created_at: string
          description: string | null
          id: string
          nom: string
          ordre: number
          produit_id: string
          tarif_fixe: number | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          description?: string | null
          id?: string
          nom: string
          ordre?: number
          produit_id: string
          tarif_fixe?: number | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          description?: string | null
          id?: string
          nom?: string
          ordre?: number
          produit_id?: string
          tarif_fixe?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produit_options_produit_id_fkey"
            columns: ["produit_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      produits: {
        Row: {
          assureur_porteur: string | null
          caracteristiques: Json
          cible: string | null
          code_produit: string | null
          commission_taux: number | null
          compagnie_id: string
          contrat_star: boolean
          couplage_message: string | null
          created_at: string
          created_by: string | null
          description: string | null
          famille_id: string
          famille_requise_id: string | null
          frais_arbitrage_pct: number | null
          frais_gestion_pct: number | null
          frais_versement_pct: number | null
          id: string
          image_url: string | null
          mode_tarification: string
          nom: string
          periodicite_cotisation: string
          points_forts: string | null
          points_vigilance: string | null
          produit_requis_id: string | null
          reference_contrat: string | null
          statut: Database["public"]["Enums"]["produit_statut"]
          updated_at: string
        }
        Insert: {
          assureur_porteur?: string | null
          caracteristiques?: Json
          cible?: string | null
          code_produit?: string | null
          commission_taux?: number | null
          compagnie_id: string
          contrat_star?: boolean
          couplage_message?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          famille_id: string
          famille_requise_id?: string | null
          frais_arbitrage_pct?: number | null
          frais_gestion_pct?: number | null
          frais_versement_pct?: number | null
          id?: string
          image_url?: string | null
          mode_tarification?: string
          nom: string
          periodicite_cotisation?: string
          points_forts?: string | null
          points_vigilance?: string | null
          produit_requis_id?: string | null
          reference_contrat?: string | null
          statut?: Database["public"]["Enums"]["produit_statut"]
          updated_at?: string
        }
        Update: {
          assureur_porteur?: string | null
          caracteristiques?: Json
          cible?: string | null
          code_produit?: string | null
          commission_taux?: number | null
          compagnie_id?: string
          contrat_star?: boolean
          couplage_message?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          famille_id?: string
          famille_requise_id?: string | null
          frais_arbitrage_pct?: number | null
          frais_gestion_pct?: number | null
          frais_versement_pct?: number | null
          id?: string
          image_url?: string | null
          mode_tarification?: string
          nom?: string
          periodicite_cotisation?: string
          points_forts?: string | null
          points_vigilance?: string | null
          produit_requis_id?: string | null
          reference_contrat?: string | null
          statut?: Database["public"]["Enums"]["produit_statut"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produits_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produits_famille_id_fkey"
            columns: ["famille_id"]
            isOneToOne: false
            referencedRelation: "produit_familles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produits_famille_requise_id_fkey"
            columns: ["famille_requise_id"]
            isOneToOne: false
            referencedRelation: "produit_familles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produits_produit_requis_id_fkey"
            columns: ["produit_requis_id"]
            isOneToOne: false
            referencedRelation: "produits"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          must_change_password: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          must_change_password?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          must_change_password?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      projets: {
        Row: {
          assigne_a: string | null
          client_id: string
          created_at: string
          created_by: string | null
          date_cloture_prevue: string | null
          etape: string
          id: string
          montant_estime: number | null
          notes: string | null
          probabilite: number
          produit: string | null
          titre: string
          updated_at: string
        }
        Insert: {
          assigne_a?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          date_cloture_prevue?: string | null
          etape?: string
          id?: string
          montant_estime?: number | null
          notes?: string | null
          probabilite?: number
          produit?: string | null
          titre: string
          updated_at?: string
        }
        Update: {
          assigne_a?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          date_cloture_prevue?: string | null
          etape?: string
          id?: string
          montant_estime?: number | null
          notes?: string | null
          probabilite?: number
          produit?: string | null
          titre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reclamations: {
        Row: {
          client_id: string
          compagnie_id: string | null
          concerne: string
          contrat_id: string | null
          created_at: string
          created_by: string | null
          date_accuse_reception: string | null
          date_cloture: string | null
          date_ouverture: string
          gmail_message_id: string | null
          id: string
          reference: string | null
          resume: string | null
          solution_proposee: string | null
          statut: string
          updated_at: string
        }
        Insert: {
          client_id: string
          compagnie_id?: string | null
          concerne?: string
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          date_accuse_reception?: string | null
          date_cloture?: string | null
          date_ouverture?: string
          gmail_message_id?: string | null
          id?: string
          reference?: string | null
          resume?: string | null
          solution_proposee?: string | null
          statut?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          compagnie_id?: string | null
          concerne?: string
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          date_accuse_reception?: string | null
          date_cloture?: string | null
          date_ouverture?: string
          gmail_message_id?: string | null
          id?: string
          reference?: string | null
          resume?: string | null
          solution_proposee?: string | null
          statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reclamations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reclamations_compagnie_id_fkey"
            columns: ["compagnie_id"]
            isOneToOne: false
            referencedRelation: "compagnies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reclamations_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
        ]
      }
      recommandations_prescripteur: {
        Row: {
          client_id: string | null
          commission_id: string | null
          created_at: string
          description: string | null
          dossier_id: string | null
          id: string
          montant_du: number
          nom_contact: string
          prescripteur_id: string
          statut: string
          verse: boolean
          verse_le: string | null
        }
        Insert: {
          client_id?: string | null
          commission_id?: string | null
          created_at?: string
          description?: string | null
          dossier_id?: string | null
          id?: string
          montant_du?: number
          nom_contact: string
          prescripteur_id: string
          statut?: string
          verse?: boolean
          verse_le?: string | null
        }
        Update: {
          client_id?: string | null
          commission_id?: string | null
          created_at?: string
          description?: string | null
          dossier_id?: string | null
          id?: string
          montant_du?: number
          nom_contact?: string
          prescripteur_id?: string
          statut?: string
          verse?: boolean
          verse_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommandations_prescripteur_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommandations_prescripteur_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommandations_prescripteur_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommandations_prescripteur_prescripteur_id_fkey"
            columns: ["prescripteur_id"]
            isOneToOne: false
            referencedRelation: "prescripteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_compteurs: {
        Row: {
          cle: string
          dernier: number
        }
        Insert: {
          cle: string
          dernier?: number
        }
        Update: {
          cle?: string
          dernier?: number
        }
        Relationships: []
      }
      registre_traitements_rgpd: {
        Row: {
          base_legale: string | null
          categories_donnees: string | null
          created_at: string
          created_by: string | null
          destinataires: string | null
          duree_conservation: string | null
          finalite: string | null
          id: string
          mesures_securite: string | null
          nom_traitement: string
          personnes_concernees: string | null
          revise_le: string | null
          sous_traitants: string | null
          transfert_hors_ue: boolean
          updated_at: string
          version: number
        }
        Insert: {
          base_legale?: string | null
          categories_donnees?: string | null
          created_at?: string
          created_by?: string | null
          destinataires?: string | null
          duree_conservation?: string | null
          finalite?: string | null
          id?: string
          mesures_securite?: string | null
          nom_traitement: string
          personnes_concernees?: string | null
          revise_le?: string | null
          sous_traitants?: string | null
          transfert_hors_ue?: boolean
          updated_at?: string
          version?: number
        }
        Update: {
          base_legale?: string | null
          categories_donnees?: string | null
          created_at?: string
          created_by?: string | null
          destinataires?: string | null
          duree_conservation?: string | null
          finalite?: string | null
          id?: string
          mesures_securite?: string | null
          nom_traitement?: string
          personnes_concernees?: string | null
          revise_le?: string | null
          sous_traitants?: string | null
          transfert_hors_ue?: boolean
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      rgpd_demandes_droits: {
        Row: {
          canal_reception: string | null
          client_id: string | null
          created_at: string
          demandeur_email: string | null
          demandeur_nom: string
          echeance_le: string
          id: string
          recue_le: string
          reponse_le: string | null
          reponse_resume: string | null
          statut: string
          traite_par: string | null
          type: string
          updated_at: string
        }
        Insert: {
          canal_reception?: string | null
          client_id?: string | null
          created_at?: string
          demandeur_email?: string | null
          demandeur_nom: string
          echeance_le?: string
          id?: string
          recue_le?: string
          reponse_le?: string | null
          reponse_resume?: string | null
          statut?: string
          traite_par?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          canal_reception?: string | null
          client_id?: string | null
          created_at?: string
          demandeur_email?: string | null
          demandeur_nom?: string
          echeance_le?: string
          id?: string
          recue_le?: string
          reponse_le?: string | null
          reponse_resume?: string | null
          statut?: string
          traite_par?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rgpd_demandes_droits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      rgpd_violations: {
        Row: {
          created_at: string
          decouverte_le: string
          description: string | null
          donnees_concernees: string | null
          gravite: string
          id: string
          mesures: string | null
          nature: string | null
          notification_cnil: boolean
          notification_cnil_le: string | null
          notification_personnes: boolean
          personnes_concernees_nb: number | null
          statut: string
          survenue_le: string
          titre: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decouverte_le?: string
          description?: string | null
          donnees_concernees?: string | null
          gravite?: string
          id?: string
          mesures?: string | null
          nature?: string | null
          notification_cnil?: boolean
          notification_cnil_le?: string | null
          notification_personnes?: boolean
          personnes_concernees_nb?: number | null
          statut?: string
          survenue_le?: string
          titre: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decouverte_le?: string
          description?: string | null
          donnees_concernees?: string | null
          gravite?: string
          id?: string
          mesures?: string | null
          nature?: string | null
          notification_cnil?: boolean
          notification_cnil_le?: string | null
          notification_personnes?: boolean
          personnes_concernees_nb?: number | null
          statut?: string
          survenue_le?: string
          titre?: string
          updated_at?: string
        }
        Relationships: []
      }
      simulassur_dossiers: {
        Row: {
          assureur: string | null
          client_id: string | null
          contrat_ref: string | null
          created_at: string
          created_by: string | null
          derniere_erreur: string | null
          devis_id: string | null
          dossier_id: string
          espaces_clients: Json
          id: string
          produit_code: string | null
          quote_id: string | null
          request_hash: string | null
          simulation_id: string | null
          suivi_le: string | null
          suivi_partiel: boolean
          suivi_statuts: Json
          transfert_le: string | null
          transfert_reponse: Json | null
          transfert_statut: string
          updated_at: string
        }
        Insert: {
          assureur?: string | null
          client_id?: string | null
          contrat_ref?: string | null
          created_at?: string
          created_by?: string | null
          derniere_erreur?: string | null
          devis_id?: string | null
          dossier_id: string
          espaces_clients?: Json
          id?: string
          produit_code?: string | null
          quote_id?: string | null
          request_hash?: string | null
          simulation_id?: string | null
          suivi_le?: string | null
          suivi_partiel?: boolean
          suivi_statuts?: Json
          transfert_le?: string | null
          transfert_reponse?: Json | null
          transfert_statut?: string
          updated_at?: string
        }
        Update: {
          assureur?: string | null
          client_id?: string | null
          contrat_ref?: string | null
          created_at?: string
          created_by?: string | null
          derniere_erreur?: string | null
          devis_id?: string | null
          dossier_id?: string
          espaces_clients?: Json
          id?: string
          produit_code?: string | null
          quote_id?: string | null
          request_hash?: string | null
          simulation_id?: string | null
          suivi_le?: string | null
          suivi_partiel?: boolean
          suivi_statuts?: Json
          transfert_le?: string | null
          transfert_reponse?: Json | null
          transfert_statut?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulassur_dossiers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulassur_dossiers_devis_id_fkey"
            columns: ["devis_id"]
            isOneToOne: false
            referencedRelation: "dossier_devis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulassur_dossiers_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: true
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      simulassur_evenements: {
        Row: {
          correlation_id: string
          created_at: string
          dossier_id: string | null
          duree_ms: number | null
          endpoint: string
          erreur: string | null
          http_status: number | null
          id: string
          methode: string
          ok: boolean
        }
        Insert: {
          correlation_id: string
          created_at?: string
          dossier_id?: string | null
          duree_ms?: number | null
          endpoint: string
          erreur?: string | null
          http_status?: number | null
          id?: string
          methode: string
          ok?: boolean
        }
        Update: {
          correlation_id?: string
          created_at?: string
          dossier_id?: string | null
          duree_ms?: number | null
          endpoint?: string
          erreur?: string | null
          http_status?: number | null
          id?: string
          methode?: string
          ok?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "simulassur_evenements_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      sinistre_evenements: {
        Row: {
          ancienne_etape: string | null
          contenu: string | null
          created_at: string
          id: string
          nouvelle_etape: string | null
          par: string | null
          sinistre_id: string
          type: string
        }
        Insert: {
          ancienne_etape?: string | null
          contenu?: string | null
          created_at?: string
          id?: string
          nouvelle_etape?: string | null
          par?: string | null
          sinistre_id: string
          type?: string
        }
        Update: {
          ancienne_etape?: string | null
          contenu?: string | null
          created_at?: string
          id?: string
          nouvelle_etape?: string | null
          par?: string | null
          sinistre_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sinistre_evenements_sinistre_id_fkey"
            columns: ["sinistre_id"]
            isOneToOne: false
            referencedRelation: "sinistres"
            referencedColumns: ["id"]
          },
        ]
      }
      sinistre_pieces: {
        Row: {
          code: string
          commentaire: string | null
          created_at: string
          id: string
          libelle: string
          mime_type: string | null
          nom_fichier: string | null
          obligatoire: boolean
          sinistre_id: string
          statut: string
          storage_path: string | null
          taille: number | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          code: string
          commentaire?: string | null
          created_at?: string
          id?: string
          libelle: string
          mime_type?: string | null
          nom_fichier?: string | null
          obligatoire?: boolean
          sinistre_id: string
          statut?: string
          storage_path?: string | null
          taille?: number | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          code?: string
          commentaire?: string | null
          created_at?: string
          id?: string
          libelle?: string
          mime_type?: string | null
          nom_fichier?: string | null
          obligatoire?: boolean
          sinistre_id?: string
          statut?: string
          storage_path?: string | null
          taille?: number | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sinistre_pieces_sinistre_id_fkey"
            columns: ["sinistre_id"]
            isOneToOne: false
            referencedRelation: "sinistres"
            referencedColumns: ["id"]
          },
        ]
      }
      sinistres: {
        Row: {
          action_recommandee: string | null
          analyse_couverture: string | null
          branche: string | null
          client_id: string
          clos_le: string | null
          contrat_id: string | null
          created_at: string
          created_by: string | null
          date_ouverture: string
          date_survenance: string | null
          declare_compagnie_le: string | null
          declare_le: string | null
          declare_par_client: boolean
          description: string | null
          etape: string
          gestionnaire: string | null
          gmail_message_id: string | null
          id: string
          montant: number | null
          montant_indemnise: number | null
          notes: string | null
          numero_compagnie: string | null
          rappel_sans_action_le: string | null
          reference: string | null
          resume: string | null
          statut: string
          type: string | null
          updated_at: string
        }
        Insert: {
          action_recommandee?: string | null
          analyse_couverture?: string | null
          branche?: string | null
          client_id: string
          clos_le?: string | null
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          date_ouverture?: string
          date_survenance?: string | null
          declare_compagnie_le?: string | null
          declare_le?: string | null
          declare_par_client?: boolean
          description?: string | null
          etape?: string
          gestionnaire?: string | null
          gmail_message_id?: string | null
          id?: string
          montant?: number | null
          montant_indemnise?: number | null
          notes?: string | null
          numero_compagnie?: string | null
          rappel_sans_action_le?: string | null
          reference?: string | null
          resume?: string | null
          statut?: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          action_recommandee?: string | null
          analyse_couverture?: string | null
          branche?: string | null
          client_id?: string
          clos_le?: string | null
          contrat_id?: string | null
          created_at?: string
          created_by?: string | null
          date_ouverture?: string
          date_survenance?: string | null
          declare_compagnie_le?: string | null
          declare_le?: string | null
          declare_par_client?: boolean
          description?: string | null
          etape?: string
          gestionnaire?: string | null
          gmail_message_id?: string | null
          id?: string
          montant?: number | null
          montant_indemnise?: number | null
          notes?: string | null
          numero_compagnie?: string | null
          rappel_sans_action_le?: string | null
          reference?: string | null
          resume?: string | null
          statut?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sinistres_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistres_contrat_id_fkey"
            columns: ["contrat_id"]
            isOneToOne: false
            referencedRelation: "contrats"
            referencedColumns: ["id"]
          },
        ]
      }
      taches: {
        Row: {
          assignee_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          dossier_id: string | null
          echeance: string | null
          id: string
          priorite: Database["public"]["Enums"]["tache_priorite"]
          statut: Database["public"]["Enums"]["tache_statut"]
          titre: string
          type: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dossier_id?: string | null
          echeance?: string | null
          id?: string
          priorite?: Database["public"]["Enums"]["tache_priorite"]
          statut?: Database["public"]["Enums"]["tache_statut"]
          titre: string
          type?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dossier_id?: string | null
          echeance?: string | null
          id?: string
          priorite?: Database["public"]["Enums"]["tache_priorite"]
          statut?: Database["public"]["Enums"]["tache_statut"]
          titre?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "taches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "taches_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      tiers: {
        Row: {
          actif: boolean
          adresse: string | null
          code_postal: string | null
          compte_auxiliaire: string | null
          created_at: string
          email: string | null
          iban: string | null
          id: string
          nom: string
          numero_tva: string | null
          siret: string | null
          telephone: string | null
          type: string
          updated_at: string
          ville: string | null
        }
        Insert: {
          actif?: boolean
          adresse?: string | null
          code_postal?: string | null
          compte_auxiliaire?: string | null
          created_at?: string
          email?: string | null
          iban?: string | null
          id?: string
          nom: string
          numero_tva?: string | null
          siret?: string | null
          telephone?: string | null
          type: string
          updated_at?: string
          ville?: string | null
        }
        Update: {
          actif?: boolean
          adresse?: string | null
          code_postal?: string | null
          compte_auxiliaire?: string | null
          created_at?: string
          email?: string | null
          iban?: string | null
          id?: string
          nom?: string
          numero_tva?: string | null
          siret?: string | null
          telephone?: string | null
          type?: string
          updated_at?: string
          ville?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      veille_reglementaire: {
        Row: {
          created_at: string
          date_reception: string
          document_source_url: string | null
          gmail_message_id: string | null
          id: string
          impact_assurance: boolean
          resume: string | null
          source: string
          statut: string
          sujet: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_reception?: string
          document_source_url?: string | null
          gmail_message_id?: string | null
          id?: string
          impact_assurance?: boolean
          resume?: string | null
          source?: string
          statut?: string
          sujet: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_reception?: string
          document_source_url?: string | null
          gmail_message_id?: string | null
          id?: string
          impact_assurance?: boolean
          resume?: string | null
          source?: string
          statut?: string
          sujet?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      branche_contrat: { Args: { _contrat_id: string }; Returns: string }
      calculer_fiscalite_prime_ttc: {
        Args: {
          p_contribution_attentat?: number
          p_prime_ttc: number
          p_regime: string
        }
        Returns: Json
      }
      calculer_risque_lcbft: {
        Args: { _client_id: string }
        Returns: {
          client_id: string
          created_at: string
          decide_le: string | null
          decide_par: string | null
          facteurs: Json
          id: string
          justification: string | null
          niveau_vigilance: string
          ppe_detecte: boolean
          prochaine_revue_le: string | null
          score_risque: number
          statut: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "client_risque_lcbft"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calculer_risque_residuel: {
        Args: {
          _impact: number
          _niveau_maitrise: number
          _probabilite: number
        }
        Returns: string
      }
      calculer_score_conformite_client: {
        Args: { _client_id: string }
        Returns: number
      }
      can_access_client: { Args: { _client_id: string }; Returns: boolean }
      can_access_contrat: { Args: { _contrat_id: string }; Returns: boolean }
      can_access_dossier: { Args: { _dossier_id: string }; Returns: boolean }
      code_risque: { Args: { _type: string }; Returns: string }
      corriger_contrat_actif: {
        Args: { _champs: Json; _contrat_id: string; _motif: string }
        Returns: undefined
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      economies_emprunteur: {
        Args: { _mandataire_id?: string }
        Returns: {
          capital_total: number
          economie_moyenne: number
          nb_contrats: number
          total_economies: number
        }[]
      }
      est_manager_actif_de: { Args: { _membre_id: string }; Returns: boolean }
      generer_reference: {
        Args: { _annee: number; _prefixe: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      log_audit: {
        Args: {
          _action: string
          _metadata?: Json
          _target_id?: string
          _target_type: string
        }
        Returns: undefined
      }
      nb_assures_emprunteur: { Args: { _dossier_id: string }; Returns: number }
      neoliane_reduire_json: { Args: { _data: Json }; Returns: Json }
      periodicite_suivi_mois: {
        Args: { _branche: string; _recommandation: boolean }
        Returns: number
      }
      purger_neoliane_evenements: { Args: never; Returns: undefined }
      purger_simulassur_evenements: { Args: never; Returns: undefined }
      recalculer_echeances_contrat: {
        Args: { _contrat_id: string }
        Returns: undefined
      }
      recalculer_prevision_contrat: {
        Args: { _contrat_id: string }
        Returns: undefined
      }
      replanifier_suivi_client: {
        Args: { _client_id: string }
        Returns: number
      }
      score_conformite_cabinet: {
        Args: never
        Returns: {
          nb_a_relancer: number
          nb_clients: number
          nb_orange: number
          nb_rouge: number
          nb_vert: number
          niveau: string
          score: number
        }[]
      }
      score_valeur_client: { Args: { p_client_id: string }; Returns: number }
      scores_valeur_clients: {
        Args: never
        Returns: {
          client_id: string
          score: number
        }[]
      }
      solde_compte: {
        Args: { _compte: string; _date_debut: string; _date_fin: string }
        Returns: {
          solde: number
          total_credit: number
          total_debit: number
        }[]
      }
      trouver_taux_cabinet: {
        Args: {
          _compagnie_id: string
          _date: string
          _famille_id: string
          _produit_id: string
        }
        Returns: {
          assiette: string
          taux: number
        }[]
      }
      trouver_taux_regle: {
        Args: {
          _beneficiaire_id: string
          _compagnie_id: string
          _date: string
          _famille_id: string
          _portee: string
          _produit_id: string
        }
        Returns: {
          assiette: string
          taux: number
        }[]
      }
      verifier_equilibre_ecriture: {
        Args: { _ecriture_id: string }
        Returns: boolean
      }
    }
    Enums: {
      activite_type: "note" | "appel" | "email" | "sms" | "systeme" | "rdv"
      api_auth_type: "none" | "api_key" | "bearer" | "oauth2" | "basic"
      app_role: "admin" | "mandataire" | "client" | "prescripteur"
      client_kyc_type: "cni" | "justificatif_domicile" | "rib" | "kbis"
      client_origine:
        | "internet"
        | "assurlead"
        | "telephone"
        | "apporteur"
        | "reseau"
        | "autre"
        | "parrainage"
        | "recommandation"
        | "contact_perso"
        | "reseaux_sociaux"
      client_statut: "prospect" | "actif" | "inactif" | "perdu" | "ancien"
      commission_statut: "prevue" | "versee" | "annulee"
      compagnie_doc_type:
        | "contrat_partenariat"
        | "avenant"
        | "protocole_commissions"
        | "conditions_apporteur"
        | "autre"
      compagnie_statut: "actif" | "prospect" | "inactif"
      conformite_doc_type:
        | "cni"
        | "justificatif_domicile"
        | "orias"
        | "association_pro"
        | "rcpro"
        | "der"
        | "autre"
      dossier_statut:
        | "nouveau"
        | "en_cours"
        | "signe"
        | "perdu"
        | "lettre_mission_envoyee"
        | "dda_validee"
        | "devis_en_cours"
        | "devoir_conseil_envoye"
        | "devoir_conseil_signe"
        | "devoir_conseil_refuse"
        | "souscription_envoyee"
        | "contrat_valide"
        | "contrat_actif"
        | "cloture"
      produit_document_type:
        | "conditions_generales"
        | "ipid"
        | "fiche_produit"
        | "tarifs"
        | "autre"
        | "tableau_garanties"
        | "ccsf"
      produit_statut: "actif" | "en_test" | "retire"
      tache_priorite: "basse" | "normale" | "haute" | "urgente"
      tache_statut:
        | "a_faire"
        | "en_cours"
        | "terminee"
        | "annulee"
        | "a_qualifier"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activite_type: ["note", "appel", "email", "sms", "systeme", "rdv"],
      api_auth_type: ["none", "api_key", "bearer", "oauth2", "basic"],
      app_role: ["admin", "mandataire", "client", "prescripteur"],
      client_kyc_type: ["cni", "justificatif_domicile", "rib", "kbis"],
      client_origine: [
        "internet",
        "assurlead",
        "telephone",
        "apporteur",
        "reseau",
        "autre",
        "parrainage",
        "recommandation",
        "contact_perso",
        "reseaux_sociaux",
      ],
      client_statut: ["prospect", "actif", "inactif", "perdu", "ancien"],
      commission_statut: ["prevue", "versee", "annulee"],
      compagnie_doc_type: [
        "contrat_partenariat",
        "avenant",
        "protocole_commissions",
        "conditions_apporteur",
        "autre",
      ],
      compagnie_statut: ["actif", "prospect", "inactif"],
      conformite_doc_type: [
        "cni",
        "justificatif_domicile",
        "orias",
        "association_pro",
        "rcpro",
        "der",
        "autre",
      ],
      dossier_statut: [
        "nouveau",
        "en_cours",
        "signe",
        "perdu",
        "lettre_mission_envoyee",
        "dda_validee",
        "devis_en_cours",
        "devoir_conseil_envoye",
        "devoir_conseil_signe",
        "devoir_conseil_refuse",
        "souscription_envoyee",
        "contrat_valide",
        "contrat_actif",
        "cloture",
      ],
      produit_document_type: [
        "conditions_generales",
        "ipid",
        "fiche_produit",
        "tarifs",
        "autre",
        "tableau_garanties",
        "ccsf",
      ],
      produit_statut: ["actif", "en_test", "retire"],
      tache_priorite: ["basse", "normale", "haute", "urgente"],
      tache_statut: [
        "a_faire",
        "en_cours",
        "terminee",
        "annulee",
        "a_qualifier",
      ],
    },
  },
} as const
