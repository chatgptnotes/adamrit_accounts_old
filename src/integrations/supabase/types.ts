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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accommodations: {
        Row: {
          created_at: string | null
          id: string
          nabh_bhopal: number | null
          nabh_rate: number | null
          non_nabh_bhopal: number | null
          non_nabh_rate: number | null
          private_rate: number | null
          room_type: string
          tpa_rate: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          nabh_bhopal?: number | null
          nabh_rate?: number | null
          non_nabh_bhopal?: number | null
          non_nabh_rate?: number | null
          private_rate?: number | null
          room_type: string
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nabh_bhopal?: number | null
          nabh_rate?: number | null
          non_nabh_bhopal?: number | null
          non_nabh_rate?: number | null
          private_rate?: number | null
          room_type?: string
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      advance_payment: {
        Row: {
          advance_amount: number
          bank_account_id: string | null
          bank_account_name: string | null
          bill_no: string | null
          billing_executive: string | null
          created_at: string | null
          created_by: string | null
          date_of_admission: string | null
          id: string
          is_refund: boolean | null
          package_days: number | null
          package_name: string | null
          patient_id: string
          patient_name: string
          patients_id: string | null
          payment_date: string
          payment_mode: string
          reference_number: string | null
          refund_reason: string | null
          remarks: string | null
          returned_amount: number | null
          status: string | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          advance_amount: number
          bank_account_id?: string | null
          bank_account_name?: string | null
          bill_no?: string | null
          billing_executive?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_admission?: string | null
          id?: string
          is_refund?: boolean | null
          package_days?: number | null
          package_name?: string | null
          patient_id: string
          patient_name: string
          patients_id?: string | null
          payment_date: string
          payment_mode: string
          reference_number?: string | null
          refund_reason?: string | null
          remarks?: string | null
          returned_amount?: number | null
          status?: string | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          advance_amount?: number
          bank_account_id?: string | null
          bank_account_name?: string | null
          bill_no?: string | null
          billing_executive?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_admission?: string | null
          id?: string
          is_refund?: boolean | null
          package_days?: number | null
          package_name?: string | null
          patient_id?: string
          patient_name?: string
          patients_id?: string | null
          payment_date?: string
          payment_mode?: string
          reference_number?: string | null
          refund_reason?: string | null
          remarks?: string | null
          returned_amount?: number | null
          status?: string | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "advance_payment_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_payment_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_payment_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      agent_audit_log: {
        Row: {
          action: string
          agent: string
          agent_version: string | null
          created_at: string | null
          details: Json | null
          id: number
          medicine_id: string | null
        }
        Insert: {
          action: string
          agent: string
          agent_version?: string | null
          created_at?: string | null
          details?: Json | null
          id?: number
          medicine_id?: string | null
        }
        Update: {
          action?: string
          agent?: string
          agent_version?: string | null
          created_at?: string | null
          details?: Json | null
          id?: number
          medicine_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_audit_log_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicine_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_audit_log_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacy_low_stock_alert"
            referencedColumns: ["id"]
          },
        ]
      }
      aging_snapshots: {
        Row: {
          bucket_0_30: number | null
          bucket_181_365: number | null
          bucket_31_60: number | null
          bucket_365_plus: number | null
          bucket_61_90: number | null
          bucket_91_180: number | null
          created_at: string | null
          id: string
          patient_id: string | null
          snapshot_date: string
          total_outstanding: number
        }
        Insert: {
          bucket_0_30?: number | null
          bucket_181_365?: number | null
          bucket_31_60?: number | null
          bucket_365_plus?: number | null
          bucket_61_90?: number | null
          bucket_91_180?: number | null
          created_at?: string | null
          id?: string
          patient_id?: string | null
          snapshot_date: string
          total_outstanding: number
        }
        Update: {
          bucket_0_30?: number | null
          bucket_181_365?: number | null
          bucket_31_60?: number | null
          bucket_365_plus?: number | null
          bucket_61_90?: number | null
          bucket_91_180?: number | null
          created_at?: string | null
          id?: string
          patient_id?: string | null
          snapshot_date?: string
          total_outstanding?: number
        }
        Relationships: [
          {
            foreignKeyName: "aging_snapshots_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aging_snapshots_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      ai_clinical_recommendations: {
        Row: {
          ai_model: string | null
          applied_at: string | null
          complications: Json | null
          confidence_score: number | null
          created_at: string | null
          diagnosis_text: string | null
          generated_at: string | null
          id: string
          lab_tests: Json | null
          medications: Json | null
          notes: string | null
          prompt_version: string | null
          radiology_procedures: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          selected_complications: Json | null
          status: string | null
          surgery_names: string[] | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          ai_model?: string | null
          applied_at?: string | null
          complications?: Json | null
          confidence_score?: number | null
          created_at?: string | null
          diagnosis_text?: string | null
          generated_at?: string | null
          id?: string
          lab_tests?: Json | null
          medications?: Json | null
          notes?: string | null
          prompt_version?: string | null
          radiology_procedures?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selected_complications?: Json | null
          status?: string | null
          surgery_names?: string[] | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          ai_model?: string | null
          applied_at?: string | null
          complications?: Json | null
          confidence_score?: number | null
          created_at?: string | null
          diagnosis_text?: string | null
          generated_at?: string | null
          id?: string
          lab_tests?: Json | null
          medications?: Json | null
          notes?: string | null
          prompt_version?: string | null
          radiology_procedures?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selected_complications?: Json | null
          status?: string | null
          surgery_names?: string[] | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_clinical_recommendations_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_date: string
          chief_complaint: string | null
          created_at: string | null
          created_by: string | null
          doctor_id: string | null
          id: string
          notes: string | null
          patient_age: number | null
          patient_id: string | null
          patient_mobile: string | null
          patient_name: string
          status: string | null
          time_slot: string
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          appointment_date: string
          chief_complaint?: string | null
          created_at?: string | null
          created_by?: string | null
          doctor_id?: string | null
          id?: string
          notes?: string | null
          patient_age?: number | null
          patient_id?: string | null
          patient_mobile?: string | null
          patient_name: string
          status?: string | null
          time_slot: string
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          appointment_date?: string
          chief_complaint?: string | null
          created_at?: string | null
          created_by?: string | null
          doctor_id?: string | null
          id?: string
          notes?: string | null
          patient_age?: number | null
          patient_id?: string | null
          patient_mobile?: string | null
          patient_name?: string
          status?: string | null
          time_slot?: string
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "appointments_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_trail: {
        Row: {
          action: string
          bill_id: string
          changed_by: string | null
          changes: Json | null
          id: string
          timestamp: string
        }
        Insert: {
          action: string
          bill_id: string
          changed_by?: string | null
          changes?: Json | null
          id?: string
          timestamp?: string
        }
        Update: {
          action?: string
          bill_id?: string
          changed_by?: string | null
          changes?: Json | null
          id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_trail_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      ayushman_anaesthetists: {
        Row: {
          contact_info: string | null
          general_rate: number | null
          name: string
          specialty: string | null
          spinal_rate: number | null
        }
        Insert: {
          contact_info?: string | null
          general_rate?: number | null
          name: string
          specialty?: string | null
          spinal_rate?: number | null
        }
        Update: {
          contact_info?: string | null
          general_rate?: number | null
          name?: string
          specialty?: string | null
          spinal_rate?: number | null
        }
        Relationships: []
      }
      ayushman_consultants: {
        Row: {
          contact_info: string | null
          created_at: string | null
          department: string | null
          id: string
          nabh_rate: number | null
          name: string
          non_nabh_rate: number | null
          phone: string | null
          private_rate: number | null
          specialty: string | null
          tpa_rate: number | null
          updated_at: string | null
        }
        Insert: {
          contact_info?: string | null
          created_at?: string | null
          department?: string | null
          id?: string
          nabh_rate?: number | null
          name: string
          non_nabh_rate?: number | null
          phone?: string | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          contact_info?: string | null
          created_at?: string | null
          department?: string | null
          id?: string
          nabh_rate?: number | null
          name?: string
          non_nabh_rate?: number | null
          phone?: string | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ayushman_rmos: {
        Row: {
          contact_info: string | null
          created_at: string | null
          daily_remuneration: number | null
          department: string | null
          id: string
          is_active: boolean | null
          nabh_rate: number | null
          name: string
          non_nabh_rate: number | null
          private_rate: number | null
          specialty: string | null
          tpa_rate: number | null
          updated_at: string | null
        }
        Insert: {
          contact_info?: string | null
          created_at?: string | null
          daily_remuneration?: number | null
          department?: string | null
          id?: string
          is_active?: boolean | null
          nabh_rate?: number | null
          name: string
          non_nabh_rate?: number | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          contact_info?: string | null
          created_at?: string | null
          daily_remuneration?: number | null
          department?: string | null
          id?: string
          is_active?: boolean | null
          nabh_rate?: number | null
          name?: string
          non_nabh_rate?: number | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ayushman_surgeons: {
        Row: {
          contact_info: string | null
          created_at: string | null
          department: string | null
          id: string
          is_active: boolean | null
          nabh_rate: number | null
          name: string
          non_nabh_rate: number | null
          private_rate: number | null
          specialty: string | null
          tpa_rate: number | null
          updated_at: string | null
        }
        Insert: {
          contact_info?: string | null
          created_at?: string | null
          department?: string | null
          id?: string
          is_active?: boolean | null
          nabh_rate?: number | null
          name: string
          non_nabh_rate?: number | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          contact_info?: string | null
          created_at?: string | null
          department?: string | null
          id?: string
          is_active?: boolean | null
          nabh_rate?: number | null
          name?: string
          non_nabh_rate?: number | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      b2b_partners: {
        Row: {
          address: string | null
          commission_rate: number | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          credit_limit: number | null
          id: string
          is_active: boolean | null
          login_pin: string | null
          name: string
          notes: string | null
          outstanding: number | null
          partner_code: string
          type: string
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          commission_rate?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          credit_limit?: number | null
          id?: string
          is_active?: boolean | null
          login_pin?: string | null
          name: string
          notes?: string | null
          outstanding?: number | null
          partner_code: string
          type: string
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          commission_rate?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          credit_limit?: number | null
          id?: string
          is_active?: boolean | null
          login_pin?: string | null
          name?: string
          notes?: string | null
          outstanding?: number | null
          partner_code?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      batch_stock_movements: {
        Row: {
          batch_inventory_id: string
          batch_number: string
          hospital_name: string | null
          id: string
          medicine_id: string
          movement_date: string | null
          movement_type: string
          performed_by: string | null
          quantity_after: number
          quantity_before: number
          quantity_changed: number
          reason: string | null
          reference_id: string | null
          reference_number: string | null
          reference_type: string | null
          remarks: string | null
        }
        Insert: {
          batch_inventory_id: string
          batch_number: string
          hospital_name?: string | null
          id?: string
          medicine_id: string
          movement_date?: string | null
          movement_type: string
          performed_by?: string | null
          quantity_after: number
          quantity_before: number
          quantity_changed: number
          reason?: string | null
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          remarks?: string | null
        }
        Update: {
          batch_inventory_id?: string
          batch_number?: string
          hospital_name?: string | null
          id?: string
          medicine_id?: string
          movement_date?: string | null
          movement_type?: string
          performed_by?: string | null
          quantity_after?: number
          quantity_before?: number
          quantity_changed?: number
          reason?: string | null
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_stock_movements_batch_inventory_id_fkey"
            columns: ["batch_inventory_id"]
            isOneToOne: false
            referencedRelation: "medicine_batch_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_stock_movements_batch_inventory_id_fkey"
            columns: ["batch_inventory_id"]
            isOneToOne: false
            referencedRelation: "v_batch_stock_details"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_line_items: {
        Row: {
          amount: number | null
          base_amount: number | null
          bill_id: string
          bill_section_id: string | null
          cghs_nabh_code: string | null
          cghs_nabh_rate: number | null
          created_at: string
          dates_info: string | null
          id: string
          item_description: string
          item_order: number
          item_type: string | null
          primary_adjustment: string | null
          qty: number | null
          secondary_adjustment: string | null
          sr_no: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          base_amount?: number | null
          bill_id: string
          bill_section_id?: string | null
          cghs_nabh_code?: string | null
          cghs_nabh_rate?: number | null
          created_at?: string
          dates_info?: string | null
          id?: string
          item_description: string
          item_order?: number
          item_type?: string | null
          primary_adjustment?: string | null
          qty?: number | null
          secondary_adjustment?: string | null
          sr_no: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          base_amount?: number | null
          bill_id?: string
          bill_section_id?: string | null
          cghs_nabh_code?: string | null
          cghs_nabh_rate?: number | null
          created_at?: string
          dates_info?: string | null
          id?: string
          item_description?: string
          item_order?: number
          item_type?: string | null
          primary_adjustment?: string | null
          qty?: number | null
          secondary_adjustment?: string | null
          sr_no?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_line_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_line_items_bill_section_id_fkey"
            columns: ["bill_section_id"]
            isOneToOne: false
            referencedRelation: "bill_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_preparation: {
        Row: {
          bill_amount: number | null
          bill_link_spreadsheet: string | null
          billing_executive: string | null
          corporate: string | null
          created_at: string | null
          created_by: string | null
          date_of_bill_preparation: string | null
          date_of_submission: string | null
          deduction_amount: number | null
          executive_who_submitted: string | null
          expected_amount: number | null
          expected_payment_date: string | null
          id: string
          intimation_date: string | null
          nmi: string | null
          nmi_answered: string | null
          nmi_date: string | null
          reason_for_deduction: string | null
          reason_for_delay: string | null
          received_amount: number | null
          received_date: string | null
          referral_letter: string | null
          start_date: string | null
          tds_amount: number | null
          updated_at: string | null
          updated_by: string | null
          visit_id: string
        }
        Insert: {
          bill_amount?: number | null
          bill_link_spreadsheet?: string | null
          billing_executive?: string | null
          corporate?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_bill_preparation?: string | null
          date_of_submission?: string | null
          deduction_amount?: number | null
          executive_who_submitted?: string | null
          expected_amount?: number | null
          expected_payment_date?: string | null
          id?: string
          intimation_date?: string | null
          nmi?: string | null
          nmi_answered?: string | null
          nmi_date?: string | null
          reason_for_deduction?: string | null
          reason_for_delay?: string | null
          received_amount?: number | null
          received_date?: string | null
          referral_letter?: string | null
          start_date?: string | null
          tds_amount?: number | null
          updated_at?: string | null
          updated_by?: string | null
          visit_id: string
        }
        Update: {
          bill_amount?: number | null
          bill_link_spreadsheet?: string | null
          billing_executive?: string | null
          corporate?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_bill_preparation?: string | null
          date_of_submission?: string | null
          deduction_amount?: number | null
          executive_who_submitted?: string | null
          expected_amount?: number | null
          expected_payment_date?: string | null
          id?: string
          intimation_date?: string | null
          nmi?: string | null
          nmi_answered?: string | null
          nmi_date?: string | null
          reason_for_deduction?: string | null
          reason_for_delay?: string | null
          received_amount?: number | null
          received_date?: string | null
          referral_letter?: string | null
          start_date?: string | null
          tds_amount?: number | null
          updated_at?: string | null
          updated_by?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_preparation_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["visit_id"]
          },
        ]
      }
      bill_sections: {
        Row: {
          bill_id: string
          conservative_additional_end: string | null
          conservative_additional_start: string | null
          created_at: string
          date_from: string | null
          date_to: string | null
          id: string
          notes: string | null
          section_order: number
          section_title: string
          updated_at: string
        }
        Insert: {
          bill_id: string
          conservative_additional_end?: string | null
          conservative_additional_start?: string | null
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          id?: string
          notes?: string | null
          section_order?: number
          section_title: string
          updated_at?: string
        }
        Update: {
          bill_id?: string
          conservative_additional_end?: string | null
          conservative_additional_start?: string | null
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          id?: string
          notes?: string | null
          section_order?: number
          section_title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_sections_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bill_items_json: Json | null
          bill_no: string
          bill_number: number | null
          bill_patient_data: Json | null
          category: string
          claim_id: string
          created_at: string
          created_by: string | null
          date: string
          finalized_at: string | null
          finalized_by: string | null
          formatted_bill_no: string | null
          hospital_name: string | null
          id: string
          patient_id: string
          rejection_reason: string | null
          status: string | null
          total_amount: number | null
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bill_items_json?: Json | null
          bill_no: string
          bill_number?: number | null
          bill_patient_data?: Json | null
          category?: string
          claim_id: string
          created_at?: string
          created_by?: string | null
          date?: string
          finalized_at?: string | null
          finalized_by?: string | null
          formatted_bill_no?: string | null
          hospital_name?: string | null
          id?: string
          patient_id: string
          rejection_reason?: string | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bill_items_json?: Json | null
          bill_no?: string
          bill_number?: number | null
          bill_patient_data?: Json | null
          category?: string
          claim_id?: string
          created_at?: string
          created_by?: string | null
          date?: string
          finalized_at?: string | null
          finalized_by?: string | null
          formatted_bill_no?: string | null
          hospital_name?: string | null
          id?: string
          patient_id?: string
          rejection_reason?: string | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bills_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      brain_access_roles: {
        Row: {
          allowed_projects: string[]
          blocked_tags: string[]
          role: string
        }
        Insert: {
          allowed_projects?: string[]
          blocked_tags?: string[]
          role: string
        }
        Update: {
          allowed_projects?: string[]
          blocked_tags?: string[]
          role?: string
        }
        Relationships: []
      }
      brain_action_items: {
        Row: {
          assignee: string | null
          assignee_user_id: string | null
          completed_at: string | null
          created_at: string
          due_date: string | null
          id: string
          item_text: string
          meeting_date: string | null
          notes: string | null
          priority: string | null
          project_tag: string | null
          resolved_at: string | null
          source_ref: string | null
          source_type: string
          status: string
        }
        Insert: {
          assignee?: string | null
          assignee_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          item_text: string
          meeting_date?: string | null
          notes?: string | null
          priority?: string | null
          project_tag?: string | null
          resolved_at?: string | null
          source_ref?: string | null
          source_type: string
          status?: string
        }
        Update: {
          assignee?: string | null
          assignee_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          item_text?: string
          meeting_date?: string | null
          notes?: string | null
          priority?: string | null
          project_tag?: string | null
          resolved_at?: string | null
          source_ref?: string | null
          source_type?: string
          status?: string
        }
        Relationships: []
      }
      brain_chunks: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: string
          metadata: Json
          off_limits: boolean
          project_tag: string
          source_ref: string | null
          source_type: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          off_limits?: boolean
          project_tag?: string
          source_ref?: string | null
          source_type: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          off_limits?: boolean
          project_tag?: string
          source_ref?: string | null
          source_type?: string
        }
        Relationships: []
      }
      brain_insights: {
        Row: {
          acknowledged_at: string | null
          description: string
          detected_at: string
          evidence: Json | null
          id: string
          insight_type: string
          projects: string[] | null
          recommended_action: string | null
          severity: string | null
          status: string | null
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          description: string
          detected_at?: string
          evidence?: Json | null
          id?: string
          insight_type: string
          projects?: string[] | null
          recommended_action?: string | null
          severity?: string | null
          status?: string | null
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          description?: string
          detected_at?: string
          evidence?: Json | null
          id?: string
          insight_type?: string
          projects?: string[] | null
          recommended_action?: string | null
          severity?: string | null
          status?: string | null
          title?: string
        }
        Relationships: []
      }
      brain_proposals: {
        Row: {
          agreed_date: string | null
          amount: number | null
          client_name: string | null
          created_at: string
          currency: string | null
          description: string
          due_date: string | null
          id: string
          notes: string | null
          project_tag: string
          quoted_date: string | null
          source_ref: string | null
          source_type: string
          status: string
          supersedes: string | null
          unit: string | null
          updated_at: string
          vendor_name: string | null
        }
        Insert: {
          agreed_date?: string | null
          amount?: number | null
          client_name?: string | null
          created_at?: string
          currency?: string | null
          description: string
          due_date?: string | null
          id?: string
          notes?: string | null
          project_tag: string
          quoted_date?: string | null
          source_ref?: string | null
          source_type: string
          status?: string
          supersedes?: string | null
          unit?: string | null
          updated_at?: string
          vendor_name?: string | null
        }
        Update: {
          agreed_date?: string | null
          amount?: number | null
          client_name?: string | null
          created_at?: string
          currency?: string | null
          description?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          project_tag?: string
          quoted_date?: string | null
          source_ref?: string | null
          source_type?: string
          status?: string
          supersedes?: string | null
          unit?: string | null
          updated_at?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brain_proposals_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "brain_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_sync_state: {
        Row: {
          last_synced: string
          source: string
        }
        Insert: {
          last_synced?: string
          source: string
        }
        Update: {
          last_synced?: string
          source?: string
        }
        Relationships: []
      }
      brain_user_roles: {
        Row: {
          added_at: string
          display_name: string | null
          role: string
          slack_user_id: string
        }
        Insert: {
          added_at?: string
          display_name?: string | null
          role: string
          slack_user_id: string
        }
        Update: {
          added_at?: string
          display_name?: string | null
          role?: string
          slack_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_user_roles_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "brain_access_roles"
            referencedColumns: ["role"]
          },
        ]
      }
      brain_user_state: {
        Row: {
          last_items_dm: string[] | null
          slack_user_id: string
          updated_at: string
        }
        Insert: {
          last_items_dm?: string[] | null
          slack_user_id: string
          updated_at?: string
        }
        Update: {
          last_items_dm?: string[] | null
          slack_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          action_taken: string | null
          call_sid: string | null
          call_status: string | null
          call_type: string | null
          caller_number: string | null
          created_at: string | null
          duration_sec: number | null
          duration_seconds: number | null
          handled_by: string | null
          id: string
          initiated_at: string | null
          notes: string | null
          patient_id: string | null
          patient_name: string | null
          person_id: string | null
          person_name: string | null
          phone_number: string | null
        }
        Insert: {
          action_taken?: string | null
          call_sid?: string | null
          call_status?: string | null
          call_type?: string | null
          caller_number?: string | null
          created_at?: string | null
          duration_sec?: number | null
          duration_seconds?: number | null
          handled_by?: string | null
          id?: string
          initiated_at?: string | null
          notes?: string | null
          patient_id?: string | null
          patient_name?: string | null
          person_id?: string | null
          person_name?: string | null
          phone_number?: string | null
        }
        Update: {
          action_taken?: string | null
          call_sid?: string | null
          call_status?: string | null
          call_type?: string | null
          caller_number?: string | null
          created_at?: string | null
          duration_sec?: number | null
          duration_seconds?: number | null
          handled_by?: string | null
          id?: string
          initiated_at?: string | null
          notes?: string | null
          patient_id?: string | null
          patient_name?: string | null
          person_id?: string | null
          person_name?: string | null
          phone_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "call_logs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "master_data"
            referencedColumns: ["id"]
          },
        ]
      }
      canteen_meals: {
        Row: {
          bed_number: string | null
          created_at: string | null
          id: string
          items: string | null
          meal_date: string
          meal_type: string
          notes: string | null
          patient_name: string | null
          quantity: number | null
          recipient_type: string
          relation: string | null
          relative_name: string | null
          served_by: string | null
          served_by_id: string | null
          special_diet: string | null
          total_amount: number | null
          ward_name: string | null
        }
        Insert: {
          bed_number?: string | null
          created_at?: string | null
          id?: string
          items?: string | null
          meal_date: string
          meal_type: string
          notes?: string | null
          patient_name?: string | null
          quantity?: number | null
          recipient_type: string
          relation?: string | null
          relative_name?: string | null
          served_by?: string | null
          served_by_id?: string | null
          special_diet?: string | null
          total_amount?: number | null
          ward_name?: string | null
        }
        Update: {
          bed_number?: string | null
          created_at?: string | null
          id?: string
          items?: string | null
          meal_date?: string
          meal_type?: string
          notes?: string | null
          patient_name?: string | null
          quantity?: number | null
          recipient_type?: string
          relation?: string | null
          relative_name?: string | null
          served_by?: string | null
          served_by_id?: string | null
          special_diet?: string | null
          total_amount?: number | null
          ward_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "canteen_meals_served_by_id_fkey"
            columns: ["served_by_id"]
            isOneToOne: false
            referencedRelation: "canteen_users"
            referencedColumns: ["id"]
          },
        ]
      }
      canteen_users: {
        Row: {
          created_at: string | null
          employee_id: string
          id: string
          is_active: boolean | null
          name: string
          password: string
          phone: string | null
          role: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          id?: string
          is_active?: boolean | null
          name: string
          password: string
          phone?: string | null
          role?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          password?: string
          phone?: string | null
          role?: string | null
        }
        Relationships: []
      }
      cashbook_handwritten_uploads: {
        Row: {
          created_at: string
          director_reviewed: boolean
          director_reviewed_at: string | null
          director_reviewed_by: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          hospital_type: string
          id: string
          ocr_confidence: number | null
          ocr_status: string
          ocr_text: string | null
          storage_bucket: string
          storage_path: string
          updated_at: string
          uploaded_by_email: string | null
          uploaded_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          director_reviewed?: boolean
          director_reviewed_at?: string | null
          director_reviewed_by?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          hospital_type: string
          id?: string
          ocr_confidence?: number | null
          ocr_status?: string
          ocr_text?: string | null
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          uploaded_by_email?: string | null
          uploaded_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          director_reviewed?: boolean
          director_reviewed_at?: string | null
          director_reviewed_by?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          hospital_type?: string
          id?: string
          ocr_confidence?: number | null
          ocr_status?: string
          ocr_text?: string | null
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          uploaded_by_email?: string | null
          uploaded_by_user_id?: string | null
        }
        Relationships: []
      }
      casualty_vitals: {
        Row: {
          bp: string | null
          created_at: string | null
          id: string
          pulse: number | null
          recorded_at: string | null
          visit_id: string
        }
        Insert: {
          bp?: string | null
          created_at?: string | null
          id?: string
          pulse?: number | null
          recorded_at?: string | null
          visit_id: string
        }
        Update: {
          bp?: string | null
          created_at?: string | null
          id?: string
          pulse?: number | null
          recorded_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "casualty_vitals_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      cath_lab_inventory: {
        Row: {
          batch_number: string | null
          brand: string | null
          created_at: string | null
          expiry_date: string | null
          id: string
          item_type: string
          model: string | null
          quantity: number | null
          size: string | null
          supplier: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          batch_number?: string | null
          brand?: string | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          item_type: string
          model?: string | null
          quantity?: number | null
          size?: string | null
          supplier?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          batch_number?: string | null
          brand?: string | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          item_type?: string
          model?: string | null
          quantity?: number | null
          size?: string | null
          supplier?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      cath_lab_schedule: {
        Row: {
          access_site: string | null
          actual_end_time: string | null
          actual_start_time: string | null
          cardiologist_id: string | null
          cardiologist_name: string | null
          complications: string | null
          contrast_volume_ml: number | null
          created_at: string | null
          estimated_duration_min: number | null
          findings: Json | null
          fluoroscopy_time_min: number | null
          hemodynamics: Json | null
          id: string
          notes: string | null
          patient_id: string | null
          pre_procedure_checklist: Json | null
          procedure_subtype: string | null
          procedure_type: string
          radiation_dose_mgy: number | null
          scheduled_date: string
          scheduled_time: string
          status: string | null
          stents_used: Json | null
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          access_site?: string | null
          actual_end_time?: string | null
          actual_start_time?: string | null
          cardiologist_id?: string | null
          cardiologist_name?: string | null
          complications?: string | null
          contrast_volume_ml?: number | null
          created_at?: string | null
          estimated_duration_min?: number | null
          findings?: Json | null
          fluoroscopy_time_min?: number | null
          hemodynamics?: Json | null
          id?: string
          notes?: string | null
          patient_id?: string | null
          pre_procedure_checklist?: Json | null
          procedure_subtype?: string | null
          procedure_type: string
          radiation_dose_mgy?: number | null
          scheduled_date: string
          scheduled_time: string
          status?: string | null
          stents_used?: Json | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          access_site?: string | null
          actual_end_time?: string | null
          actual_start_time?: string | null
          cardiologist_id?: string | null
          cardiologist_name?: string | null
          complications?: string | null
          contrast_volume_ml?: number | null
          created_at?: string | null
          estimated_duration_min?: number | null
          findings?: Json | null
          fluoroscopy_time_min?: number | null
          hemodynamics?: Json | null
          id?: string
          notes?: string | null
          patient_id?: string | null
          pre_procedure_checklist?: Json | null
          procedure_subtype?: string | null
          procedure_type?: string
          radiation_dose_mgy?: number | null
          scheduled_date?: string
          scheduled_time?: string
          status?: string | null
          stents_used?: Json | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cath_lab_schedule_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cath_lab_schedule_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "cath_lab_schedule_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      cghs_surgery: {
        Row: {
          bhopal_nabh_rate: string | null
          bhopal_non_nabh_rate: string | null
          category: string | null
          code: string | null
          cost: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          NABH_NABL_Rate: string | null
          name: string
          Non_NABH_NABL_Rate: string | null
          private: number | null
          Procedure_Name: string | null
          Revised_Date: string | null
          updated_at: string | null
        }
        Insert: {
          bhopal_nabh_rate?: string | null
          bhopal_non_nabh_rate?: string | null
          category?: string | null
          code?: string | null
          cost?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          NABH_NABL_Rate?: string | null
          name: string
          Non_NABH_NABL_Rate?: string | null
          private?: number | null
          Procedure_Name?: string | null
          Revised_Date?: string | null
          updated_at?: string | null
        }
        Update: {
          bhopal_nabh_rate?: string | null
          bhopal_non_nabh_rate?: string | null
          category?: string | null
          code?: string | null
          cost?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          NABH_NABL_Rate?: string | null
          name?: string
          Non_NABH_NABL_Rate?: string | null
          private?: number | null
          Procedure_Name?: string | null
          Revised_Date?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      chart_of_accounts: {
        Row: {
          account_code: string
          account_group: string | null
          account_name: string
          account_type: string
          company_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          opening_balance: number | null
          opening_balance_type: string | null
          parent_account_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_code: string
          account_group?: string | null
          account_name: string
          account_type: string
          company_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          opening_balance?: number | null
          opening_balance_type?: string | null
          parent_account_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_code?: string
          account_group?: string | null
          account_name?: string
          account_type?: string
          company_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          opening_balance?: number | null
          opening_balance_type?: string | null
          parent_account_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      client_accounts: {
        Row: {
          brand: string
          company_name: string | null
          created_at: string | null
          currency: string
          discovery_invoice_id: string | null
          email: string
          id: string
          industry: string | null
          setup_fee_cents: number
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          team_size: number | null
          unlocked_at: string | null
          user_id: string | null
        }
        Insert: {
          brand?: string
          company_name?: string | null
          created_at?: string | null
          currency?: string
          discovery_invoice_id?: string | null
          email: string
          id?: string
          industry?: string | null
          setup_fee_cents: number
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          team_size?: number | null
          unlocked_at?: string | null
          user_id?: string | null
        }
        Update: {
          brand?: string
          company_name?: string | null
          created_at?: string | null
          currency?: string
          discovery_invoice_id?: string | null
          email?: string
          id?: string
          industry?: string | null
          setup_fee_cents?: number
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          team_size?: number | null
          unlocked_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      clinical_services: {
        Row: {
          code: number | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          nabh_bhopal: number | null
          nabh_rate: number | null
          non_nabh_bhopal: number | null
          non_nabh_rate: number | null
          private_rate: number | null
          service_name: string
          status: string | null
          tpa_rate: number | null
          updated_at: string | null
        }
        Insert: {
          code?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          nabh_bhopal?: number | null
          nabh_rate?: number | null
          non_nabh_bhopal?: number | null
          non_nabh_rate?: number | null
          private_rate?: number | null
          service_name: string
          status?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          nabh_bhopal?: number | null
          nabh_rate?: number | null
          non_nabh_bhopal?: number | null
          non_nabh_rate?: number | null
          private_rate?: number | null
          service_name?: string
          status?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      collection_staff_login: {
        Row: {
          created_at: string | null
          email: string | null
          employee_id: string | null
          full_name: string
          id: number
          is_active: boolean | null
          last_login: string | null
          password: string
          phone: string | null
          role: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          employee_id?: string | null
          full_name: string
          id?: number
          is_active?: boolean | null
          last_login?: string | null
          password: string
          phone?: string | null
          role?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string
          id?: number
          is_active?: boolean | null
          last_login?: string | null
          password?: string
          phone?: string | null
          role?: string | null
          username?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          address: string | null
          company_key: string
          company_name: string
          company_type: string
          created_at: string | null
          gst_number: string | null
          id: string
          is_active: boolean | null
          owner_partners: string | null
          pan_number: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          company_key: string
          company_name: string
          company_type: string
          created_at?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean | null
          owner_partners?: string | null
          pan_number?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          company_key?: string
          company_name?: string
          company_type?: string
          created_at?: string | null
          gst_number?: string | null
          id?: string
          is_active?: boolean | null
          owner_partners?: string | null
          pan_number?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      complications: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      conference_call_logs: {
        Row: {
          called_at: string | null
          created_at: string | null
          delay_minutes: number | null
          id: string
          initiated_by: string | null
          notes: string | null
          our_doctor_name: string | null
          our_doctor_phone: string | null
          referring_doctor_name: string | null
          referring_doctor_phone: string | null
          status: string | null
          twilio_call_sid: string | null
          whatsapp_notified: boolean | null
        }
        Insert: {
          called_at?: string | null
          created_at?: string | null
          delay_minutes?: number | null
          id?: string
          initiated_by?: string | null
          notes?: string | null
          our_doctor_name?: string | null
          our_doctor_phone?: string | null
          referring_doctor_name?: string | null
          referring_doctor_phone?: string | null
          status?: string | null
          twilio_call_sid?: string | null
          whatsapp_notified?: boolean | null
        }
        Update: {
          called_at?: string | null
          created_at?: string | null
          delay_minutes?: number | null
          id?: string
          initiated_by?: string | null
          notes?: string | null
          our_doctor_name?: string | null
          our_doctor_phone?: string | null
          referring_doctor_name?: string | null
          referring_doctor_phone?: string | null
          status?: string | null
          twilio_call_sid?: string | null
          whatsapp_notified?: boolean | null
        }
        Relationships: []
      }
      corporate: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      corporate_area_contacts: {
        Row: {
          anniversary: string | null
          area_id: string | null
          birthday: string | null
          created_at: string | null
          created_by: string | null
          designation: string | null
          dietary_preference: string | null
          drinks_alcohol: string | null
          email: string | null
          family_details: string | null
          gratification_details: string | null
          gratification_type: string | null
          id: string
          interests: string | null
          is_primary: boolean | null
          name: string
          notes: string | null
          personal_habits: string | null
          phone: string | null
          photo_url: string | null
          photos: Json | null
        }
        Insert: {
          anniversary?: string | null
          area_id?: string | null
          birthday?: string | null
          created_at?: string | null
          created_by?: string | null
          designation?: string | null
          dietary_preference?: string | null
          drinks_alcohol?: string | null
          email?: string | null
          family_details?: string | null
          gratification_details?: string | null
          gratification_type?: string | null
          id?: string
          interests?: string | null
          is_primary?: boolean | null
          name: string
          notes?: string | null
          personal_habits?: string | null
          phone?: string | null
          photo_url?: string | null
          photos?: Json | null
        }
        Update: {
          anniversary?: string | null
          area_id?: string | null
          birthday?: string | null
          created_at?: string | null
          created_by?: string | null
          designation?: string | null
          dietary_preference?: string | null
          drinks_alcohol?: string | null
          email?: string | null
          family_details?: string | null
          gratification_details?: string | null
          gratification_type?: string | null
          id?: string
          interests?: string | null
          is_primary?: boolean | null
          name?: string
          notes?: string | null
          personal_habits?: string | null
          phone?: string | null
          photo_url?: string | null
          photos?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_area_contacts_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "corporate_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_area_meetings: {
        Row: {
          action_requested: string | null
          action_taken: string | null
          area_id: string | null
          conversation: string | null
          created_at: string | null
          created_by: string | null
          follow_up_date: string | null
          follow_up_needed: boolean | null
          id: string
          location: string | null
          marketing_staff: string | null
          meeting_date: string
          person_met: string | null
          photos: Json | null
        }
        Insert: {
          action_requested?: string | null
          action_taken?: string | null
          area_id?: string | null
          conversation?: string | null
          created_at?: string | null
          created_by?: string | null
          follow_up_date?: string | null
          follow_up_needed?: boolean | null
          id?: string
          location?: string | null
          marketing_staff?: string | null
          meeting_date: string
          person_met?: string | null
          photos?: Json | null
        }
        Update: {
          action_requested?: string | null
          action_taken?: string | null
          area_id?: string | null
          conversation?: string | null
          created_at?: string | null
          created_by?: string | null
          follow_up_date?: string | null
          follow_up_needed?: boolean | null
          id?: string
          location?: string | null
          marketing_staff?: string | null
          meeting_date?: string
          person_met?: string | null
          photos?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_area_meetings_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "corporate_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_areas: {
        Row: {
          added_to_openclaw: boolean | null
          ambulance_available: boolean | null
          area_name: string
          banner_photo: string | null
          bed_count: number | null
          corporate_id: string | null
          created_at: string | null
          csr_programs: string | null
          dependent_count: number | null
          dispensaries: string | null
          distance_km: number | null
          district: string | null
          emergency_services: boolean | null
          empanelled_hospitals: string | null
          employee_count: number | null
          followup_frequency: string | null
          gallery: Json | null
          google_maps_link: string | null
          hospital_count: number | null
          hospitals: string | null
          id: string
          key_mines: string | null
          last_visit_date: string | null
          liaising_person: string | null
          liaising_since: string | null
          next_followup_date: string | null
          notes: string | null
          pharmacy_info: string | null
          profile_photo: string | null
          renewal_date: string | null
          specialties_available: string | null
          state: string | null
          status: string | null
          tertiary_referrals: string | null
          total_amount_pending: number | null
          total_claims_approved: number | null
          total_claims_submitted: number | null
          travel_time: string | null
          updated_at: string | null
          visit_route: string | null
        }
        Insert: {
          added_to_openclaw?: boolean | null
          ambulance_available?: boolean | null
          area_name: string
          banner_photo?: string | null
          bed_count?: number | null
          corporate_id?: string | null
          created_at?: string | null
          csr_programs?: string | null
          dependent_count?: number | null
          dispensaries?: string | null
          distance_km?: number | null
          district?: string | null
          emergency_services?: boolean | null
          empanelled_hospitals?: string | null
          employee_count?: number | null
          followup_frequency?: string | null
          gallery?: Json | null
          google_maps_link?: string | null
          hospital_count?: number | null
          hospitals?: string | null
          id?: string
          key_mines?: string | null
          last_visit_date?: string | null
          liaising_person?: string | null
          liaising_since?: string | null
          next_followup_date?: string | null
          notes?: string | null
          pharmacy_info?: string | null
          profile_photo?: string | null
          renewal_date?: string | null
          specialties_available?: string | null
          state?: string | null
          status?: string | null
          tertiary_referrals?: string | null
          total_amount_pending?: number | null
          total_claims_approved?: number | null
          total_claims_submitted?: number | null
          travel_time?: string | null
          updated_at?: string | null
          visit_route?: string | null
        }
        Update: {
          added_to_openclaw?: boolean | null
          ambulance_available?: boolean | null
          area_name?: string
          banner_photo?: string | null
          bed_count?: number | null
          corporate_id?: string | null
          created_at?: string | null
          csr_programs?: string | null
          dependent_count?: number | null
          dispensaries?: string | null
          distance_km?: number | null
          district?: string | null
          emergency_services?: boolean | null
          empanelled_hospitals?: string | null
          employee_count?: number | null
          followup_frequency?: string | null
          gallery?: Json | null
          google_maps_link?: string | null
          hospital_count?: number | null
          hospitals?: string | null
          id?: string
          key_mines?: string | null
          last_visit_date?: string | null
          liaising_person?: string | null
          liaising_since?: string | null
          next_followup_date?: string | null
          notes?: string | null
          pharmacy_info?: string | null
          profile_photo?: string | null
          renewal_date?: string | null
          specialties_available?: string | null
          state?: string | null
          status?: string | null
          tertiary_referrals?: string | null
          total_amount_pending?: number | null
          total_claims_approved?: number | null
          total_claims_submitted?: number | null
          travel_time?: string | null
          updated_at?: string | null
          visit_route?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_areas_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_master"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_bulk_payment_allocations: {
        Row: {
          amount: number
          bill_amount: number | null
          bulk_payment_id: string
          created_at: string | null
          deduction_amount: number | null
          id: string
          patient_id: string | null
          patient_name: string
          remarks: string | null
          tds_amount: number | null
          visit_id: string | null
        }
        Insert: {
          amount: number
          bill_amount?: number | null
          bulk_payment_id: string
          created_at?: string | null
          deduction_amount?: number | null
          id?: string
          patient_id?: string | null
          patient_name: string
          remarks?: string | null
          tds_amount?: number | null
          visit_id?: string | null
        }
        Update: {
          amount?: number
          bill_amount?: number | null
          bulk_payment_id?: string
          created_at?: string | null
          deduction_amount?: number | null
          id?: string
          patient_id?: string | null
          patient_name?: string
          remarks?: string | null
          tds_amount?: number | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_bulk_payment_allocations_bulk_payment_id_fkey"
            columns: ["bulk_payment_id"]
            isOneToOne: false
            referencedRelation: "corporate_bulk_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cbpa_patient_id"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cbpa_patient_id"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      corporate_bulk_payments: {
        Row: {
          bank_name: string | null
          claim_amount: number | null
          corporate_id: string | null
          corporate_name: string
          created_at: string | null
          created_by: string | null
          hospital_name: string | null
          id: string
          narration: string | null
          payment_date: string
          payment_mode: string
          receipt_number: string | null
          reference_number: string | null
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          bank_name?: string | null
          claim_amount?: number | null
          corporate_id?: string | null
          corporate_name: string
          created_at?: string | null
          created_by?: string | null
          hospital_name?: string | null
          id?: string
          narration?: string | null
          payment_date: string
          payment_mode: string
          receipt_number?: string | null
          reference_number?: string | null
          total_amount: number
          updated_at?: string | null
        }
        Update: {
          bank_name?: string | null
          claim_amount?: number | null
          corporate_id?: string | null
          corporate_name?: string
          created_at?: string | null
          created_by?: string | null
          hospital_name?: string | null
          id?: string
          narration?: string | null
          payment_date?: string
          payment_mode?: string
          receipt_number?: string | null
          reference_number?: string | null
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_bulk_payments_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_bulk_payments_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["corporate_id"]
          },
        ]
      }
      corporate_collection_management: {
        Row: {
          action_required: string | null
          collection_officer: string
          contract_type: string | null
          corporate_company: string | null
          corporate_response: string | null
          created_at: string | null
          disposition: string | null
          disposition_date: string
          disposition_notes: string | null
          id: number
          management_escalation: string | null
          next_steps: string | null
          promised_clearance_date: string | null
          reason_for_delay: string | null
          remarks: string | null
          report_date: string
          sub_disposition: string | null
          updated_at: string | null
        }
        Insert: {
          action_required?: string | null
          collection_officer: string
          contract_type?: string | null
          corporate_company?: string | null
          corporate_response?: string | null
          created_at?: string | null
          disposition?: string | null
          disposition_date: string
          disposition_notes?: string | null
          id?: number
          management_escalation?: string | null
          next_steps?: string | null
          promised_clearance_date?: string | null
          reason_for_delay?: string | null
          remarks?: string | null
          report_date: string
          sub_disposition?: string | null
          updated_at?: string | null
        }
        Update: {
          action_required?: string | null
          collection_officer?: string
          contract_type?: string | null
          corporate_company?: string | null
          corporate_response?: string | null
          created_at?: string | null
          disposition?: string | null
          disposition_date?: string
          disposition_notes?: string | null
          id?: number
          management_escalation?: string | null
          next_steps?: string | null
          promised_clearance_date?: string | null
          reason_for_delay?: string | null
          remarks?: string | null
          report_date?: string
          sub_disposition?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      corporate_collection_staff: {
        Row: {
          created_at: string | null
          department: string | null
          email: string | null
          employee_id: string | null
          full_name: string
          is_active: boolean | null
          last_login: string | null
          password_hash: string
          phone: string | null
          reporting_manager_id: number | null
          role: string | null
          staff_id: number
          updated_at: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          email?: string | null
          employee_id?: string | null
          full_name: string
          is_active?: boolean | null
          last_login?: string | null
          password_hash: string
          phone?: string | null
          reporting_manager_id?: number | null
          role?: string | null
          staff_id?: number
          updated_at?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          department?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string
          is_active?: boolean | null
          last_login?: string | null
          password_hash?: string
          phone?: string | null
          reporting_manager_id?: number | null
          role?: string | null
          staff_id?: number
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      corporate_companies: {
        Row: {
          billing_address: string | null
          city: string | null
          company_code: string
          company_id: number
          company_name: string
          contact_email: string | null
          contact_person: string | null
          contact_phone: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string | null
          credit_days: number | null
          credit_limit: number | null
          gst_number: string | null
          is_active: boolean | null
          pan_number: string | null
          payment_terms: string | null
          pincode: string | null
          state: string | null
          updated_at: string | null
        }
        Insert: {
          billing_address?: string | null
          city?: string | null
          company_code: string
          company_id?: number
          company_name: string
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          credit_days?: number | null
          credit_limit?: number | null
          gst_number?: string | null
          is_active?: boolean | null
          pan_number?: string | null
          payment_terms?: string | null
          pincode?: string | null
          state?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_address?: string | null
          city?: string | null
          company_code?: string
          company_id?: number
          company_name?: string
          contact_email?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          credit_days?: number | null
          credit_limit?: number | null
          gst_number?: string | null
          is_active?: boolean | null
          pan_number?: string | null
          payment_terms?: string | null
          pincode?: string | null
          state?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      corporate_master: {
        Row: {
          added_to_openclaw: boolean | null
          areas: string | null
          category: string
          contact_persons: Json | null
          created_at: string | null
          csr_programs: string | null
          empanelment_date: string | null
          employee_strength: number | null
          followup_frequency: string | null
          headquarters: string | null
          hospital: string | null
          hospital_locations: string | null
          id: string
          liaising_person: string | null
          liaising_since: string | null
          meeting_history: Json | null
          name: string
          next_followup_date: string | null
          notes: string | null
          openclaw_reminder_active: boolean | null
          renewal_date: string | null
          short_name: string | null
          status: string | null
          tertiary_referrals: string | null
          total_amount_pending: number | null
          total_claims_approved: number | null
          total_claims_submitted: number | null
          total_dispensaries: number | null
          total_hospitals: number | null
          updated_at: string | null
          visit_route: string | null
          website: string | null
        }
        Insert: {
          added_to_openclaw?: boolean | null
          areas?: string | null
          category?: string
          contact_persons?: Json | null
          created_at?: string | null
          csr_programs?: string | null
          empanelment_date?: string | null
          employee_strength?: number | null
          followup_frequency?: string | null
          headquarters?: string | null
          hospital?: string | null
          hospital_locations?: string | null
          id?: string
          liaising_person?: string | null
          liaising_since?: string | null
          meeting_history?: Json | null
          name: string
          next_followup_date?: string | null
          notes?: string | null
          openclaw_reminder_active?: boolean | null
          renewal_date?: string | null
          short_name?: string | null
          status?: string | null
          tertiary_referrals?: string | null
          total_amount_pending?: number | null
          total_claims_approved?: number | null
          total_claims_submitted?: number | null
          total_dispensaries?: number | null
          total_hospitals?: number | null
          updated_at?: string | null
          visit_route?: string | null
          website?: string | null
        }
        Update: {
          added_to_openclaw?: boolean | null
          areas?: string | null
          category?: string
          contact_persons?: Json | null
          created_at?: string | null
          csr_programs?: string | null
          empanelment_date?: string | null
          employee_strength?: number | null
          followup_frequency?: string | null
          headquarters?: string | null
          hospital?: string | null
          hospital_locations?: string | null
          id?: string
          liaising_person?: string | null
          liaising_since?: string | null
          meeting_history?: Json | null
          name?: string
          next_followup_date?: string | null
          notes?: string | null
          openclaw_reminder_active?: boolean | null
          renewal_date?: string | null
          short_name?: string | null
          status?: string | null
          tertiary_referrals?: string | null
          total_amount_pending?: number | null
          total_claims_approved?: number | null
          total_claims_submitted?: number | null
          total_dispensaries?: number | null
          total_hospitals?: number | null
          updated_at?: string | null
          visit_route?: string | null
          website?: string | null
        }
        Relationships: []
      }
      corporate_master_contacts: {
        Row: {
          corporate_id: string | null
          created_at: string | null
          designation: string | null
          email: string | null
          id: string
          is_primary: boolean | null
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          corporate_id?: string | null
          created_at?: string | null
          designation?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean | null
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          corporate_id?: string | null
          created_at?: string | null
          designation?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean | null
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_master_contacts_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_master"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_master_meetings: {
        Row: {
          action_requested: string | null
          action_taken: string | null
          conversation: string | null
          corporate_id: string | null
          created_at: string | null
          created_by: string | null
          follow_up_date: string | null
          follow_up_needed: boolean | null
          id: string
          location: string | null
          meeting_date: string
          person_met: string | null
        }
        Insert: {
          action_requested?: string | null
          action_taken?: string | null
          conversation?: string | null
          corporate_id?: string | null
          created_at?: string | null
          created_by?: string | null
          follow_up_date?: string | null
          follow_up_needed?: boolean | null
          id?: string
          location?: string | null
          meeting_date: string
          person_met?: string | null
        }
        Update: {
          action_requested?: string | null
          action_taken?: string | null
          conversation?: string | null
          corporate_id?: string | null
          created_at?: string | null
          created_by?: string | null
          follow_up_date?: string | null
          follow_up_needed?: boolean | null
          id?: string
          location?: string | null
          meeting_date?: string
          person_met?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_master_meetings_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_master"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_allocation_saves: {
        Row: {
          created_at: string
          hospital_name: string
          id: string
          notes: string | null
          save_date: string
          saved_at: string
          saved_by: string | null
          schedule_count: number
          status: string
          surplus: number
          total_available: number
          total_due: number
          total_paid: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          hospital_name?: string
          id?: string
          notes?: string | null
          save_date: string
          saved_at?: string
          saved_by?: string | null
          schedule_count?: number
          status?: string
          surplus?: number
          total_available?: number
          total_due?: number
          total_paid?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          hospital_name?: string
          id?: string
          notes?: string | null
          save_date?: string
          saved_at?: string
          saved_by?: string | null
          schedule_count?: number
          status?: string
          surplus?: number
          total_available?: number
          total_due?: number
          total_paid?: number
          updated_at?: string
        }
        Relationships: []
      }
      daily_allocation_sheets: {
        Row: {
          created_at: string
          data: Json
          hospital_type: string
          id: string
          sheet_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data?: Json
          hospital_type?: string
          id?: string
          sheet_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          hospital_type?: string
          id?: string
          sheet_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_balances: {
        Row: {
          account_id: string | null
          balance_date: string
          balance_type: string | null
          closing_balance: number | null
          created_at: string | null
          credit_total: number | null
          debit_total: number | null
          id: string
          opening_balance: number | null
        }
        Insert: {
          account_id?: string | null
          balance_date: string
          balance_type?: string | null
          closing_balance?: number | null
          created_at?: string | null
          credit_total?: number | null
          debit_total?: number | null
          id?: string
          opening_balance?: number | null
        }
        Update: {
          account_id?: string | null
          balance_date?: string
          balance_type?: string | null
          closing_balance?: number | null
          created_at?: string | null
          credit_total?: number | null
          debit_total?: number | null
          id?: string
          opening_balance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_fund_balances: {
        Row: {
          account_name: string
          account_ref_id: string
          account_type: string | null
          actual_balance: number
          balance_date: string
          created_at: string | null
          hospital_name: string | null
          id: string
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          account_name: string
          account_ref_id: string
          account_type?: string | null
          actual_balance?: number
          balance_date: string
          created_at?: string | null
          hospital_name?: string | null
          id?: string
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string
          account_ref_id?: string
          account_type?: string | null
          actual_balance?: number
          balance_date?: string
          created_at?: string | null
          hospital_name?: string | null
          id?: string
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      daily_payment_schedule: {
        Row: {
          carryforward_amount: number | null
          category: string
          company_id: string | null
          created_at: string | null
          daily_amount: number
          days_overdue: number | null
          hospital_name: string | null
          id: string
          notes: string | null
          obligation_id: string
          paid_amount: number | null
          paid_at: string | null
          paid_by: string | null
          party_name: string
          schedule_date: string
          status: string
          total_due: number | null
          updated_at: string | null
          voucher_id: string | null
        }
        Insert: {
          carryforward_amount?: number | null
          category: string
          company_id?: string | null
          created_at?: string | null
          daily_amount: number
          days_overdue?: number | null
          hospital_name?: string | null
          id?: string
          notes?: string | null
          obligation_id: string
          paid_amount?: number | null
          paid_at?: string | null
          paid_by?: string | null
          party_name: string
          schedule_date: string
          status?: string
          total_due?: number | null
          updated_at?: string | null
          voucher_id?: string | null
        }
        Update: {
          carryforward_amount?: number | null
          category?: string
          company_id?: string | null
          created_at?: string | null
          daily_amount?: number
          days_overdue?: number | null
          hospital_name?: string | null
          id?: string
          notes?: string | null
          obligation_id?: string
          paid_amount?: number | null
          paid_at?: string | null
          paid_by?: string | null
          party_name?: string
          schedule_date?: string
          status?: string
          total_due?: number | null
          updated_at?: string | null
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_payment_schedule_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_payment_schedule_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "payment_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_payment_schedule_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_revenue_entries: {
        Row: {
          cost: number
          created_at: string
          cut: number
          department: string | null
          entry_date: string
          hospital_type: string
          id: string
          is_hidden: boolean
          notes: string | null
          patient_name: string
          rm_name: string | null
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          cost?: number
          created_at?: string
          cut?: number
          department?: string | null
          entry_date?: string
          hospital_type: string
          id?: string
          is_hidden?: boolean
          notes?: string | null
          patient_name: string
          rm_name?: string | null
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          cost?: number
          created_at?: string
          cut?: number
          department?: string | null
          entry_date?: string
          hospital_type?: string
          id?: string
          is_hidden?: boolean
          notes?: string | null
          patient_name?: string
          rm_name?: string | null
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_revenue_entries_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_revenue_report_approvals: {
        Row: {
          approved_at: string
          approved_by_email: string | null
          created_at: string
          entry_date: string
        }
        Insert: {
          approved_at?: string
          approved_by_email?: string | null
          created_at?: string
          entry_date: string
        }
        Update: {
          approved_at?: string
          approved_by_email?: string | null
          created_at?: string
          entry_date?: string
        }
        Relationships: []
      }
      death_certificates: {
        Row: {
          address: string | null
          age_sex: string | null
          cause_of_death: string | null
          certificate_date: string | null
          consultant: string | null
          created_at: string | null
          expired_on: string | null
          id: string
          patient_id: string | null
          patient_name: string | null
          registration_id: string | null
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          address?: string | null
          age_sex?: string | null
          cause_of_death?: string | null
          certificate_date?: string | null
          consultant?: string | null
          created_at?: string | null
          expired_on?: string | null
          id?: string
          patient_id?: string | null
          patient_name?: string | null
          registration_id?: string | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          address?: string | null
          age_sex?: string | null
          cause_of_death?: string | null
          certificate_date?: string | null
          consultant?: string | null
          created_at?: string | null
          expired_on?: string | null
          id?: string
          patient_id?: string | null
          patient_name?: string | null
          registration_id?: string | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "death_certificates_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "death_certificates_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "death_certificates_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_batch_inventory: {
        Row: {
          batch_number: string
          created_at: string | null
          current_stock: number | null
          expiry_date: string | null
          grn_date: string | null
          grn_number: string | null
          hospital_type: string
          id: string
          is_active: boolean | null
          item_id: string | null
          manufacturing_date: string | null
          mrp: number | null
          purchase_order_id: string | null
          purchase_price: number | null
          rack_number: string | null
          received_quantity: number | null
          selling_price: number | null
          vendor_id: number | null
        }
        Insert: {
          batch_number: string
          created_at?: string | null
          current_stock?: number | null
          expiry_date?: string | null
          grn_date?: string | null
          grn_number?: string | null
          hospital_type: string
          id?: string
          is_active?: boolean | null
          item_id?: string | null
          manufacturing_date?: string | null
          mrp?: number | null
          purchase_order_id?: string | null
          purchase_price?: number | null
          rack_number?: string | null
          received_quantity?: number | null
          selling_price?: number | null
          vendor_id?: number | null
        }
        Update: {
          batch_number?: string
          created_at?: string | null
          current_stock?: number | null
          expiry_date?: string | null
          grn_date?: string | null
          grn_number?: string | null
          hospital_type?: string
          id?: string
          is_active?: boolean | null
          item_id?: string | null
          manufacturing_date?: string | null
          mrp?: number | null
          purchase_order_id?: string | null
          purchase_price?: number | null
          rack_number?: string | null
          received_quantity?: number | null
          selling_price?: number | null
          vendor_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "department_store_batch_inventory_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "department_store_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_batch_inventory_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "department_store_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_batch_inventory_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "department_store_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_consumption: {
        Row: {
          batch_inventory_id: string | null
          consumption_date: string
          consumption_number: string
          created_at: string | null
          created_by: string | null
          hospital_type: string
          id: string
          item_id: string | null
          location_id: number | null
          patient_id: string | null
          quantity_consumed: number
          remarks: string | null
          requisition_id: string | null
        }
        Insert: {
          batch_inventory_id?: string | null
          consumption_date: string
          consumption_number: string
          created_at?: string | null
          created_by?: string | null
          hospital_type: string
          id?: string
          item_id?: string | null
          location_id?: number | null
          patient_id?: string | null
          quantity_consumed: number
          remarks?: string | null
          requisition_id?: string | null
        }
        Update: {
          batch_inventory_id?: string | null
          consumption_date?: string
          consumption_number?: string
          created_at?: string | null
          created_by?: string | null
          hospital_type?: string
          id?: string
          item_id?: string | null
          location_id?: number | null
          patient_id?: string | null
          quantity_consumed?: number
          remarks?: string | null
          requisition_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_store_consumption_batch_inventory_id_fkey"
            columns: ["batch_inventory_id"]
            isOneToOne: false
            referencedRelation: "department_store_batch_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_consumption_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "department_store_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_consumption_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "department_store_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_consumption_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "department_store_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_grn: {
        Row: {
          created_at: string | null
          created_by: string | null
          discount: number | null
          grn_date: string
          grn_number: string
          hospital_type: string
          id: string
          invoice_amount: number | null
          invoice_date: string | null
          invoice_number: string | null
          purchase_order_id: string | null
          remarks: string | null
          status: string | null
          total_amount: number | null
          total_items: number | null
          total_quantity_ordered: number | null
          total_quantity_received: number | null
          vendor_id: number | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          discount?: number | null
          grn_date: string
          grn_number: string
          hospital_type: string
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          purchase_order_id?: string | null
          remarks?: string | null
          status?: string | null
          total_amount?: number | null
          total_items?: number | null
          total_quantity_ordered?: number | null
          total_quantity_received?: number | null
          vendor_id?: number | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          discount?: number | null
          grn_date?: string
          grn_number?: string
          hospital_type?: string
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          purchase_order_id?: string | null
          remarks?: string | null
          status?: string | null
          total_amount?: number | null
          total_items?: number | null
          total_quantity_ordered?: number | null
          total_quantity_received?: number | null
          vendor_id?: number | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_store_grn_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "department_store_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_grn_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "department_store_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_grn_items: {
        Row: {
          amount: number
          batch_number: string
          created_at: string | null
          expiry_date: string | null
          free_quantity: number | null
          grn_id: string | null
          gst_percentage: number | null
          id: string
          item_id: string | null
          manufacturing_date: string | null
          mrp: number | null
          ordered_quantity: number | null
          product_name: string
          purchase_price: number
          rack_number: string | null
          received_quantity: number | null
          rejected_quantity: number | null
          selling_price: number | null
        }
        Insert: {
          amount: number
          batch_number: string
          created_at?: string | null
          expiry_date?: string | null
          free_quantity?: number | null
          grn_id?: string | null
          gst_percentage?: number | null
          id?: string
          item_id?: string | null
          manufacturing_date?: string | null
          mrp?: number | null
          ordered_quantity?: number | null
          product_name: string
          purchase_price: number
          rack_number?: string | null
          received_quantity?: number | null
          rejected_quantity?: number | null
          selling_price?: number | null
        }
        Update: {
          amount?: number
          batch_number?: string
          created_at?: string | null
          expiry_date?: string | null
          free_quantity?: number | null
          grn_id?: string | null
          gst_percentage?: number | null
          id?: string
          item_id?: string | null
          manufacturing_date?: string | null
          mrp?: number | null
          ordered_quantity?: number | null
          product_name?: string
          purchase_price?: number
          rack_number?: string | null
          received_quantity?: number | null
          rejected_quantity?: number | null
          selling_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "department_store_grn_items_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "department_store_grn"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_grn_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "department_store_items"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_items: {
        Row: {
          category: string | null
          created_at: string | null
          generic_name: string | null
          gst_percentage: number | null
          hospital_type: string
          hsn_code: string | null
          id: string
          is_active: boolean | null
          item_code: string
          item_name: string
          manufacturer: string | null
          maximum_stock_level: number | null
          minimum_stock_level: number | null
          mrp: number | null
          pack_size: number | null
          purchase_rate: number | null
          reorder_level: number | null
          selling_rate: number | null
          service_provider: string | null
          sub_category: string | null
          unit_of_measurement: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          generic_name?: string | null
          gst_percentage?: number | null
          hospital_type: string
          hsn_code?: string | null
          id?: string
          is_active?: boolean | null
          item_code: string
          item_name: string
          manufacturer?: string | null
          maximum_stock_level?: number | null
          minimum_stock_level?: number | null
          mrp?: number | null
          pack_size?: number | null
          purchase_rate?: number | null
          reorder_level?: number | null
          selling_rate?: number | null
          service_provider?: string | null
          sub_category?: string | null
          unit_of_measurement?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          generic_name?: string | null
          gst_percentage?: number | null
          hospital_type?: string
          hsn_code?: string | null
          id?: string
          is_active?: boolean | null
          item_code?: string
          item_name?: string
          manufacturer?: string | null
          maximum_stock_level?: number | null
          minimum_stock_level?: number | null
          mrp?: number | null
          pack_size?: number | null
          purchase_rate?: number | null
          reorder_level?: number | null
          selling_rate?: number | null
          service_provider?: string | null
          sub_category?: string | null
          unit_of_measurement?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      department_store_location_stock: {
        Row: {
          batch_inventory_id: string | null
          current_stock: number | null
          hospital_type: string
          id: string
          item_id: string | null
          last_updated: string | null
          location_id: number | null
        }
        Insert: {
          batch_inventory_id?: string | null
          current_stock?: number | null
          hospital_type: string
          id?: string
          item_id?: string | null
          last_updated?: string | null
          location_id?: number | null
        }
        Update: {
          batch_inventory_id?: string | null
          current_stock?: number | null
          hospital_type?: string
          id?: string
          item_id?: string | null
          last_updated?: string | null
          location_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "department_store_location_stock_batch_inventory_id_fkey"
            columns: ["batch_inventory_id"]
            isOneToOne: false
            referencedRelation: "department_store_batch_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_location_stock_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "department_store_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_location_stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "department_store_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_locations: {
        Row: {
          created_at: string | null
          hospital_type: string
          id: number
          is_active: boolean | null
          location_code: string | null
          location_name: string
          location_type: string | null
        }
        Insert: {
          created_at?: string | null
          hospital_type: string
          id?: number
          is_active?: boolean | null
          location_code?: string | null
          location_name: string
          location_type?: string | null
        }
        Update: {
          created_at?: string | null
          hospital_type?: string
          id?: number
          is_active?: boolean | null
          location_code?: string | null
          location_name?: string
          location_type?: string | null
        }
        Relationships: []
      }
      department_store_po_items: {
        Row: {
          amount: number
          batch_number: string | null
          created_at: string | null
          expiry_date: string | null
          gst_percentage: number | null
          id: string
          item_id: string | null
          mrp: number | null
          ordered_quantity: number
          product_name: string
          purchase_order_id: string | null
          purchase_price: number
          received_quantity: number | null
        }
        Insert: {
          amount: number
          batch_number?: string | null
          created_at?: string | null
          expiry_date?: string | null
          gst_percentage?: number | null
          id?: string
          item_id?: string | null
          mrp?: number | null
          ordered_quantity: number
          product_name: string
          purchase_order_id?: string | null
          purchase_price: number
          received_quantity?: number | null
        }
        Update: {
          amount?: number
          batch_number?: string | null
          created_at?: string | null
          expiry_date?: string | null
          gst_percentage?: number | null
          id?: string
          item_id?: string | null
          mrp?: number | null
          ordered_quantity?: number
          product_name?: string
          purchase_order_id?: string | null
          purchase_price?: number
          received_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "department_store_po_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "department_store_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_po_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "department_store_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_purchase_orders: {
        Row: {
          created_at: string | null
          created_by: string | null
          expected_delivery_date: string | null
          hospital_type: string
          id: string
          order_date: string
          po_number: string
          remarks: string | null
          status: string | null
          subtotal: number | null
          tax_amount: number | null
          total_amount: number | null
          vendor_id: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          expected_delivery_date?: string | null
          hospital_type: string
          id?: string
          order_date: string
          po_number: string
          remarks?: string | null
          status?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          total_amount?: number | null
          vendor_id?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          expected_delivery_date?: string | null
          hospital_type?: string
          id?: string
          order_date?: string
          po_number?: string
          remarks?: string | null
          status?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          total_amount?: number | null
          vendor_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "department_store_purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "department_store_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_requisition_items: {
        Row: {
          approved_quantity: number | null
          created_at: string | null
          id: string
          issued_quantity: number | null
          item_id: string | null
          product_name: string
          requested_quantity: number
          requisition_id: string | null
        }
        Insert: {
          approved_quantity?: number | null
          created_at?: string | null
          id?: string
          issued_quantity?: number | null
          item_id?: string | null
          product_name: string
          requested_quantity: number
          requisition_id?: string | null
        }
        Update: {
          approved_quantity?: number | null
          created_at?: string | null
          id?: string
          issued_quantity?: number | null
          item_id?: string | null
          product_name?: string
          requested_quantity?: number
          requisition_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_store_requisition_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "department_store_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_store_requisition_items_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "department_store_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_requisitions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          hospital_type: string
          id: string
          remarks: string | null
          requested_by: string | null
          requesting_department: string
          requisition_date: string
          requisition_number: string
          status: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          hospital_type: string
          id?: string
          remarks?: string | null
          requested_by?: string | null
          requesting_department: string
          requisition_date: string
          requisition_number: string
          status?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          hospital_type?: string
          id?: string
          remarks?: string | null
          requested_by?: string | null
          requesting_department?: string
          requisition_date?: string
          requisition_number?: string
          status?: string | null
        }
        Relationships: []
      }
      department_store_stock_movements: {
        Row: {
          batch_inventory_id: string | null
          hospital_type: string
          id: string
          movement_date: string | null
          movement_type: string
          performed_by: string | null
          quantity_after: number
          quantity_before: number
          quantity_changed: number
          reason: string | null
          reference_number: string | null
          reference_type: string | null
        }
        Insert: {
          batch_inventory_id?: string | null
          hospital_type: string
          id?: string
          movement_date?: string | null
          movement_type: string
          performed_by?: string | null
          quantity_after: number
          quantity_before: number
          quantity_changed: number
          reason?: string | null
          reference_number?: string | null
          reference_type?: string | null
        }
        Update: {
          batch_inventory_id?: string | null
          hospital_type?: string
          id?: string
          movement_date?: string | null
          movement_type?: string
          performed_by?: string | null
          quantity_after?: number
          quantity_before?: number
          quantity_changed?: number
          reason?: string | null
          reference_number?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_store_stock_movements_batch_inventory_id_fkey"
            columns: ["batch_inventory_id"]
            isOneToOne: false
            referencedRelation: "department_store_batch_inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      department_store_vendors: {
        Row: {
          address: string | null
          city: string | null
          contact_person: string | null
          created_at: string | null
          cst_number: string | null
          dl_number: string | null
          email: string | null
          gst_number: string | null
          hospital_type: string
          id: number
          is_active: boolean | null
          phone: string | null
          sales_tax_number: string | null
          vendor_code: string | null
          vendor_name: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          contact_person?: string | null
          created_at?: string | null
          cst_number?: string | null
          dl_number?: string | null
          email?: string | null
          gst_number?: string | null
          hospital_type: string
          id?: number
          is_active?: boolean | null
          phone?: string | null
          sales_tax_number?: string | null
          vendor_code?: string | null
          vendor_name: string
        }
        Update: {
          address?: string | null
          city?: string | null
          contact_person?: string | null
          created_at?: string | null
          cst_number?: string | null
          dl_number?: string | null
          email?: string | null
          gst_number?: string | null
          hospital_type?: string
          id?: number
          is_active?: boolean | null
          phone?: string | null
          sales_tax_number?: string | null
          vendor_code?: string | null
          vendor_name?: string
        }
        Relationships: []
      }
      diagnoses: {
        Row: {
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnoses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "diagnosis_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnosis_categories: {
        Row: {
          active: boolean | null
          color_code: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          specialty: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          specialty?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          specialty?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dialysis_month_status: {
        Row: {
          hospital_name: string
          id: string
          month: string
          notes: string | null
          paid: boolean
          paid_on: string | null
          updated_at: string
        }
        Insert: {
          hospital_name?: string
          id?: string
          month: string
          notes?: string | null
          paid?: boolean
          paid_on?: string | null
          updated_at?: string
        }
        Update: {
          hospital_name?: string
          id?: string
          month?: string
          notes?: string | null
          paid?: boolean
          paid_on?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dialysis_payout_config: {
        Row: {
          hospital_name: string
          id: string
          pay_after_months: number
          percentage: number
          updated_at: string
        }
        Insert: {
          hospital_name?: string
          id?: string
          pay_after_months?: number
          percentage?: number
          updated_at?: string
        }
        Update: {
          hospital_name?: string
          id?: string
          pay_after_months?: number
          percentage?: number
          updated_at?: string
        }
        Relationships: []
      }
      dialysis_rate_config: {
        Row: {
          active: boolean
          applies_to: string
          band_max: number | null
          band_min: number | null
          basis: string
          cash_pct: number | null
          created_at: string
          govt_pct: number | null
          hospital_name: string
          id: string
          label: string
          private_pct: number | null
          service_category: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to?: string
          band_max?: number | null
          band_min?: number | null
          basis?: string
          cash_pct?: number | null
          created_at?: string
          govt_pct?: number | null
          hospital_name?: string
          id?: string
          label: string
          private_pct?: number | null
          service_category: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to?: string
          band_max?: number | null
          band_min?: number | null
          basis?: string
          cash_pct?: number | null
          created_at?: string
          govt_pct?: number | null
          hospital_name?: string
          id?: string
          label?: string
          private_pct?: number | null
          service_category?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      dialysis_sessions: {
        Row: {
          charged_price: number
          created_at: string
          created_by: string | null
          encounter_type: string
          hope_share: number
          hospital_name: string
          id: string
          margin_amount: number | null
          nephroplus_share: number
          notes: string | null
          patient_id: string | null
          patient_name: string
          payer_type: string
          rate_pct_applied: number | null
          service_category: string
          session_date: string
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          charged_price?: number
          created_at?: string
          created_by?: string | null
          encounter_type: string
          hope_share?: number
          hospital_name?: string
          id?: string
          margin_amount?: number | null
          nephroplus_share?: number
          notes?: string | null
          patient_id?: string | null
          patient_name: string
          payer_type: string
          rate_pct_applied?: number | null
          service_category: string
          session_date?: string
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          charged_price?: number
          created_at?: string
          created_by?: string | null
          encounter_type?: string
          hope_share?: number
          hospital_name?: string
          id?: string
          margin_amount?: number | null
          nephroplus_share?: number
          notes?: string | null
          patient_id?: string | null
          patient_name?: string
          payer_type?: string
          rate_pct_applied?: number | null
          service_category?: string
          session_date?: string
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dialysis_sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialysis_sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      dialysis_staff: {
        Row: {
          created_at: string | null
          full_name: string
          id: number
          password: string
          role: string
          username: string
        }
        Insert: {
          created_at?: string | null
          full_name: string
          id?: number
          password: string
          role: string
          username: string
        }
        Update: {
          created_at?: string | null
          full_name?: string
          id?: number
          password?: string
          role?: string
          username?: string
        }
        Relationships: []
      }
      dicom_studies: {
        Row: {
          accession_number: string | null
          appointment_id: string | null
          archive_location: string | null
          archived: boolean | null
          artifact_description: string | null
          artifacts_present: boolean | null
          body_part_examined: string | null
          created_at: string | null
          id: string
          image_count: number | null
          modality: string
          order_id: string | null
          pacs_location: string | null
          patient_id: string
          patient_position: string | null
          performing_physician: string | null
          quality_score: number | null
          referring_physician: string | null
          series_count: number | null
          study_date: string
          study_description: string | null
          study_instance_uid: string
          study_size_mb: number | null
          study_time: string | null
          technical_adequacy: string | null
          updated_at: string | null
          view_position: string | null
        }
        Insert: {
          accession_number?: string | null
          appointment_id?: string | null
          archive_location?: string | null
          archived?: boolean | null
          artifact_description?: string | null
          artifacts_present?: boolean | null
          body_part_examined?: string | null
          created_at?: string | null
          id?: string
          image_count?: number | null
          modality: string
          order_id?: string | null
          pacs_location?: string | null
          patient_id: string
          patient_position?: string | null
          performing_physician?: string | null
          quality_score?: number | null
          referring_physician?: string | null
          series_count?: number | null
          study_date: string
          study_description?: string | null
          study_instance_uid: string
          study_size_mb?: number | null
          study_time?: string | null
          technical_adequacy?: string | null
          updated_at?: string | null
          view_position?: string | null
        }
        Update: {
          accession_number?: string | null
          appointment_id?: string | null
          archive_location?: string | null
          archived?: boolean | null
          artifact_description?: string | null
          artifacts_present?: boolean | null
          body_part_examined?: string | null
          created_at?: string | null
          id?: string
          image_count?: number | null
          modality?: string
          order_id?: string | null
          pacs_location?: string | null
          patient_id?: string
          patient_position?: string | null
          performing_physician?: string | null
          quality_score?: number | null
          referring_physician?: string | null
          series_count?: number | null
          study_date?: string
          study_description?: string | null
          study_instance_uid?: string
          study_size_mb?: number | null
          study_time?: string | null
          technical_adequacy?: string | null
          updated_at?: string | null
          view_position?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dicom_studies_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "radiology_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dicom_studies_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "radiology_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_sale_bills: {
        Row: {
          address: string | null
          age: number | null
          amount: number
          batch_inventory_id: string | null
          batch_no: string | null
          bill_date: string | null
          bill_number: string
          created_at: string | null
          created_by: string | null
          date_of_birth: string | null
          discount_amount: number | null
          doctor_name: string | null
          expiry_date: string | null
          gender: string | null
          hospital_name: string | null
          id: string
          is_hope_employee: boolean | null
          item_code: string | null
          item_name: string
          medicine_id: string | null
          mrp: number | null
          net_amount: number | null
          pack: string | null
          patient_name: string
          payment_mode: string | null
          price: number
          quantity: number
          quantity_unit: string | null
          stock: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          age?: number | null
          amount: number
          batch_inventory_id?: string | null
          batch_no?: string | null
          bill_date?: string | null
          bill_number: string
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          discount_amount?: number | null
          doctor_name?: string | null
          expiry_date?: string | null
          gender?: string | null
          hospital_name?: string | null
          id?: string
          is_hope_employee?: boolean | null
          item_code?: string | null
          item_name: string
          medicine_id?: string | null
          mrp?: number | null
          net_amount?: number | null
          pack?: string | null
          patient_name: string
          payment_mode?: string | null
          price: number
          quantity: number
          quantity_unit?: string | null
          stock?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          age?: number | null
          amount?: number
          batch_inventory_id?: string | null
          batch_no?: string | null
          bill_date?: string | null
          bill_number?: string
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          discount_amount?: number | null
          doctor_name?: string | null
          expiry_date?: string | null
          gender?: string | null
          hospital_name?: string | null
          id?: string
          is_hope_employee?: boolean | null
          item_code?: string | null
          item_name?: string
          medicine_id?: string | null
          mrp?: number | null
          net_amount?: number | null
          pack?: string | null
          patient_name?: string
          payment_mode?: string | null
          price?: number
          quantity?: number
          quantity_unit?: string | null
          stock?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "direct_sale_bills_batch_inventory_id_fkey"
            columns: ["batch_inventory_id"]
            isOneToOne: false
            referencedRelation: "medicine_batch_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_sale_bills_batch_inventory_id_fkey"
            columns: ["batch_inventory_id"]
            isOneToOne: false
            referencedRelation: "v_batch_stock_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_sale_bills_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicine_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_sale_bills_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacy_low_stock_alert"
            referencedColumns: ["id"]
          },
        ]
      }
      director_projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      discharge_checklist: {
        Row: {
          authorized_at: string | null
          authorized_by: string | null
          created_at: string | null
          discharge_mode: string | null
          discharge_summary_uploaded: boolean | null
          doctor_signature: boolean | null
          final_bill_generated: boolean | null
          final_bill_printed: boolean | null
          gate_pass_generated: boolean | null
          id: string
          notes: string | null
          nurse_clearance: boolean | null
          patient_signature: boolean | null
          payment_verified: boolean | null
          pharmacy_clearance: boolean | null
          security_verification: boolean | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          authorized_at?: string | null
          authorized_by?: string | null
          created_at?: string | null
          discharge_mode?: string | null
          discharge_summary_uploaded?: boolean | null
          doctor_signature?: boolean | null
          final_bill_generated?: boolean | null
          final_bill_printed?: boolean | null
          gate_pass_generated?: boolean | null
          id?: string
          notes?: string | null
          nurse_clearance?: boolean | null
          patient_signature?: boolean | null
          payment_verified?: boolean | null
          pharmacy_clearance?: boolean | null
          security_verification?: boolean | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          authorized_at?: string | null
          authorized_by?: string | null
          created_at?: string | null
          discharge_mode?: string | null
          discharge_summary_uploaded?: boolean | null
          doctor_signature?: boolean | null
          final_bill_generated?: boolean | null
          final_bill_printed?: boolean | null
          gate_pass_generated?: boolean | null
          id?: string
          notes?: string | null
          nurse_clearance?: boolean | null
          patient_signature?: boolean | null
          payment_verified?: boolean | null
          pharmacy_clearance?: boolean | null
          security_verification?: boolean | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discharge_checklist_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      discharge_summaries: {
        Row: {
          activity_diet: string | null
          admission_date: string | null
          clinical_summary: string | null
          complaints: string | null
          created_at: string | null
          discharge_condition: string | null
          discharge_date: string | null
          doctor_designation: string | null
          doctor_name: string | null
          emergency_contacts: string | null
          follow_up_instructions: string | null
          hospital_name: string | null
          id: string
          intra_op_findings: string | null
          investigations: string | null
          medications: string | null
          patient_address: string | null
          patient_age: string | null
          patient_gender: string | null
          patient_name: string | null
          primary_diagnosis: string | null
          secondary_diagnosis: string | null
          treatment_course: string | null
          updated_at: string | null
          visit_id: string
          vitals: string | null
          warning_signs: string | null
          wound_care: string | null
        }
        Insert: {
          activity_diet?: string | null
          admission_date?: string | null
          clinical_summary?: string | null
          complaints?: string | null
          created_at?: string | null
          discharge_condition?: string | null
          discharge_date?: string | null
          doctor_designation?: string | null
          doctor_name?: string | null
          emergency_contacts?: string | null
          follow_up_instructions?: string | null
          hospital_name?: string | null
          id?: string
          intra_op_findings?: string | null
          investigations?: string | null
          medications?: string | null
          patient_address?: string | null
          patient_age?: string | null
          patient_gender?: string | null
          patient_name?: string | null
          primary_diagnosis?: string | null
          secondary_diagnosis?: string | null
          treatment_course?: string | null
          updated_at?: string | null
          visit_id: string
          vitals?: string | null
          warning_signs?: string | null
          wound_care?: string | null
        }
        Update: {
          activity_diet?: string | null
          admission_date?: string | null
          clinical_summary?: string | null
          complaints?: string | null
          created_at?: string | null
          discharge_condition?: string | null
          discharge_date?: string | null
          doctor_designation?: string | null
          doctor_name?: string | null
          emergency_contacts?: string | null
          follow_up_instructions?: string | null
          hospital_name?: string | null
          id?: string
          intra_op_findings?: string | null
          investigations?: string | null
          medications?: string | null
          patient_address?: string | null
          patient_age?: string | null
          patient_gender?: string | null
          patient_name?: string | null
          primary_diagnosis?: string | null
          secondary_diagnosis?: string | null
          treatment_course?: string | null
          updated_at?: string | null
          visit_id?: string
          vitals?: string | null
          warning_signs?: string | null
          wound_care?: string | null
        }
        Relationships: []
      }
      doctor_assignments: {
        Row: {
          bill_id: string
          consultation_end: string
          consultation_start: string
          created_at: string
          doctor_name: string
          id: string
          specialization: string | null
        }
        Insert: {
          bill_id: string
          consultation_end: string
          consultation_start: string
          created_at?: string
          doctor_name: string
          id?: string
          specialization?: string | null
        }
        Update: {
          bill_id?: string
          consultation_end?: string
          consultation_start?: string
          created_at?: string
          doctor_name?: string
          id?: string
          specialization?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_assignments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_plan: {
        Row: {
          accommodation: string | null
          additional_approval_investigation: string | null
          additional_approval_investigation_date: string | null
          additional_approval_surgery: string | null
          additional_approval_surgery_date: string | null
          created_at: string | null
          date_of_stay: string | null
          day_number: number
          extension_stay_approval: string | null
          extension_stay_approval_date: string | null
          id: number
          lab_and_radiology: string | null
          medication: string | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          accommodation?: string | null
          additional_approval_investigation?: string | null
          additional_approval_investigation_date?: string | null
          additional_approval_surgery?: string | null
          additional_approval_surgery_date?: string | null
          created_at?: string | null
          date_of_stay?: string | null
          day_number: number
          extension_stay_approval?: string | null
          extension_stay_approval_date?: string | null
          id?: never
          lab_and_radiology?: string | null
          medication?: string | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          accommodation?: string | null
          additional_approval_investigation?: string | null
          additional_approval_investigation_date?: string | null
          additional_approval_surgery?: string | null
          additional_approval_surgery_date?: string | null
          created_at?: string | null
          date_of_stay?: string | null
          day_number?: number
          extension_stay_approval?: string | null
          extension_stay_approval_date?: string | null
          id?: never
          lab_and_radiology?: string | null
          medication?: string | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctor_plan_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_visits: {
        Row: {
          address: string | null
          check_in_at: string | null
          check_out_at: string | null
          contact_number: string | null
          created_at: string | null
          doctor_name: string
          email: string | null
          feedback_rating: number | null
          follow_up_date: string | null
          follow_up_notes: string | null
          hospital_clinic_name: string | null
          id: string
          latitude: number | null
          longitude: number | null
          marketing_user_id: string | null
          outcome: string | null
          samples_referred: number | null
          specialty: string | null
          updated_at: string | null
          visit_date: string
          visit_notes: string | null
          visit_photo_url: string | null
          visit_time: string | null
          visit_type: string | null
        }
        Insert: {
          address?: string | null
          check_in_at?: string | null
          check_out_at?: string | null
          contact_number?: string | null
          created_at?: string | null
          doctor_name: string
          email?: string | null
          feedback_rating?: number | null
          follow_up_date?: string | null
          follow_up_notes?: string | null
          hospital_clinic_name?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          marketing_user_id?: string | null
          outcome?: string | null
          samples_referred?: number | null
          specialty?: string | null
          updated_at?: string | null
          visit_date?: string
          visit_notes?: string | null
          visit_photo_url?: string | null
          visit_time?: string | null
          visit_type?: string | null
        }
        Update: {
          address?: string | null
          check_in_at?: string | null
          check_out_at?: string | null
          contact_number?: string | null
          created_at?: string | null
          doctor_name?: string
          email?: string | null
          feedback_rating?: number | null
          follow_up_date?: string | null
          follow_up_notes?: string | null
          hospital_clinic_name?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          marketing_user_id?: string | null
          outcome?: string | null
          samples_referred?: number | null
          specialty?: string | null
          updated_at?: string | null
          visit_date?: string
          visit_notes?: string | null
          visit_photo_url?: string | null
          visit_time?: string | null
          visit_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_visits_marketing_user_id_fkey"
            columns: ["marketing_user_id"]
            isOneToOne: false
            referencedRelation: "marketing_users"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          available_days: string[] | null
          consultation_fee: number | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          phone: string | null
          qualification: string | null
          room_number: string | null
          slot_duration_minutes: number | null
          specialty: string | null
        }
        Insert: {
          available_days?: string[] | null
          consultation_fee?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          phone?: string | null
          qualification?: string | null
          room_number?: string | null
          slot_duration_minutes?: number | null
          specialty?: string | null
        }
        Update: {
          available_days?: string[] | null
          consultation_fee?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          phone?: string | null
          qualification?: string | null
          room_number?: string | null
          slot_duration_minutes?: number | null
          specialty?: string | null
        }
        Relationships: []
      }
      equipment: {
        Row: {
          brand: string | null
          category_id: string
          condition_rating: number | null
          created_at: string | null
          equipment_id: string
          expected_life_years: number | null
          id: string
          installation_date: string | null
          is_active: boolean | null
          last_maintenance_date: string | null
          location_id: string
          maintenance_interval_days: number | null
          model: string | null
          name: string
          next_maintenance_date: string | null
          notes: string | null
          priority: Database["public"]["Enums"]["priority_level"] | null
          purchase_cost: number | null
          purchase_date: string | null
          qr_code: string | null
          serial_number: string | null
          specifications: Json | null
          status: Database["public"]["Enums"]["equipment_status"] | null
          updated_at: string | null
          vendor_id: string | null
          warranty_end_date: string | null
          warranty_start_date: string | null
          warranty_status: Database["public"]["Enums"]["warranty_status"] | null
          warranty_terms: string | null
        }
        Insert: {
          brand?: string | null
          category_id: string
          condition_rating?: number | null
          created_at?: string | null
          equipment_id: string
          expected_life_years?: number | null
          id?: string
          installation_date?: string | null
          is_active?: boolean | null
          last_maintenance_date?: string | null
          location_id: string
          maintenance_interval_days?: number | null
          model?: string | null
          name: string
          next_maintenance_date?: string | null
          notes?: string | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          purchase_cost?: number | null
          purchase_date?: string | null
          qr_code?: string | null
          serial_number?: string | null
          specifications?: Json | null
          status?: Database["public"]["Enums"]["equipment_status"] | null
          updated_at?: string | null
          vendor_id?: string | null
          warranty_end_date?: string | null
          warranty_start_date?: string | null
          warranty_status?:
            | Database["public"]["Enums"]["warranty_status"]
            | null
          warranty_terms?: string | null
        }
        Update: {
          brand?: string | null
          category_id?: string
          condition_rating?: number | null
          created_at?: string | null
          equipment_id?: string
          expected_life_years?: number | null
          id?: string
          installation_date?: string | null
          is_active?: boolean | null
          last_maintenance_date?: string | null
          location_id?: string
          maintenance_interval_days?: number | null
          model?: string | null
          name?: string
          next_maintenance_date?: string | null
          notes?: string | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          purchase_cost?: number | null
          purchase_date?: string | null
          qr_code?: string | null
          serial_number?: string | null
          specifications?: Json | null
          status?: Database["public"]["Enums"]["equipment_status"] | null
          updated_at?: string | null
          vendor_id?: string | null
          warranty_end_date?: string | null
          warranty_start_date?: string | null
          warranty_status?:
            | Database["public"]["Enums"]["warranty_status"]
            | null
          warranty_terms?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "equipment_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "hospital_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_categories: {
        Row: {
          color_code: string | null
          created_at: string | null
          description: string | null
          icon_name: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          icon_name?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          icon_name?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      equipment_compliance: {
        Row: {
          certificate_number: string | null
          compliance_type: string | null
          created_at: string | null
          document_path: string | null
          equipment_id: string
          expiry_date: string | null
          id: string
          issued_by: string | null
          issued_date: string | null
          reminder_days_before: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          certificate_number?: string | null
          compliance_type?: string | null
          created_at?: string | null
          document_path?: string | null
          equipment_id: string
          expiry_date?: string | null
          id?: string
          issued_by?: string | null
          issued_date?: string | null
          reminder_days_before?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          certificate_number?: string | null
          compliance_type?: string | null
          created_at?: string | null
          document_path?: string | null
          equipment_id?: string
          expiry_date?: string | null
          id?: string
          issued_by?: string | null
          issued_date?: string | null
          reminder_days_before?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_compliance_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_issues: {
        Row: {
          created_at: string | null
          description: string
          equipment_id: string
          equipment_operational: boolean | null
          estimated_downtime_hours: number | null
          id: string
          patient_safety_risk: boolean | null
          priority: Database["public"]["Enums"]["priority_level"] | null
          reported_by: string
          reported_by_role: string | null
          reported_date: string | null
          resolution_notes: string | null
          resolved_by: string | null
          resolved_date: string | null
          status: string | null
          title: string
          updated_at: string | null
          work_order_id: string | null
        }
        Insert: {
          created_at?: string | null
          description: string
          equipment_id: string
          equipment_operational?: boolean | null
          estimated_downtime_hours?: number | null
          id?: string
          patient_safety_risk?: boolean | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          reported_by: string
          reported_by_role?: string | null
          reported_date?: string | null
          resolution_notes?: string | null
          resolved_by?: string | null
          resolved_date?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
          work_order_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string
          equipment_id?: string
          equipment_operational?: boolean | null
          estimated_downtime_hours?: number | null
          id?: string
          patient_safety_risk?: boolean | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          reported_by?: string
          reported_by_role?: string | null
          reported_date?: string | null
          resolution_notes?: string | null
          resolved_by?: string | null
          resolved_date?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_issues_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_issues_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      esic_claims_extractions: {
        Row: {
          created_at: string | null
          extracted_at: string
          hospital_name: string
          id: string
          payer_type: string | null
          stage_data: Json
          total_claims: Json
          updated_at: string | null
          upload_id: string | null
        }
        Insert: {
          created_at?: string | null
          extracted_at: string
          hospital_name: string
          id?: string
          payer_type?: string | null
          stage_data?: Json
          total_claims?: Json
          updated_at?: string | null
          upload_id?: string | null
        }
        Update: {
          created_at?: string | null
          extracted_at?: string
          hospital_name?: string
          id?: string
          payer_type?: string | null
          stage_data?: Json
          total_claims?: Json
          updated_at?: string | null
          upload_id?: string | null
        }
        Relationships: []
      }
      esic_surgeons: {
        Row: {
          contact_info: string | null
          created_at: string
          department: string | null
          id: string
          is_active: boolean | null
          name: string
          specialty: string | null
          updated_at: string
        }
        Insert: {
          contact_info?: string | null
          created_at?: string
          department?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          contact_info?: string | null
          created_at?: string
          department?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          specialty?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      external_labs: {
        Row: {
          address: string | null
          contact_person: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string | null
          email: string | null
          id: string
          interface_type: string | null
          is_active: boolean | null
          lab_code: string
          lab_name: string
          lis_connection_details: Json | null
          phone: string | null
          pricing_structure: Json | null
          speciality_areas: string[] | null
          turnaround_time_hours: number | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          interface_type?: string | null
          is_active?: boolean | null
          lab_code: string
          lab_name: string
          lis_connection_details?: Json | null
          phone?: string | null
          pricing_structure?: Json | null
          speciality_areas?: string[] | null
          turnaround_time_hours?: number | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          interface_type?: string | null
          is_active?: boolean | null
          lab_code?: string
          lab_name?: string
          lis_connection_details?: Json | null
          phone?: string | null
          pricing_structure?: Json | null
          speciality_areas?: string[] | null
          turnaround_time_hours?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      external_requisitions: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          scan_center: string | null
          service_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          scan_center?: string | null
          service_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          scan_center?: string | null
          service_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      file_uploads: {
        Row: {
          capture_source: string | null
          category: string | null
          created_at: string | null
          error_message: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url: string | null
          gps_accuracy: number | null
          gps_captured_at: string | null
          hospital_id: string | null
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          patient_id: string | null
          patient_name: string | null
          records_count: number | null
          status: string
          storage_path: string
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          capture_source?: string | null
          category?: string | null
          created_at?: string | null
          error_message?: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url?: string | null
          gps_accuracy?: number | null
          gps_captured_at?: string | null
          hospital_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          patient_id?: string | null
          patient_name?: string | null
          records_count?: number | null
          status?: string
          storage_path: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          capture_source?: string | null
          category?: string | null
          created_at?: string | null
          error_message?: string | null
          file_name?: string
          file_size?: number
          file_type?: string
          file_url?: string | null
          gps_accuracy?: number | null
          gps_captured_at?: string | null
          hospital_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          patient_id?: string | null
          patient_name?: string | null
          records_count?: number | null
          status?: string
          storage_path?: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      final_payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          bank_account_name: string | null
          created_at: string
          created_by: string | null
          id: string
          mode_of_payment: string
          patient_id: string | null
          payment_date: string | null
          payment_remark: string | null
          reason_of_discharge: string
          visit_id: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          bank_account_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          mode_of_payment: string
          patient_id?: string | null
          payment_date?: string | null
          payment_remark?: string | null
          reason_of_discharge: string
          visit_id: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          bank_account_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          mode_of_payment?: string
          patient_id?: string | null
          payment_date?: string | null
          payment_remark?: string | null
          reason_of_discharge?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "final_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "final_payments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "final_payments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "final_payments_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["visit_id"]
          },
        ]
      }
      financial_summary: {
        Row: {
          amount_paid_accommodation_charges: number | null
          amount_paid_advance_payment: number | null
          amount_paid_blood: number | null
          amount_paid_clinical_services: number | null
          amount_paid_consultation: number | null
          amount_paid_implant: number | null
          amount_paid_implant_cost: number | null
          amount_paid_laboratory_services: number | null
          amount_paid_mandatory_services: number | null
          amount_paid_pharmacy: number | null
          amount_paid_physiotherapy: number | null
          amount_paid_private: number | null
          amount_paid_radiology: number | null
          amount_paid_surgery: number | null
          amount_paid_surgery_internal_report: number | null
          amount_paid_total: number | null
          balance_accommodation_charges: number | null
          balance_advance_payment: number | null
          balance_blood: number | null
          balance_clinical_services: number | null
          balance_consultation: number | null
          balance_implant: number | null
          balance_implant_cost: number | null
          balance_laboratory_services: number | null
          balance_mandatory_services: number | null
          balance_pharmacy: number | null
          balance_physiotherapy: number | null
          balance_private: number | null
          balance_radiology: number | null
          balance_surgery: number | null
          balance_surgery_internal_report: number | null
          balance_total: number | null
          bill_id: string
          created_at: string | null
          discount_accommodation_charges: number | null
          discount_advance_payment: number | null
          discount_blood: number | null
          discount_clinical_services: number | null
          discount_consultation: number | null
          discount_implant: number | null
          discount_implant_cost: number | null
          discount_laboratory_services: number | null
          discount_mandatory_services: number | null
          discount_pharmacy: number | null
          discount_physiotherapy: number | null
          discount_private: number | null
          discount_radiology: number | null
          discount_surgery: number | null
          discount_surgery_internal_report: number | null
          discount_total: number | null
          id: string
          package_end_date: string | null
          package_start_date: string | null
          refunded_amount_accommodation_charges: number | null
          refunded_amount_advance_payment: number | null
          refunded_amount_blood: number | null
          refunded_amount_clinical_services: number | null
          refunded_amount_consultation: number | null
          refunded_amount_implant: number | null
          refunded_amount_implant_cost: number | null
          refunded_amount_laboratory_services: number | null
          refunded_amount_mandatory_services: number | null
          refunded_amount_pharmacy: number | null
          refunded_amount_physiotherapy: number | null
          refunded_amount_private: number | null
          refunded_amount_radiology: number | null
          refunded_amount_surgery: number | null
          refunded_amount_surgery_internal_report: number | null
          refunded_amount_total: number | null
          total_admission_days: number | null
          total_amount_accommodation_charges: number | null
          total_amount_advance_payment: number | null
          total_amount_blood: number | null
          total_amount_clinical_services: number | null
          total_amount_consultation: number | null
          total_amount_implant: number | null
          total_amount_implant_cost: number | null
          total_amount_laboratory_services: number | null
          total_amount_mandatory_services: number | null
          total_amount_pharmacy: number | null
          total_amount_physiotherapy: number | null
          total_amount_private: number | null
          total_amount_radiology: number | null
          total_amount_surgery: number | null
          total_amount_surgery_internal_report: number | null
          total_amount_total: number | null
          total_package_days: number | null
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          amount_paid_accommodation_charges?: number | null
          amount_paid_advance_payment?: number | null
          amount_paid_blood?: number | null
          amount_paid_clinical_services?: number | null
          amount_paid_consultation?: number | null
          amount_paid_implant?: number | null
          amount_paid_implant_cost?: number | null
          amount_paid_laboratory_services?: number | null
          amount_paid_mandatory_services?: number | null
          amount_paid_pharmacy?: number | null
          amount_paid_physiotherapy?: number | null
          amount_paid_private?: number | null
          amount_paid_radiology?: number | null
          amount_paid_surgery?: number | null
          amount_paid_surgery_internal_report?: number | null
          amount_paid_total?: number | null
          balance_accommodation_charges?: number | null
          balance_advance_payment?: number | null
          balance_blood?: number | null
          balance_clinical_services?: number | null
          balance_consultation?: number | null
          balance_implant?: number | null
          balance_implant_cost?: number | null
          balance_laboratory_services?: number | null
          balance_mandatory_services?: number | null
          balance_pharmacy?: number | null
          balance_physiotherapy?: number | null
          balance_private?: number | null
          balance_radiology?: number | null
          balance_surgery?: number | null
          balance_surgery_internal_report?: number | null
          balance_total?: number | null
          bill_id: string
          created_at?: string | null
          discount_accommodation_charges?: number | null
          discount_advance_payment?: number | null
          discount_blood?: number | null
          discount_clinical_services?: number | null
          discount_consultation?: number | null
          discount_implant?: number | null
          discount_implant_cost?: number | null
          discount_laboratory_services?: number | null
          discount_mandatory_services?: number | null
          discount_pharmacy?: number | null
          discount_physiotherapy?: number | null
          discount_private?: number | null
          discount_radiology?: number | null
          discount_surgery?: number | null
          discount_surgery_internal_report?: number | null
          discount_total?: number | null
          id?: string
          package_end_date?: string | null
          package_start_date?: string | null
          refunded_amount_accommodation_charges?: number | null
          refunded_amount_advance_payment?: number | null
          refunded_amount_blood?: number | null
          refunded_amount_clinical_services?: number | null
          refunded_amount_consultation?: number | null
          refunded_amount_implant?: number | null
          refunded_amount_implant_cost?: number | null
          refunded_amount_laboratory_services?: number | null
          refunded_amount_mandatory_services?: number | null
          refunded_amount_pharmacy?: number | null
          refunded_amount_physiotherapy?: number | null
          refunded_amount_private?: number | null
          refunded_amount_radiology?: number | null
          refunded_amount_surgery?: number | null
          refunded_amount_surgery_internal_report?: number | null
          refunded_amount_total?: number | null
          total_admission_days?: number | null
          total_amount_accommodation_charges?: number | null
          total_amount_advance_payment?: number | null
          total_amount_blood?: number | null
          total_amount_clinical_services?: number | null
          total_amount_consultation?: number | null
          total_amount_implant?: number | null
          total_amount_implant_cost?: number | null
          total_amount_laboratory_services?: number | null
          total_amount_mandatory_services?: number | null
          total_amount_pharmacy?: number | null
          total_amount_physiotherapy?: number | null
          total_amount_private?: number | null
          total_amount_radiology?: number | null
          total_amount_surgery?: number | null
          total_amount_surgery_internal_report?: number | null
          total_amount_total?: number | null
          total_package_days?: number | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          amount_paid_accommodation_charges?: number | null
          amount_paid_advance_payment?: number | null
          amount_paid_blood?: number | null
          amount_paid_clinical_services?: number | null
          amount_paid_consultation?: number | null
          amount_paid_implant?: number | null
          amount_paid_implant_cost?: number | null
          amount_paid_laboratory_services?: number | null
          amount_paid_mandatory_services?: number | null
          amount_paid_pharmacy?: number | null
          amount_paid_physiotherapy?: number | null
          amount_paid_private?: number | null
          amount_paid_radiology?: number | null
          amount_paid_surgery?: number | null
          amount_paid_surgery_internal_report?: number | null
          amount_paid_total?: number | null
          balance_accommodation_charges?: number | null
          balance_advance_payment?: number | null
          balance_blood?: number | null
          balance_clinical_services?: number | null
          balance_consultation?: number | null
          balance_implant?: number | null
          balance_implant_cost?: number | null
          balance_laboratory_services?: number | null
          balance_mandatory_services?: number | null
          balance_pharmacy?: number | null
          balance_physiotherapy?: number | null
          balance_private?: number | null
          balance_radiology?: number | null
          balance_surgery?: number | null
          balance_surgery_internal_report?: number | null
          balance_total?: number | null
          bill_id?: string
          created_at?: string | null
          discount_accommodation_charges?: number | null
          discount_advance_payment?: number | null
          discount_blood?: number | null
          discount_clinical_services?: number | null
          discount_consultation?: number | null
          discount_implant?: number | null
          discount_implant_cost?: number | null
          discount_laboratory_services?: number | null
          discount_mandatory_services?: number | null
          discount_pharmacy?: number | null
          discount_physiotherapy?: number | null
          discount_private?: number | null
          discount_radiology?: number | null
          discount_surgery?: number | null
          discount_surgery_internal_report?: number | null
          discount_total?: number | null
          id?: string
          package_end_date?: string | null
          package_start_date?: string | null
          refunded_amount_accommodation_charges?: number | null
          refunded_amount_advance_payment?: number | null
          refunded_amount_blood?: number | null
          refunded_amount_clinical_services?: number | null
          refunded_amount_consultation?: number | null
          refunded_amount_implant?: number | null
          refunded_amount_implant_cost?: number | null
          refunded_amount_laboratory_services?: number | null
          refunded_amount_mandatory_services?: number | null
          refunded_amount_pharmacy?: number | null
          refunded_amount_physiotherapy?: number | null
          refunded_amount_private?: number | null
          refunded_amount_radiology?: number | null
          refunded_amount_surgery?: number | null
          refunded_amount_surgery_internal_report?: number | null
          refunded_amount_total?: number | null
          total_admission_days?: number | null
          total_amount_accommodation_charges?: number | null
          total_amount_advance_payment?: number | null
          total_amount_blood?: number | null
          total_amount_clinical_services?: number | null
          total_amount_consultation?: number | null
          total_amount_implant?: number | null
          total_amount_implant_cost?: number | null
          total_amount_laboratory_services?: number | null
          total_amount_mandatory_services?: number | null
          total_amount_pharmacy?: number | null
          total_amount_physiotherapy?: number | null
          total_amount_private?: number | null
          total_amount_radiology?: number | null
          total_amount_surgery?: number | null
          total_amount_surgery_internal_report?: number | null
          total_amount_total?: number | null
          total_package_days?: number | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_summary_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: true
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_summary_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_tasks: {
        Row: {
          claim_number: string | null
          contact_email: string
          contact_name: string | null
          created_at: string | null
          due_date: string | null
          follow_up_type: string | null
          id: string
          message: string | null
          priority: string | null
          status: string | null
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          claim_number?: string | null
          contact_email: string
          contact_name?: string | null
          created_at?: string | null
          due_date?: string | null
          follow_up_type?: string | null
          id?: string
          message?: string | null
          priority?: string | null
          status?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          claim_number?: string | null
          contact_email?: string
          contact_name?: string | null
          created_at?: string | null
          due_date?: string | null
          follow_up_type?: string | null
          id?: string
          message?: string | null
          priority?: string | null
          status?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      follow_ups: {
        Row: {
          created_at: string | null
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          organization: string | null
          phone: string | null
          role: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          role?: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          role?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      followup_log: {
        Row: {
          error: string | null
          id: string
          master_data_id: string
          message_id: string | null
          mobile: string
          person_type: string
          sent_at: string | null
          status: string | null
        }
        Insert: {
          error?: string | null
          id?: string
          master_data_id: string
          message_id?: string | null
          mobile: string
          person_type: string
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          error?: string | null
          id?: string
          master_data_id?: string
          message_id?: string | null
          mobile?: string
          person_type?: string
          sent_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      gate_passes: {
        Row: {
          barcode_data: string | null
          bill_paid: boolean | null
          billing_officer_signature: string | null
          created_at: string | null
          discharge_date: string
          discharge_mode: string
          gate_pass_number: string
          id: string
          is_active: boolean | null
          patient_id: string
          patient_name: string
          payment_amount: number | null
          receptionist_signature: string | null
          security_verified: boolean | null
          updated_at: string | null
          verified_at: string | null
          verified_by: string | null
          visit_id: string
        }
        Insert: {
          barcode_data?: string | null
          bill_paid?: boolean | null
          billing_officer_signature?: string | null
          created_at?: string | null
          discharge_date: string
          discharge_mode?: string
          gate_pass_number: string
          id?: string
          is_active?: boolean | null
          patient_id: string
          patient_name: string
          payment_amount?: number | null
          receptionist_signature?: string | null
          security_verified?: boolean | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
          visit_id: string
        }
        Update: {
          barcode_data?: string | null
          bill_paid?: boolean | null
          billing_officer_signature?: string | null
          created_at?: string | null
          discharge_date?: string
          discharge_mode?: string
          gate_pass_number?: string
          id?: string
          is_active?: boolean | null
          patient_id?: string
          patient_name?: string
          payment_amount?: number | null
          receptionist_signature?: string | null
          security_verified?: boolean | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate_passes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gate_passes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "gate_passes_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      gatepass_notifications: {
        Row: {
          created_at: string | null
          custom_reason: string | null
          id: string
          patient_id: string | null
          patient_name: string | null
          pending_amount: number | null
          reason: string
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          created_at?: string | null
          custom_reason?: string | null
          id?: string
          patient_id?: string | null
          patient_name?: string | null
          pending_amount?: number | null
          reason: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          created_at?: string | null
          custom_reason?: string | null
          id?: string
          patient_id?: string | null
          patient_name?: string | null
          pending_amount?: number | null
          reason?: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gatepass_notifications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gatepass_notifications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      goods_received_notes: {
        Row: {
          created_at: string | null
          created_by: string | null
          discount: number | null
          grn_date: string
          grn_number: string
          hospital_name: string | null
          id: string
          invoice_amount: number | null
          invoice_date: string | null
          invoice_number: string | null
          notes: string | null
          po_number: string | null
          purchase_order_id: string
          remarks: string | null
          status: string | null
          supplier_id: number | null
          total_amount: number
          total_items: number
          total_quantity_ordered: number
          total_quantity_received: number
          updated_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          discount?: number | null
          grn_date: string
          grn_number: string
          hospital_name?: string | null
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          po_number?: string | null
          purchase_order_id: string
          remarks?: string | null
          status?: string | null
          supplier_id?: number | null
          total_amount?: number
          total_items?: number
          total_quantity_ordered?: number
          total_quantity_received?: number
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          discount?: number | null
          grn_date?: string
          grn_number?: string
          hospital_name?: string | null
          id?: string
          invoice_amount?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          po_number?: string | null
          purchase_order_id?: string
          remarks?: string | null
          status?: string | null
          supplier_id?: number | null
          total_amount?: number
          total_items?: number
          total_quantity_ordered?: number
          total_quantity_received?: number
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_received_notes_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_received_notes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      grn_items: {
        Row: {
          accepted_quantity: number | null
          amount: number | null
          batch_number: string
          cgst: number | null
          created_at: string | null
          expiry_date: string
          free_quantity: number | null
          grn_id: string
          gst: number | null
          id: string
          manufacturer: string | null
          manufacturing_date: string | null
          medicine_id: string | null
          mrp: number | null
          ordered_quantity: number
          pack: string | null
          pieces_per_pack: number | null
          product_name: string
          purchase_order_item_id: string | null
          purchase_price: number
          rack_number: string | null
          received_quantity: number
          rejected_quantity: number | null
          sale_price: number | null
          sgst: number | null
          shelf_location: string | null
          tax_amount: number | null
        }
        Insert: {
          accepted_quantity?: number | null
          amount?: number | null
          batch_number: string
          cgst?: number | null
          created_at?: string | null
          expiry_date: string
          free_quantity?: number | null
          grn_id: string
          gst?: number | null
          id?: string
          manufacturer?: string | null
          manufacturing_date?: string | null
          medicine_id?: string | null
          mrp?: number | null
          ordered_quantity?: number
          pack?: string | null
          pieces_per_pack?: number | null
          product_name: string
          purchase_order_item_id?: string | null
          purchase_price: number
          rack_number?: string | null
          received_quantity?: number
          rejected_quantity?: number | null
          sale_price?: number | null
          sgst?: number | null
          shelf_location?: string | null
          tax_amount?: number | null
        }
        Update: {
          accepted_quantity?: number | null
          amount?: number | null
          batch_number?: string
          cgst?: number | null
          created_at?: string | null
          expiry_date?: string
          free_quantity?: number | null
          grn_id?: string
          gst?: number | null
          id?: string
          manufacturer?: string | null
          manufacturing_date?: string | null
          medicine_id?: string | null
          mrp?: number | null
          ordered_quantity?: number
          pack?: string | null
          pieces_per_pack?: number | null
          product_name?: string
          purchase_order_item_id?: string | null
          purchase_price?: number
          rack_number?: string | null
          received_quantity?: number
          rejected_quantity?: number | null
          sale_price?: number | null
          sgst?: number | null
          shelf_location?: string | null
          tax_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "grn_items_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_received_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_items_purchase_order_item_id_fkey"
            columns: ["purchase_order_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      home_collection_requests: {
        Row: {
          address: string
          arrived_at: string | null
          assigned_at: string | null
          b2b_partner_code: string | null
          b2b_partner_id: string | null
          barcodes: string[] | null
          collected_at: string | null
          collection_charges: number | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          en_route_at: string | null
          id: string
          latitude: number | null
          locality: string | null
          longitude: number | null
          mobile: string
          notes: string | null
          patient_id: string | null
          patient_name: string
          payment_mode: string | null
          payment_status: string | null
          phlebotomist_id: string | null
          phlebotomist_name: string | null
          pincode: string | null
          preferred_date: string
          preferred_time_slot: string | null
          request_number: string | null
          service_type: string | null
          special_instructions: string | null
          status: string
          tests_requested: string[]
          updated_at: string
          vial_details: Json | null
        }
        Insert: {
          address: string
          arrived_at?: string | null
          assigned_at?: string | null
          b2b_partner_code?: string | null
          b2b_partner_id?: string | null
          barcodes?: string[] | null
          collected_at?: string | null
          collection_charges?: number | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          en_route_at?: string | null
          id?: string
          latitude?: number | null
          locality?: string | null
          longitude?: number | null
          mobile: string
          notes?: string | null
          patient_id?: string | null
          patient_name: string
          payment_mode?: string | null
          payment_status?: string | null
          phlebotomist_id?: string | null
          phlebotomist_name?: string | null
          pincode?: string | null
          preferred_date?: string
          preferred_time_slot?: string | null
          request_number?: string | null
          service_type?: string | null
          special_instructions?: string | null
          status?: string
          tests_requested?: string[]
          updated_at?: string
          vial_details?: Json | null
        }
        Update: {
          address?: string
          arrived_at?: string | null
          assigned_at?: string | null
          b2b_partner_code?: string | null
          b2b_partner_id?: string | null
          barcodes?: string[] | null
          collected_at?: string | null
          collection_charges?: number | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          en_route_at?: string | null
          id?: string
          latitude?: number | null
          locality?: string | null
          longitude?: number | null
          mobile?: string
          notes?: string | null
          patient_id?: string | null
          patient_name?: string
          payment_mode?: string | null
          payment_status?: string | null
          phlebotomist_id?: string | null
          phlebotomist_name?: string | null
          pincode?: string | null
          preferred_date?: string
          preferred_time_slot?: string | null
          request_number?: string | null
          service_type?: string | null
          special_instructions?: string | null
          status?: string
          tests_requested?: string[]
          updated_at?: string
          vial_details?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "home_collection_requests_b2b_partner_id_fkey"
            columns: ["b2b_partner_id"]
            isOneToOne: false
            referencedRelation: "b2b_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_collection_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_collection_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "home_collection_requests_phlebotomist_id_fkey"
            columns: ["phlebotomist_id"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      hope_anaesthetists: {
        Row: {
          contact_info: string | null
          general_rate: number | null
          name: string
          specialty: string | null
          spinal_rate: number | null
        }
        Insert: {
          contact_info?: string | null
          general_rate?: number | null
          name: string
          specialty?: string | null
          spinal_rate?: number | null
        }
        Update: {
          contact_info?: string | null
          general_rate?: number | null
          name?: string
          specialty?: string | null
          spinal_rate?: number | null
        }
        Relationships: []
      }
      hope_consultants: {
        Row: {
          contact_info: string | null
          created_at: string
          department: string | null
          id: string
          nabh_rate: number | null
          name: string
          non_nabh_rate: number | null
          phone: string | null
          private_rate: number | null
          specialty: string | null
          tpa_rate: number | null
          updated_at: string
        }
        Insert: {
          contact_info?: string | null
          created_at?: string
          department?: string | null
          id?: string
          nabh_rate?: number | null
          name: string
          non_nabh_rate?: number | null
          phone?: string | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string
        }
        Update: {
          contact_info?: string | null
          created_at?: string
          department?: string | null
          id?: string
          nabh_rate?: number | null
          name?: string
          non_nabh_rate?: number | null
          phone?: string | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      hope_rmos: {
        Row: {
          contact_info: string | null
          created_at: string | null
          daily_remuneration: number | null
          department: string | null
          id: string
          is_active: boolean | null
          nabh_rate: number | null
          name: string
          non_nabh_rate: number | null
          private_rate: number | null
          specialty: string | null
          tpa_rate: number | null
          updated_at: string | null
        }
        Insert: {
          contact_info?: string | null
          created_at?: string | null
          daily_remuneration?: number | null
          department?: string | null
          id?: string
          is_active?: boolean | null
          nabh_rate?: number | null
          name: string
          non_nabh_rate?: number | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          contact_info?: string | null
          created_at?: string | null
          daily_remuneration?: number | null
          department?: string | null
          id?: string
          is_active?: boolean | null
          nabh_rate?: number | null
          name?: string
          non_nabh_rate?: number | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      hope_surgeons: {
        Row: {
          contact_info: string | null
          created_at: string
          department: string | null
          id: string
          is_active: boolean | null
          nabh_rate: number | null
          name: string
          "non-nabh_rate": number | null
          private_rate: number | null
          specialty: string | null
          tpa_rate: number | null
          updated_at: string
        }
        Insert: {
          contact_info?: string | null
          created_at?: string
          department?: string | null
          id?: string
          is_active?: boolean | null
          nabh_rate?: number | null
          name: string
          "non-nabh_rate"?: number | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string
        }
        Update: {
          contact_info?: string | null
          created_at?: string
          department?: string | null
          id?: string
          is_active?: boolean | null
          nabh_rate?: number | null
          name?: string
          "non-nabh_rate"?: number | null
          private_rate?: number | null
          specialty?: string | null
          tpa_rate?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      hospital_locations: {
        Row: {
          building: string | null
          code: string
          created_at: string | null
          department: string | null
          floor_number: number | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          building?: string | null
          code: string
          created_at?: string | null
          department?: string | null
          floor_number?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          building?: string | null
          code?: string
          created_at?: string | null
          department?: string | null
          floor_number?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      implants: {
        Row: {
          bhopal_nabh_rate: number | null
          bhopal_non_nabh_rate: number | null
          created_at: string | null
          id: string
          nabh_nabl_rate: number | null
          name: string
          non_nabh_nabl_rate: number | null
          private_rate: number | null
          updated_at: string | null
        }
        Insert: {
          bhopal_nabh_rate?: number | null
          bhopal_non_nabh_rate?: number | null
          created_at?: string | null
          id?: string
          nabh_nabl_rate?: number | null
          name: string
          non_nabh_nabl_rate?: number | null
          private_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          bhopal_nabh_rate?: number | null
          bhopal_non_nabh_rate?: number | null
          created_at?: string | null
          id?: string
          nabh_nabl_rate?: number | null
          name?: string
          non_nabh_nabl_rate?: number | null
          private_rate?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          batch_number: string | null
          category: string
          created_at: string | null
          current_stock: number
          expiry_date: string | null
          id: string
          last_restocked: string | null
          last_sterilized: string | null
          max_stock_level: number
          min_stock_level: number
          name: string
          sterilization_required: boolean | null
          supplier: string
          unit_cost: number
          updated_at: string | null
          usage_per_day: number | null
        }
        Insert: {
          batch_number?: string | null
          category: string
          created_at?: string | null
          current_stock?: number
          expiry_date?: string | null
          id?: string
          last_restocked?: string | null
          last_sterilized?: string | null
          max_stock_level?: number
          min_stock_level?: number
          name: string
          sterilization_required?: boolean | null
          supplier: string
          unit_cost?: number
          updated_at?: string | null
          usage_per_day?: number | null
        }
        Update: {
          batch_number?: string | null
          category?: string
          created_at?: string | null
          current_stock?: number
          expiry_date?: string | null
          id?: string
          last_restocked?: string | null
          last_sterilized?: string | null
          max_stock_level?: number
          min_stock_level?: number
          name?: string
          sterilization_required?: boolean | null
          supplier?: string
          unit_cost?: number
          updated_at?: string | null
          usage_per_day?: number | null
        }
        Relationships: []
      }
      inventory_parts: {
        Row: {
          category: string | null
          compatible_equipment: string[] | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          minimum_stock_level: number | null
          name: string
          part_number: string
          stock_quantity: number | null
          unit_price: number | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          category?: string | null
          compatible_equipment?: string[] | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          minimum_stock_level?: number | null
          name: string
          part_number: string
          stock_quantity?: number | null
          unit_price?: number | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          category?: string | null
          compatible_equipment?: string[] | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          minimum_stock_level?: number | null
          name?: string
          part_number?: string
          stock_quantity?: number | null
          unit_price?: number | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_parts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      io_chart: {
        Row: {
          bed_no: string | null
          category: string
          entry_type: string
          id: string
          notes: string | null
          patient_id: string | null
          rate_ml_hr: number | null
          recorded_at: string | null
          recorded_by: string | null
          sub_category: string | null
          visit_id: string | null
          volume_ml: number
          ward: string | null
        }
        Insert: {
          bed_no?: string | null
          category: string
          entry_type: string
          id?: string
          notes?: string | null
          patient_id?: string | null
          rate_ml_hr?: number | null
          recorded_at?: string | null
          recorded_by?: string | null
          sub_category?: string | null
          visit_id?: string | null
          volume_ml: number
          ward?: string | null
        }
        Update: {
          bed_no?: string | null
          category?: string
          entry_type?: string
          id?: string
          notes?: string | null
          patient_id?: string | null
          rate_ml_hr?: number | null
          recorded_at?: string | null
          recorded_by?: string | null
          sub_category?: string | null
          visit_id?: string | null
          volume_ml?: number
          ward?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "io_chart_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "io_chart_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "io_chart_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      ipd_discharge_summary: {
        Row: {
          activity_restrictions: string | null
          addiction_history: string | null
          additional_data: Json | null
          address: string | null
          admission_date: string
          admission_medications: Json | null
          age_sex: string | null
          amount_due: number | null
          amount_paid: number | null
          approval_date: string | null
          approved_by: string | null
          bed_number: string | null
          billing_details: Json | null
          chief_complaints: string | null
          complications_during_stay: string | null
          condition_on_discharge: string | null
          corporate_type: string | null
          created_at: string | null
          daily_progress_notes: Json | null
          date_of_discharge: string | null
          diagnosis_count: number | null
          diagnosis_data: Json | null
          diet_instructions: string | null
          discharge_advice: string | null
          discharge_condition_details: string | null
          discharge_medications: Json | null
          discharge_summary_prepared_by: string | null
          family_history: string | null
          follow_up_details: Json | null
          follow_up_instructions: string | null
          form_data: Json | null
          form_errors: string | null
          general_examination: string | null
          history_of_present_illness: string | null
          hospital_course: string | null
          hospital_details: Json | null
          hospital_stay_notes: string | null
          id: string
          imaging_studies: Json | null
          is_printed: boolean | null
          lab_investigations: Json | null
          last_printed_at: string | null
          medication_on_discharge: string | null
          operation_notes: string | null
          ot_notes: string | null
          other_consultants: string | null
          past_medical_history: string | null
          patient_advice: string | null
          patient_id: string
          patient_name: string
          personal_history: string | null
          prepared_by: string | null
          primary_diagnosis: string | null
          print_count: number | null
          procedures_performed: Json | null
          reason_of_discharge: string | null
          referring_doctor: string | null
          reg_id: string | null
          resident_on_discharge: string | null
          review_on_date: string | null
          special_instructions: string | null
          status: string | null
          summary_date: string | null
          surgical_procedure: string | null
          systemic_examination: Json | null
          total_bill_amount: number | null
          total_stay_days: number | null
          treating_consultant: string | null
          treatment_details: string | null
          treatment_during_stay: string | null
          updated_at: string | null
          validation_errors: Json | null
          visit_id: string
          vital_signs: Json | null
          ward_name: string | null
          warning_signs: string | null
        }
        Insert: {
          activity_restrictions?: string | null
          addiction_history?: string | null
          additional_data?: Json | null
          address?: string | null
          admission_date: string
          admission_medications?: Json | null
          age_sex?: string | null
          amount_due?: number | null
          amount_paid?: number | null
          approval_date?: string | null
          approved_by?: string | null
          bed_number?: string | null
          billing_details?: Json | null
          chief_complaints?: string | null
          complications_during_stay?: string | null
          condition_on_discharge?: string | null
          corporate_type?: string | null
          created_at?: string | null
          daily_progress_notes?: Json | null
          date_of_discharge?: string | null
          diagnosis_count?: number | null
          diagnosis_data?: Json | null
          diet_instructions?: string | null
          discharge_advice?: string | null
          discharge_condition_details?: string | null
          discharge_medications?: Json | null
          discharge_summary_prepared_by?: string | null
          family_history?: string | null
          follow_up_details?: Json | null
          follow_up_instructions?: string | null
          form_data?: Json | null
          form_errors?: string | null
          general_examination?: string | null
          history_of_present_illness?: string | null
          hospital_course?: string | null
          hospital_details?: Json | null
          hospital_stay_notes?: string | null
          id?: string
          imaging_studies?: Json | null
          is_printed?: boolean | null
          lab_investigations?: Json | null
          last_printed_at?: string | null
          medication_on_discharge?: string | null
          operation_notes?: string | null
          ot_notes?: string | null
          other_consultants?: string | null
          past_medical_history?: string | null
          patient_advice?: string | null
          patient_id: string
          patient_name: string
          personal_history?: string | null
          prepared_by?: string | null
          primary_diagnosis?: string | null
          print_count?: number | null
          procedures_performed?: Json | null
          reason_of_discharge?: string | null
          referring_doctor?: string | null
          reg_id?: string | null
          resident_on_discharge?: string | null
          review_on_date?: string | null
          special_instructions?: string | null
          status?: string | null
          summary_date?: string | null
          surgical_procedure?: string | null
          systemic_examination?: Json | null
          total_bill_amount?: number | null
          total_stay_days?: number | null
          treating_consultant?: string | null
          treatment_details?: string | null
          treatment_during_stay?: string | null
          updated_at?: string | null
          validation_errors?: Json | null
          visit_id: string
          vital_signs?: Json | null
          ward_name?: string | null
          warning_signs?: string | null
        }
        Update: {
          activity_restrictions?: string | null
          addiction_history?: string | null
          additional_data?: Json | null
          address?: string | null
          admission_date?: string
          admission_medications?: Json | null
          age_sex?: string | null
          amount_due?: number | null
          amount_paid?: number | null
          approval_date?: string | null
          approved_by?: string | null
          bed_number?: string | null
          billing_details?: Json | null
          chief_complaints?: string | null
          complications_during_stay?: string | null
          condition_on_discharge?: string | null
          corporate_type?: string | null
          created_at?: string | null
          daily_progress_notes?: Json | null
          date_of_discharge?: string | null
          diagnosis_count?: number | null
          diagnosis_data?: Json | null
          diet_instructions?: string | null
          discharge_advice?: string | null
          discharge_condition_details?: string | null
          discharge_medications?: Json | null
          discharge_summary_prepared_by?: string | null
          family_history?: string | null
          follow_up_details?: Json | null
          follow_up_instructions?: string | null
          form_data?: Json | null
          form_errors?: string | null
          general_examination?: string | null
          history_of_present_illness?: string | null
          hospital_course?: string | null
          hospital_details?: Json | null
          hospital_stay_notes?: string | null
          id?: string
          imaging_studies?: Json | null
          is_printed?: boolean | null
          lab_investigations?: Json | null
          last_printed_at?: string | null
          medication_on_discharge?: string | null
          operation_notes?: string | null
          ot_notes?: string | null
          other_consultants?: string | null
          past_medical_history?: string | null
          patient_advice?: string | null
          patient_id?: string
          patient_name?: string
          personal_history?: string | null
          prepared_by?: string | null
          primary_diagnosis?: string | null
          print_count?: number | null
          procedures_performed?: Json | null
          reason_of_discharge?: string | null
          referring_doctor?: string | null
          reg_id?: string | null
          resident_on_discharge?: string | null
          review_on_date?: string | null
          special_instructions?: string | null
          status?: string | null
          summary_date?: string | null
          surgical_procedure?: string | null
          systemic_examination?: Json | null
          total_bill_amount?: number | null
          total_stay_days?: number | null
          treating_consultant?: string | null
          treatment_details?: string | null
          treatment_during_stay?: string | null
          updated_at?: string | null
          validation_errors?: Json | null
          visit_id?: string
          vital_signs?: Json | null
          ward_name?: string | null
          warning_signs?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ipd_discharge_summary_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ipd_discharge_summary_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "ipd_discharge_summary_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      item_stock: {
        Row: {
          batch_number: string | null
          cost_price: number | null
          cst: number | null
          expiry_date: string | null
          id: number
          is_deleted: boolean | null
          item_id: number | null
          location_id: number | null
          loose_stock: number | null
          mrp: number | null
          mstpflag: boolean | null
          purchase_price: number | null
          sale_price: number | null
          stock: number | null
          tax: number | null
          vat_class_id: number | null
          vat_class_name: string | null
          vat_sat_sum: number | null
        }
        Insert: {
          batch_number?: string | null
          cost_price?: number | null
          cst?: number | null
          expiry_date?: string | null
          id?: number
          is_deleted?: boolean | null
          item_id?: number | null
          location_id?: number | null
          loose_stock?: number | null
          mrp?: number | null
          mstpflag?: boolean | null
          purchase_price?: number | null
          sale_price?: number | null
          stock?: number | null
          tax?: number | null
          vat_class_id?: number | null
          vat_class_name?: string | null
          vat_sat_sum?: number | null
        }
        Update: {
          batch_number?: string | null
          cost_price?: number | null
          cst?: number | null
          expiry_date?: string | null
          id?: number
          is_deleted?: boolean | null
          item_id?: number | null
          location_id?: number | null
          loose_stock?: number | null
          mrp?: number | null
          mstpflag?: boolean | null
          purchase_price?: number | null
          sale_price?: number | null
          stock?: number | null
          tax?: number | null
          vat_class_id?: number | null
          vat_class_name?: string | null
          vat_sat_sum?: number | null
        }
        Relationships: []
      }
      lab: {
        Row: {
          attach_file: boolean | null
          attributes: Json | null
          bhopal_nabh_rate: number | null
          bhopal_non_nabh_rate: number | null
          category: string | null
          CGHS_code: string | null
          cpt_code: string | null
          created_at: string
          default_result: string | null
          description: string | null
          hospital_name: string | null
          icd_10_code: string | null
          id: string
          interface_code: string | null
          is_active: boolean | null
          is_header: boolean | null
          loinc_code: string | null
          machine_name: string | null
          map_test_to_service: string | null
          NABH_rates_in_rupee: string | null
          name: string
          "Non-NABH_rates_in_rupee": string | null
          note_opinion_display_text: string | null
          note_opinion_template: string | null
          parameter_panel_test: string | null
          preparation_time: string | null
          private: number | null
          rsby_code: string | null
          sample_type: string | null
          service_group: string | null
          set_as_default: boolean | null
          short_form: string | null
          speciality: string | null
          specific_instruction_for_preparation: string | null
          sub_specialty: string | null
          tariff_list_id: number | null
          tariff_list_name: string | null
          test_method: string | null
          test_order: string | null
          test_result_help: string | null
          title_machine_name: string | null
          updated_at: string
        }
        Insert: {
          attach_file?: boolean | null
          attributes?: Json | null
          bhopal_nabh_rate?: number | null
          bhopal_non_nabh_rate?: number | null
          category?: string | null
          CGHS_code?: string | null
          cpt_code?: string | null
          created_at?: string
          default_result?: string | null
          description?: string | null
          hospital_name?: string | null
          icd_10_code?: string | null
          id?: string
          interface_code?: string | null
          is_active?: boolean | null
          is_header?: boolean | null
          loinc_code?: string | null
          machine_name?: string | null
          map_test_to_service?: string | null
          NABH_rates_in_rupee?: string | null
          name: string
          "Non-NABH_rates_in_rupee"?: string | null
          note_opinion_display_text?: string | null
          note_opinion_template?: string | null
          parameter_panel_test?: string | null
          preparation_time?: string | null
          private?: number | null
          rsby_code?: string | null
          sample_type?: string | null
          service_group?: string | null
          set_as_default?: boolean | null
          short_form?: string | null
          speciality?: string | null
          specific_instruction_for_preparation?: string | null
          sub_specialty?: string | null
          tariff_list_id?: number | null
          tariff_list_name?: string | null
          test_method?: string | null
          test_order?: string | null
          test_result_help?: string | null
          title_machine_name?: string | null
          updated_at?: string
        }
        Update: {
          attach_file?: boolean | null
          attributes?: Json | null
          bhopal_nabh_rate?: number | null
          bhopal_non_nabh_rate?: number | null
          category?: string | null
          CGHS_code?: string | null
          cpt_code?: string | null
          created_at?: string
          default_result?: string | null
          description?: string | null
          hospital_name?: string | null
          icd_10_code?: string | null
          id?: string
          interface_code?: string | null
          is_active?: boolean | null
          is_header?: boolean | null
          loinc_code?: string | null
          machine_name?: string | null
          map_test_to_service?: string | null
          NABH_rates_in_rupee?: string | null
          name?: string
          "Non-NABH_rates_in_rupee"?: string | null
          note_opinion_display_text?: string | null
          note_opinion_template?: string | null
          parameter_panel_test?: string | null
          preparation_time?: string | null
          private?: number | null
          rsby_code?: string | null
          sample_type?: string | null
          service_group?: string | null
          set_as_default?: boolean | null
          short_form?: string | null
          speciality?: string | null
          specific_instruction_for_preparation?: string | null
          sub_specialty?: string | null
          tariff_list_id?: number | null
          tariff_list_name?: string | null
          test_method?: string | null
          test_order?: string | null
          test_result_help?: string | null
          title_machine_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lab_breakup: {
        Row: {
          cghs_total: number | null
          corporate_name: string | null
          created_at: string | null
          created_by: string | null
          hospital_name: string | null
          id: string
          items: Json
          notes: string | null
          patient_name: string | null
          registration_no: string | null
          status: string | null
          total_amount: number | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          cghs_total?: number | null
          corporate_name?: string | null
          created_at?: string | null
          created_by?: string | null
          hospital_name?: string | null
          id?: string
          items?: Json
          notes?: string | null
          patient_name?: string | null
          registration_no?: string | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          cghs_total?: number | null
          corporate_name?: string | null
          created_at?: string | null
          created_by?: string | null
          hospital_name?: string | null
          id?: string
          items?: Json
          notes?: string | null
          patient_name?: string | null
          registration_no?: string | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: []
      }
      lab_departments: {
        Row: {
          created_at: string | null
          department_code: string
          department_name: string
          description: string | null
          email: string | null
          head_of_department: string | null
          id: string
          is_active: boolean | null
          location: string | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department_code: string
          department_name: string
          description?: string | null
          email?: string | null
          head_of_department?: string | null
          id?: string
          is_active?: boolean | null
          location?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department_code?: string
          department_name?: string
          description?: string | null
          email?: string | null
          head_of_department?: string | null
          id?: string
          is_active?: boolean | null
          location?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      lab_equipment: {
        Row: {
          calibration_frequency_days: number | null
          created_at: string | null
          department_id: string | null
          equipment_code: string
          equipment_name: string
          equipment_notes: string | null
          equipment_status: string | null
          id: string
          interface_type: string | null
          is_interfaced: boolean | null
          last_calibration_date: string | null
          last_maintenance_date: string | null
          location: string | null
          maintenance_frequency_days: number | null
          manufacturer: string | null
          model: string | null
          next_calibration_date: string | null
          next_maintenance_date: string | null
          room_number: string | null
          serial_number: string | null
          service_contact: string | null
          service_provider: string | null
          updated_at: string | null
          warranty_expiry_date: string | null
        }
        Insert: {
          calibration_frequency_days?: number | null
          created_at?: string | null
          department_id?: string | null
          equipment_code: string
          equipment_name: string
          equipment_notes?: string | null
          equipment_status?: string | null
          id?: string
          interface_type?: string | null
          is_interfaced?: boolean | null
          last_calibration_date?: string | null
          last_maintenance_date?: string | null
          location?: string | null
          maintenance_frequency_days?: number | null
          manufacturer?: string | null
          model?: string | null
          next_calibration_date?: string | null
          next_maintenance_date?: string | null
          room_number?: string | null
          serial_number?: string | null
          service_contact?: string | null
          service_provider?: string | null
          updated_at?: string | null
          warranty_expiry_date?: string | null
        }
        Update: {
          calibration_frequency_days?: number | null
          created_at?: string | null
          department_id?: string | null
          equipment_code?: string
          equipment_name?: string
          equipment_notes?: string | null
          equipment_status?: string | null
          id?: string
          interface_type?: string | null
          is_interfaced?: boolean | null
          last_calibration_date?: string | null
          last_maintenance_date?: string | null
          location?: string | null
          maintenance_frequency_days?: number | null
          manufacturer?: string | null
          model?: string | null
          next_calibration_date?: string | null
          next_maintenance_date?: string | null
          room_number?: string | null
          serial_number?: string | null
          service_contact?: string | null
          service_provider?: string | null
          updated_at?: string | null
          warranty_expiry_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_equipment_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "lab_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_orders: {
        Row: {
          cancellation_reason: string | null
          clinical_history: string | null
          collected_by: string | null
          collection_date: string | null
          collection_location: string | null
          collection_time: string | null
          created_at: string | null
          created_by: string | null
          discount_amount: number | null
          doctor_id: string | null
          final_amount: number | null
          icd_codes: string[] | null
          id: string
          internal_notes: string | null
          order_date: string | null
          order_number: string
          order_status: string | null
          order_time: string | null
          order_type: string | null
          ordering_doctor: string
          patient_age: number | null
          patient_gender: string | null
          patient_id: string | null
          patient_name: string
          patient_phone: string | null
          payment_method: string | null
          payment_status: string | null
          priority: string | null
          provisional_diagnosis: string | null
          referring_facility: string | null
          report_dispatch_datetime: string | null
          results_ready_datetime: string | null
          sample_collection_datetime: string | null
          sample_received_datetime: string | null
          special_instructions: string | null
          total_amount: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          clinical_history?: string | null
          collected_by?: string | null
          collection_date?: string | null
          collection_location?: string | null
          collection_time?: string | null
          created_at?: string | null
          created_by?: string | null
          discount_amount?: number | null
          doctor_id?: string | null
          final_amount?: number | null
          icd_codes?: string[] | null
          id?: string
          internal_notes?: string | null
          order_date?: string | null
          order_number: string
          order_status?: string | null
          order_time?: string | null
          order_type?: string | null
          ordering_doctor: string
          patient_age?: number | null
          patient_gender?: string | null
          patient_id?: string | null
          patient_name: string
          patient_phone?: string | null
          payment_method?: string | null
          payment_status?: string | null
          priority?: string | null
          provisional_diagnosis?: string | null
          referring_facility?: string | null
          report_dispatch_datetime?: string | null
          results_ready_datetime?: string | null
          sample_collection_datetime?: string | null
          sample_received_datetime?: string | null
          special_instructions?: string | null
          total_amount?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          clinical_history?: string | null
          collected_by?: string | null
          collection_date?: string | null
          collection_location?: string | null
          collection_time?: string | null
          created_at?: string | null
          created_by?: string | null
          discount_amount?: number | null
          doctor_id?: string | null
          final_amount?: number | null
          icd_codes?: string[] | null
          id?: string
          internal_notes?: string | null
          order_date?: string | null
          order_number?: string
          order_status?: string | null
          order_time?: string | null
          order_type?: string | null
          ordering_doctor?: string
          patient_age?: number | null
          patient_gender?: string | null
          patient_id?: string | null
          patient_name?: string
          patient_phone?: string | null
          payment_method?: string | null
          payment_status?: string | null
          priority?: string | null
          provisional_diagnosis?: string | null
          referring_facility?: string | null
          report_dispatch_datetime?: string | null
          results_ready_datetime?: string | null
          sample_collection_datetime?: string | null
          sample_received_datetime?: string | null
          special_instructions?: string | null
          total_amount?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      lab_parameters: {
        Row: {
          by_age_between_num_gret_years: string | null
          by_age_between_num_less_years: string | null
          by_age_between_years: string | null
          by_age_between_years_default_result: string | null
          by_age_between_years_lower_limit: string | null
          by_age_between_years_upper_limit: string | null
          by_age_days_between: string | null
          by_age_days_less: string | null
          by_age_days_less_female: string | null
          by_age_days_more: string | null
          by_age_days_more_female: string | null
          by_age_less_years: string | null
          by_age_less_years_female: string | null
          by_age_more_years: string | null
          by_age_more_years_female: string | null
          by_age_num_gret_years_default_result: string | null
          by_age_num_gret_years_default_result_female: string | null
          by_age_num_gret_years_lower_limit: string | null
          by_age_num_gret_years_lower_limit_female: string | null
          by_age_num_gret_years_upper_limit: string | null
          by_age_num_gret_years_upper_limit_female: string | null
          by_age_num_less_years: string | null
          by_age_num_less_years_default_result: string | null
          by_age_num_less_years_default_result_female: string | null
          by_age_num_less_years_female: string | null
          by_age_num_less_years_lower_limit: string | null
          by_age_num_less_years_lower_limit_female: string | null
          by_age_num_less_years_upper_limit: string | null
          by_age_num_less_years_upper_limit_female: string | null
          by_age_num_more_years: string | null
          by_age_num_more_years_female: string | null
          by_age_sex: string | null
          by_gender_age: string | null
          by_gender_child: string | null
          by_gender_child_default_result: string | null
          by_gender_child_lower_limit: string | null
          by_gender_child_upper_limit: string | null
          by_gender_female: string | null
          by_gender_female_default_result: string | null
          by_gender_female_lower_limit: string | null
          by_gender_female_upper_limit: string | null
          by_gender_male: string | null
          by_gender_male_default_result: string | null
          by_gender_male_lower_limit: string | null
          by_gender_male_upper_limit: string | null
          by_range_between: boolean | null
          by_range_between_interpretation: string | null
          by_range_between_lower_limit: string | null
          by_range_between_upper_limit: string | null
          by_range_greater_than: boolean | null
          by_range_greater_than_interpretation: string | null
          by_range_greater_than_limit: string | null
          by_range_less_than: boolean | null
          by_range_less_than_interpretation: string | null
          by_range_less_than_limit: string | null
          by_range_positive_negative: string | null
          create_time: string
          created_by: number
          culture_group_id: string
          decimal: number | null
          formula: string | null
          formula_text: string | null
          id: number
          interface_code: string | null
          is_descriptive: boolean | null
          is_formula: boolean | null
          is_mandatory: boolean | null
          is_multiple_options: boolean
          lab_id: string
          laboratory_categories_id: number | null
          location_id: number
          modified_by: number
          modify_time: string
          multiply_by: number | null
          name: string
          parameter_text: string | null
          sort_attribute: number | null
          sort_category: number | null
          type: string
          unit: string
          unit_txt: string | null
        }
        Insert: {
          by_age_between_num_gret_years?: string | null
          by_age_between_num_less_years?: string | null
          by_age_between_years?: string | null
          by_age_between_years_default_result?: string | null
          by_age_between_years_lower_limit?: string | null
          by_age_between_years_upper_limit?: string | null
          by_age_days_between?: string | null
          by_age_days_less?: string | null
          by_age_days_less_female?: string | null
          by_age_days_more?: string | null
          by_age_days_more_female?: string | null
          by_age_less_years?: string | null
          by_age_less_years_female?: string | null
          by_age_more_years?: string | null
          by_age_more_years_female?: string | null
          by_age_num_gret_years_default_result?: string | null
          by_age_num_gret_years_default_result_female?: string | null
          by_age_num_gret_years_lower_limit?: string | null
          by_age_num_gret_years_lower_limit_female?: string | null
          by_age_num_gret_years_upper_limit?: string | null
          by_age_num_gret_years_upper_limit_female?: string | null
          by_age_num_less_years?: string | null
          by_age_num_less_years_default_result?: string | null
          by_age_num_less_years_default_result_female?: string | null
          by_age_num_less_years_female?: string | null
          by_age_num_less_years_lower_limit?: string | null
          by_age_num_less_years_lower_limit_female?: string | null
          by_age_num_less_years_upper_limit?: string | null
          by_age_num_less_years_upper_limit_female?: string | null
          by_age_num_more_years?: string | null
          by_age_num_more_years_female?: string | null
          by_age_sex?: string | null
          by_gender_age?: string | null
          by_gender_child?: string | null
          by_gender_child_default_result?: string | null
          by_gender_child_lower_limit?: string | null
          by_gender_child_upper_limit?: string | null
          by_gender_female?: string | null
          by_gender_female_default_result?: string | null
          by_gender_female_lower_limit?: string | null
          by_gender_female_upper_limit?: string | null
          by_gender_male?: string | null
          by_gender_male_default_result?: string | null
          by_gender_male_lower_limit?: string | null
          by_gender_male_upper_limit?: string | null
          by_range_between?: boolean | null
          by_range_between_interpretation?: string | null
          by_range_between_lower_limit?: string | null
          by_range_between_upper_limit?: string | null
          by_range_greater_than?: boolean | null
          by_range_greater_than_interpretation?: string | null
          by_range_greater_than_limit?: string | null
          by_range_less_than?: boolean | null
          by_range_less_than_interpretation?: string | null
          by_range_less_than_limit?: string | null
          by_range_positive_negative?: string | null
          create_time?: string
          created_by?: number
          culture_group_id?: string
          decimal?: number | null
          formula?: string | null
          formula_text?: string | null
          id?: number
          interface_code?: string | null
          is_descriptive?: boolean | null
          is_formula?: boolean | null
          is_mandatory?: boolean | null
          is_multiple_options?: boolean
          lab_id: string
          laboratory_categories_id?: number | null
          location_id?: number
          modified_by?: number
          modify_time?: string
          multiply_by?: number | null
          name: string
          parameter_text?: string | null
          sort_attribute?: number | null
          sort_category?: number | null
          type?: string
          unit: string
          unit_txt?: string | null
        }
        Update: {
          by_age_between_num_gret_years?: string | null
          by_age_between_num_less_years?: string | null
          by_age_between_years?: string | null
          by_age_between_years_default_result?: string | null
          by_age_between_years_lower_limit?: string | null
          by_age_between_years_upper_limit?: string | null
          by_age_days_between?: string | null
          by_age_days_less?: string | null
          by_age_days_less_female?: string | null
          by_age_days_more?: string | null
          by_age_days_more_female?: string | null
          by_age_less_years?: string | null
          by_age_less_years_female?: string | null
          by_age_more_years?: string | null
          by_age_more_years_female?: string | null
          by_age_num_gret_years_default_result?: string | null
          by_age_num_gret_years_default_result_female?: string | null
          by_age_num_gret_years_lower_limit?: string | null
          by_age_num_gret_years_lower_limit_female?: string | null
          by_age_num_gret_years_upper_limit?: string | null
          by_age_num_gret_years_upper_limit_female?: string | null
          by_age_num_less_years?: string | null
          by_age_num_less_years_default_result?: string | null
          by_age_num_less_years_default_result_female?: string | null
          by_age_num_less_years_female?: string | null
          by_age_num_less_years_lower_limit?: string | null
          by_age_num_less_years_lower_limit_female?: string | null
          by_age_num_less_years_upper_limit?: string | null
          by_age_num_less_years_upper_limit_female?: string | null
          by_age_num_more_years?: string | null
          by_age_num_more_years_female?: string | null
          by_age_sex?: string | null
          by_gender_age?: string | null
          by_gender_child?: string | null
          by_gender_child_default_result?: string | null
          by_gender_child_lower_limit?: string | null
          by_gender_child_upper_limit?: string | null
          by_gender_female?: string | null
          by_gender_female_default_result?: string | null
          by_gender_female_lower_limit?: string | null
          by_gender_female_upper_limit?: string | null
          by_gender_male?: string | null
          by_gender_male_default_result?: string | null
          by_gender_male_lower_limit?: string | null
          by_gender_male_upper_limit?: string | null
          by_range_between?: boolean | null
          by_range_between_interpretation?: string | null
          by_range_between_lower_limit?: string | null
          by_range_between_upper_limit?: string | null
          by_range_greater_than?: boolean | null
          by_range_greater_than_interpretation?: string | null
          by_range_greater_than_limit?: string | null
          by_range_less_than?: boolean | null
          by_range_less_than_interpretation?: string | null
          by_range_less_than_limit?: string | null
          by_range_positive_negative?: string | null
          create_time?: string
          created_by?: number
          culture_group_id?: string
          decimal?: number | null
          formula?: string | null
          formula_text?: string | null
          id?: number
          interface_code?: string | null
          is_descriptive?: boolean | null
          is_formula?: boolean | null
          is_mandatory?: boolean | null
          is_multiple_options?: boolean
          lab_id?: string
          laboratory_categories_id?: number | null
          location_id?: number
          modified_by?: number
          modify_time?: string
          multiply_by?: number | null
          name?: string
          parameter_text?: string | null
          sort_attribute?: number | null
          sort_category?: number | null
          type?: string
          unit?: string
          unit_txt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_parameters_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "lab"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_reports: {
        Row: {
          approved_by: string | null
          approved_datetime: string | null
          created_at: string | null
          delivered_to: string | null
          delivery_method: string | null
          delivery_status: string | null
          dispatch_datetime: string | null
          id: string
          interpretation: string | null
          order_id: string | null
          pathologist: string | null
          prepared_by: string | null
          prepared_datetime: string | null
          recommendations: string | null
          report_content: string | null
          report_number: string
          report_status: string | null
          report_template: string | null
          report_type: string | null
          reviewed_by: string | null
          reviewed_datetime: string | null
          updated_at: string | null
        }
        Insert: {
          approved_by?: string | null
          approved_datetime?: string | null
          created_at?: string | null
          delivered_to?: string | null
          delivery_method?: string | null
          delivery_status?: string | null
          dispatch_datetime?: string | null
          id?: string
          interpretation?: string | null
          order_id?: string | null
          pathologist?: string | null
          prepared_by?: string | null
          prepared_datetime?: string | null
          recommendations?: string | null
          report_content?: string | null
          report_number: string
          report_status?: string | null
          report_template?: string | null
          report_type?: string | null
          reviewed_by?: string | null
          reviewed_datetime?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_by?: string | null
          approved_datetime?: string | null
          created_at?: string | null
          delivered_to?: string | null
          delivery_method?: string | null
          delivery_status?: string | null
          dispatch_datetime?: string | null
          id?: string
          interpretation?: string | null
          order_id?: string | null
          pathologist?: string | null
          prepared_by?: string | null
          prepared_datetime?: string | null
          recommendations?: string | null
          report_content?: string | null
          report_number?: string
          report_status?: string | null
          report_template?: string | null
          report_type?: string | null
          reviewed_by?: string | null
          reviewed_datetime?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_reports_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_results: {
        Row: {
          authenticated_result: boolean | null
          comments: string | null
          created_at: string | null
          display_order: number | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          file_url: string | null
          id: string
          is_abnormal: boolean | null
          lab_id: string | null
          main_test_name: string | null
          parent_test_id: string | null
          pathologist_name: string | null
          patient_age: number | null
          patient_gender: string | null
          patient_name: string | null
          reference_range: string | null
          result_status: string | null
          result_unit: string | null
          result_value: string | null
          sub_test_config: Json | null
          technician_name: string | null
          test_category: string | null
          test_level: number
          test_name: string
          updated_at: string | null
          visit_id: string | null
          visit_lab_id: string | null
        }
        Insert: {
          authenticated_result?: boolean | null
          comments?: string | null
          created_at?: string | null
          display_order?: number | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_abnormal?: boolean | null
          lab_id?: string | null
          main_test_name?: string | null
          parent_test_id?: string | null
          pathologist_name?: string | null
          patient_age?: number | null
          patient_gender?: string | null
          patient_name?: string | null
          reference_range?: string | null
          result_status?: string | null
          result_unit?: string | null
          result_value?: string | null
          sub_test_config?: Json | null
          technician_name?: string | null
          test_category?: string | null
          test_level?: number
          test_name: string
          updated_at?: string | null
          visit_id?: string | null
          visit_lab_id?: string | null
        }
        Update: {
          authenticated_result?: boolean | null
          comments?: string | null
          created_at?: string | null
          display_order?: number | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_abnormal?: boolean | null
          lab_id?: string | null
          main_test_name?: string | null
          parent_test_id?: string | null
          pathologist_name?: string | null
          patient_age?: number | null
          patient_gender?: string | null
          patient_name?: string | null
          reference_range?: string | null
          result_status?: string | null
          result_unit?: string | null
          result_value?: string | null
          sub_test_config?: Json | null
          technician_name?: string | null
          test_category?: string | null
          test_level?: number
          test_name?: string
          updated_at?: string | null
          visit_id?: string | null
          visit_lab_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_results_parent_test_id_fkey"
            columns: ["parent_test_id"]
            isOneToOne: false
            referencedRelation: "lab_results"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_samples: {
        Row: {
          aliquot_number: number | null
          collected_by: string | null
          collection_datetime: string | null
          collection_location: string | null
          collection_method: string | null
          container_type: string | null
          created_at: string | null
          id: string
          is_aliquot: boolean | null
          number_of_containers: number | null
          order_id: string | null
          parent_sample_id: string | null
          processing_status: string | null
          quality_notes: string | null
          received_by: string | null
          received_datetime: string | null
          rejection_reason: string | null
          sample_barcode: string
          sample_quality: string | null
          sample_type: string
          storage_conditions: string | null
          storage_location: string | null
          storage_temperature: number | null
          temperature_at_receipt: number | null
          updated_at: string | null
          volume_collected: string | null
        }
        Insert: {
          aliquot_number?: number | null
          collected_by?: string | null
          collection_datetime?: string | null
          collection_location?: string | null
          collection_method?: string | null
          container_type?: string | null
          created_at?: string | null
          id?: string
          is_aliquot?: boolean | null
          number_of_containers?: number | null
          order_id?: string | null
          parent_sample_id?: string | null
          processing_status?: string | null
          quality_notes?: string | null
          received_by?: string | null
          received_datetime?: string | null
          rejection_reason?: string | null
          sample_barcode: string
          sample_quality?: string | null
          sample_type: string
          storage_conditions?: string | null
          storage_location?: string | null
          storage_temperature?: number | null
          temperature_at_receipt?: number | null
          updated_at?: string | null
          volume_collected?: string | null
        }
        Update: {
          aliquot_number?: number | null
          collected_by?: string | null
          collection_datetime?: string | null
          collection_location?: string | null
          collection_method?: string | null
          container_type?: string | null
          created_at?: string | null
          id?: string
          is_aliquot?: boolean | null
          number_of_containers?: number | null
          order_id?: string | null
          parent_sample_id?: string | null
          processing_status?: string | null
          quality_notes?: string | null
          received_by?: string | null
          received_datetime?: string | null
          rejection_reason?: string | null
          sample_barcode?: string
          sample_quality?: string | null
          sample_type?: string
          storage_conditions?: string | null
          storage_location?: string | null
          storage_temperature?: number | null
          temperature_at_receipt?: number | null
          updated_at?: string | null
          volume_collected?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_samples_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_samples_parent_sample_id_fkey"
            columns: ["parent_sample_id"]
            isOneToOne: false
            referencedRelation: "lab_samples"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_sub_speciality: {
        Row: {
          id: string
          modality: string | null
          name: string | null
          remark: string | null
          sub_code: string | null
        }
        Insert: {
          id?: string
          modality?: string | null
          name?: string | null
          remark?: string | null
          sub_code?: string | null
        }
        Update: {
          id?: string
          modality?: string | null
          name?: string | null
          remark?: string | null
          sub_code?: string | null
        }
        Relationships: []
      }
      lab_subspeciality: {
        Row: {
          id: string
          modality: string | null
          name: string
          remark: string | null
          sub_speciality_code: string | null
        }
        Insert: {
          id?: string
          modality?: string | null
          name: string
          remark?: string | null
          sub_speciality_code?: string | null
        }
        Update: {
          id?: string
          modality?: string | null
          name?: string
          remark?: string | null
          sub_speciality_code?: string | null
        }
        Relationships: []
      }
      lab_test_config: {
        Row: {
          age_description: string | null
          age_ranges: Json | null
          age_unit: string
          created_at: string
          display_order: number
          gender: string
          id: string
          is_active: boolean
          is_mandatory: boolean
          lab_id: string
          max_age: number
          max_value: string | null
          min_age: number
          min_value: string | null
          nested_sub_tests: Json | null
          normal_ranges: Json | null
          normal_unit: string | null
          sub_test_name: string
          test_level: number
          test_name: string
          test_type: string
          text_value: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          age_description?: string | null
          age_ranges?: Json | null
          age_unit?: string
          created_at?: string
          display_order?: number
          gender?: string
          id?: string
          is_active?: boolean
          is_mandatory?: boolean
          lab_id: string
          max_age: number
          max_value?: string | null
          min_age: number
          min_value?: string | null
          nested_sub_tests?: Json | null
          normal_ranges?: Json | null
          normal_unit?: string | null
          sub_test_name: string
          test_level?: number
          test_name: string
          test_type?: string
          text_value?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          age_description?: string | null
          age_ranges?: Json | null
          age_unit?: string
          created_at?: string
          display_order?: number
          gender?: string
          id?: string
          is_active?: boolean
          is_mandatory?: boolean
          lab_id?: string
          max_age?: number
          max_value?: string | null
          min_age?: number
          min_value?: string | null
          nested_sub_tests?: Json | null
          normal_ranges?: Json | null
          normal_unit?: string | null
          sub_test_name?: string
          test_level?: number
          test_name?: string
          test_type?: string
          text_value?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_lab"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "lab"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_test_formulas: {
        Row: {
          created_at: string | null
          formula: string | null
          id: string
          is_active: boolean | null
          lab_id: string
          sub_test_name: string
          test_name: string
          test_type: string | null
          text_value: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          formula?: string | null
          id?: string
          is_active?: boolean | null
          lab_id: string
          sub_test_name: string
          test_name: string
          test_type?: string | null
          text_value?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          formula?: string | null
          id?: string
          is_active?: boolean | null
          lab_id?: string
          sub_test_name?: string
          test_name?: string
          test_type?: string | null
          text_value?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      lab_worklists: {
        Row: {
          assigned_technician: string | null
          completed_samples: number | null
          created_at: string | null
          department_id: string | null
          end_time: string | null
          equipment_id: string | null
          id: string
          pending_samples: number | null
          shift: string | null
          start_time: string | null
          supervisor: string | null
          total_samples: number | null
          updated_at: string | null
          worklist_date: string | null
          worklist_name: string
          worklist_status: string | null
          worklist_type: string | null
        }
        Insert: {
          assigned_technician?: string | null
          completed_samples?: number | null
          created_at?: string | null
          department_id?: string | null
          end_time?: string | null
          equipment_id?: string | null
          id?: string
          pending_samples?: number | null
          shift?: string | null
          start_time?: string | null
          supervisor?: string | null
          total_samples?: number | null
          updated_at?: string | null
          worklist_date?: string | null
          worklist_name: string
          worklist_status?: string | null
          worklist_type?: string | null
        }
        Update: {
          assigned_technician?: string | null
          completed_samples?: number | null
          created_at?: string | null
          department_id?: string | null
          end_time?: string | null
          equipment_id?: string | null
          id?: string
          pending_samples?: number | null
          shift?: string | null
          start_time?: string | null
          supervisor?: string | null
          total_samples?: number | null
          updated_at?: string | null
          worklist_date?: string | null
          worklist_name?: string
          worklist_status?: string | null
          worklist_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_worklists_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "lab_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_worklists_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "lab_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_groups: {
        Row: {
          group_type: string
          id: string
          name: string
          nature: string | null
        }
        Insert: {
          group_type: string
          id?: string
          name: string
          nature?: string | null
        }
        Update: {
          group_type?: string
          id?: string
          name?: string
          nature?: string | null
        }
        Relationships: []
      }
      ledgers: {
        Row: {
          account_id: string | null
          account_number: string | null
          alias: string | null
          ask_for_reference_no: boolean | null
          bank_branch: string | null
          bank_name: string | null
          bank_passbook_copy_obtained: boolean | null
          code: string
          created_at: string | null
          current_balance: number | null
          description: string | null
          gl_code: string | null
          gl_format: string | null
          group_id: string | null
          group_name: string | null
          id: string
          ifsc_code: string | null
          is_active: boolean | null
          name: string
          nature: string | null
          neft_authorization_received: boolean | null
          opening_balance: number | null
          pan: string | null
          status: string | null
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          account_id?: string | null
          account_number?: string | null
          alias?: string | null
          ask_for_reference_no?: boolean | null
          bank_branch?: string | null
          bank_name?: string | null
          bank_passbook_copy_obtained?: boolean | null
          code: string
          created_at?: string | null
          current_balance?: number | null
          description?: string | null
          gl_code?: string | null
          gl_format?: string | null
          group_id?: string | null
          group_name?: string | null
          id?: string
          ifsc_code?: string | null
          is_active?: boolean | null
          name: string
          nature?: string | null
          neft_authorization_received?: boolean | null
          opening_balance?: number | null
          pan?: string | null
          status?: string | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          account_id?: string | null
          account_number?: string | null
          alias?: string | null
          ask_for_reference_no?: boolean | null
          bank_branch?: string | null
          bank_name?: string | null
          bank_passbook_copy_obtained?: boolean | null
          code?: string
          created_at?: string | null
          current_balance?: number | null
          description?: string | null
          gl_code?: string | null
          gl_format?: string | null
          group_id?: string | null
          group_name?: string | null
          id?: string
          ifsc_code?: string | null
          is_active?: boolean | null
          name?: string
          nature?: string | null
          neft_authorization_received?: boolean | null
          opening_balance?: number | null
          pan?: string | null
          status?: string | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledgers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ledger_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledgers_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_history: {
        Row: {
          condition_after: number | null
          condition_before: number | null
          cost: number | null
          created_at: string | null
          description: string | null
          documents: string[] | null
          equipment_id: string
          id: string
          labor_hours: number | null
          maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          next_maintenance_due: string | null
          notes: string | null
          parts_cost: number | null
          parts_replaced: string[] | null
          performed_by_technician_id: string | null
          performed_by_vendor_id: string | null
          performed_date: string
          photos: string[] | null
          procedures_performed: string[] | null
          recommendations: string | null
          work_order_id: string | null
        }
        Insert: {
          condition_after?: number | null
          condition_before?: number | null
          cost?: number | null
          created_at?: string | null
          description?: string | null
          documents?: string[] | null
          equipment_id: string
          id?: string
          labor_hours?: number | null
          maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          next_maintenance_due?: string | null
          notes?: string | null
          parts_cost?: number | null
          parts_replaced?: string[] | null
          performed_by_technician_id?: string | null
          performed_by_vendor_id?: string | null
          performed_date: string
          photos?: string[] | null
          procedures_performed?: string[] | null
          recommendations?: string | null
          work_order_id?: string | null
        }
        Update: {
          condition_after?: number | null
          condition_before?: number | null
          cost?: number | null
          created_at?: string | null
          description?: string | null
          documents?: string[] | null
          equipment_id?: string
          id?: string
          labor_hours?: number | null
          maintenance_type?: Database["public"]["Enums"]["maintenance_type"]
          next_maintenance_due?: string | null
          notes?: string | null
          parts_cost?: number | null
          parts_replaced?: string[] | null
          performed_by_technician_id?: string | null
          performed_by_vendor_id?: string | null
          performed_date?: string
          photos?: string[] | null
          procedures_performed?: string[] | null
          recommendations?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_history_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_history_performed_by_technician_id_fkey"
            columns: ["performed_by_technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_history_performed_by_vendor_id_fkey"
            columns: ["performed_by_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_history_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_schedules: {
        Row: {
          checklist_items: string[] | null
          created_at: string | null
          description: string | null
          equipment_id: string
          estimated_duration_hours: number | null
          frequency_days: number
          id: string
          is_active: boolean | null
          maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          required_skills: string[] | null
          safety_requirements: string[] | null
          schedule_name: string | null
          updated_at: string | null
        }
        Insert: {
          checklist_items?: string[] | null
          created_at?: string | null
          description?: string | null
          equipment_id: string
          estimated_duration_hours?: number | null
          frequency_days: number
          id?: string
          is_active?: boolean | null
          maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          required_skills?: string[] | null
          safety_requirements?: string[] | null
          schedule_name?: string | null
          updated_at?: string | null
        }
        Update: {
          checklist_items?: string[] | null
          created_at?: string | null
          description?: string | null
          equipment_id?: string
          estimated_duration_hours?: number | null
          frequency_days?: number
          id?: string
          is_active?: boolean | null
          maintenance_type?: Database["public"]["Enums"]["maintenance_type"]
          required_skills?: string[] | null
          safety_requirements?: string[] | null
          schedule_name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_schedules_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      mandatory_services: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          nabh_bhopal: number | null
          nabh_bhopal_ipd: number | null
          nabh_rate: number | null
          nabh_rate_ipd: number | null
          non_nabh_bhopal: number | null
          non_nabh_bhopal_ipd: number | null
          non_nabh_rate: number | null
          non_nabh_rate_ipd: number | null
          private_rate: number | null
          private_rate_ipd: number | null
          service_name: string
          status: string | null
          tpa_rate: number | null
          tpa_rate_ipd: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          nabh_bhopal?: number | null
          nabh_bhopal_ipd?: number | null
          nabh_rate?: number | null
          nabh_rate_ipd?: number | null
          non_nabh_bhopal?: number | null
          non_nabh_bhopal_ipd?: number | null
          non_nabh_rate?: number | null
          non_nabh_rate_ipd?: number | null
          private_rate?: number | null
          private_rate_ipd?: number | null
          service_name: string
          status?: string | null
          tpa_rate?: number | null
          tpa_rate_ipd?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          nabh_bhopal?: number | null
          nabh_bhopal_ipd?: number | null
          nabh_rate?: number | null
          nabh_rate_ipd?: number | null
          non_nabh_bhopal?: number | null
          non_nabh_bhopal_ipd?: number | null
          non_nabh_rate?: number | null
          non_nabh_rate_ipd?: number | null
          private_rate?: number | null
          private_rate_ipd?: number | null
          service_name?: string
          status?: string | null
          tpa_rate?: number | null
          tpa_rate_ipd?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      manufacturer_companies: {
        Row: {
          address: string | null
          created_at: string | null
          id: number
          name: string
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          id?: number
          name: string
        }
        Update: {
          address?: string | null
          created_at?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
      marketing_camps: {
        Row: {
          actual_cost: number | null
          actual_footfall: number | null
          address: string | null
          budget: number | null
          camp_date: string
          camp_name: string
          camp_notes: string | null
          camp_type: string | null
          created_at: string | null
          description: string | null
          end_time: string | null
          expected_footfall: number | null
          id: string
          image_url: string | null
          latitude: number | null
          location: string
          longitude: number | null
          marketing_user_id: string | null
          patients_screened: number | null
          referrals_generated: number | null
          start_time: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          actual_cost?: number | null
          actual_footfall?: number | null
          address?: string | null
          budget?: number | null
          camp_date: string
          camp_name: string
          camp_notes?: string | null
          camp_type?: string | null
          created_at?: string | null
          description?: string | null
          end_time?: string | null
          expected_footfall?: number | null
          id?: string
          image_url?: string | null
          latitude?: number | null
          location: string
          longitude?: number | null
          marketing_user_id?: string | null
          patients_screened?: number | null
          referrals_generated?: number | null
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_cost?: number | null
          actual_footfall?: number | null
          address?: string | null
          budget?: number | null
          camp_date?: string
          camp_name?: string
          camp_notes?: string | null
          camp_type?: string | null
          created_at?: string | null
          description?: string | null
          end_time?: string | null
          expected_footfall?: number | null
          id?: string
          image_url?: string | null
          latitude?: number | null
          location?: string
          longitude?: number | null
          marketing_user_id?: string | null
          patients_screened?: number | null
          referrals_generated?: number | null
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_camps_marketing_user_id_fkey"
            columns: ["marketing_user_id"]
            isOneToOne: false
            referencedRelation: "marketing_users"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_daily_stats: {
        Row: {
          admissions: number | null
          created_at: string | null
          created_by: string | null
          date: string
          discharges: number | null
          doctors_contacted: number | null
          id: string
          notes: string | null
          occupancy_percent: number | null
          plan_for_today: string | null
          revenue: number | null
        }
        Insert: {
          admissions?: number | null
          created_at?: string | null
          created_by?: string | null
          date?: string
          discharges?: number | null
          doctors_contacted?: number | null
          id?: string
          notes?: string | null
          occupancy_percent?: number | null
          plan_for_today?: string | null
          revenue?: number | null
        }
        Update: {
          admissions?: number | null
          created_at?: string | null
          created_by?: string | null
          date?: string
          discharges?: number | null
          doctors_contacted?: number | null
          id?: string
          notes?: string | null
          occupancy_percent?: number | null
          plan_for_today?: string | null
          revenue?: number | null
        }
        Relationships: []
      }
      marketing_doctors: {
        Row: {
          city: string | null
          contact_number: string | null
          created_at: string | null
          created_by: string | null
          doctor_name: string
          email: string | null
          hospital_clinic_name: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          location_address: string | null
          notes: string | null
          priority: string | null
          specialty: string | null
          updated_at: string | null
          visit_frequency: number | null
        }
        Insert: {
          city?: string | null
          contact_number?: string | null
          created_at?: string | null
          created_by?: string | null
          doctor_name: string
          email?: string | null
          hospital_clinic_name?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          location_address?: string | null
          notes?: string | null
          priority?: string | null
          specialty?: string | null
          updated_at?: string | null
          visit_frequency?: number | null
        }
        Update: {
          city?: string | null
          contact_number?: string | null
          created_at?: string | null
          created_by?: string | null
          doctor_name?: string
          email?: string | null
          hospital_clinic_name?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          location_address?: string | null
          notes?: string | null
          priority?: string | null
          specialty?: string | null
          updated_at?: string | null
          visit_frequency?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_doctors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "marketing_users"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_users: {
        Row: {
          created_at: string | null
          designation: string | null
          email: string | null
          employee_id: string | null
          id: string
          is_active: boolean | null
          joining_date: string | null
          name: string
          notes: string | null
          password: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string | null
          designation?: string | null
          email?: string | null
          employee_id?: string | null
          id?: string
          is_active?: boolean | null
          joining_date?: string | null
          name: string
          notes?: string | null
          password?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string | null
          designation?: string | null
          email?: string | null
          employee_id?: string | null
          id?: string
          is_active?: boolean | null
          joining_date?: string | null
          name?: string
          notes?: string | null
          password?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      marketing_visits: {
        Row: {
          area: string
          comments: string | null
          contact_number: string | null
          created_at: string | null
          disposition: string
          doctor_name: string
          email: string | null
          follow_up_date: string | null
          follow_up_notes: string | null
          hospital_clinic_name: string | null
          id: string
          image_timestamp: string | null
          image_url: string | null
          interaction_type: string
          latitude: number | null
          location_accuracy: number | null
          location_address: string | null
          location_city: string | null
          location_state: string | null
          location_timestamp: string | null
          longitude: number | null
          marketingUser_id: string | null
          specialty: string | null
          sub_disposition: string | null
          visit_date: string
          visit_time: string
        }
        Insert: {
          area: string
          comments?: string | null
          contact_number?: string | null
          created_at?: string | null
          disposition: string
          doctor_name: string
          email?: string | null
          follow_up_date?: string | null
          follow_up_notes?: string | null
          hospital_clinic_name?: string | null
          id?: string
          image_timestamp?: string | null
          image_url?: string | null
          interaction_type: string
          latitude?: number | null
          location_accuracy?: number | null
          location_address?: string | null
          location_city?: string | null
          location_state?: string | null
          location_timestamp?: string | null
          longitude?: number | null
          marketingUser_id?: string | null
          specialty?: string | null
          sub_disposition?: string | null
          visit_date: string
          visit_time: string
        }
        Update: {
          area?: string
          comments?: string | null
          contact_number?: string | null
          created_at?: string | null
          disposition?: string
          doctor_name?: string
          email?: string | null
          follow_up_date?: string | null
          follow_up_notes?: string | null
          hospital_clinic_name?: string | null
          id?: string
          image_timestamp?: string | null
          image_url?: string | null
          interaction_type?: string
          latitude?: number | null
          location_accuracy?: number | null
          location_address?: string | null
          location_city?: string | null
          location_state?: string | null
          location_timestamp?: string | null
          longitude?: number | null
          marketingUser_id?: string | null
          specialty?: string | null
          sub_disposition?: string | null
          visit_date?: string
          visit_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_visits_user_id_fkey"
            columns: ["marketingUser_id"]
            isOneToOne: false
            referencedRelation: "marketing_users"
            referencedColumns: ["id"]
          },
        ]
      }
      master_data: {
        Row: {
          address: string | null
          alternate_mobile: string | null
          city: string | null
          created_at: string | null
          department: string | null
          designation: string | null
          email: string | null
          full_name: string
          hospital: string | null
          id: string
          is_active: boolean | null
          mobile: string | null
          notes: string | null
          person_type: string
          source_id: string | null
          source_table: string | null
          specialization: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          alternate_mobile?: string | null
          city?: string | null
          created_at?: string | null
          department?: string | null
          designation?: string | null
          email?: string | null
          full_name: string
          hospital?: string | null
          id?: string
          is_active?: boolean | null
          mobile?: string | null
          notes?: string | null
          person_type: string
          source_id?: string | null
          source_table?: string | null
          specialization?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          alternate_mobile?: string | null
          city?: string | null
          created_at?: string | null
          department?: string | null
          designation?: string | null
          email?: string | null
          full_name?: string
          hospital?: string | null
          id?: string
          is_active?: boolean | null
          mobile?: string | null
          notes?: string | null
          person_type?: string
          source_id?: string | null
          source_table?: string | null
          specialization?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      medical_procedures: {
        Row: {
          category: Database["public"]["Enums"]["procedure_category"] | null
          id: number
          nabh: string | null
          private_MOA: string | null
          procedure_name: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["procedure_category"] | null
          id?: number
          nabh?: string | null
          private_MOA?: string | null
          procedure_name: string
        }
        Update: {
          category?: Database["public"]["Enums"]["procedure_category"] | null
          id?: number
          nabh?: string | null
          private_MOA?: string | null
          procedure_name?: string
        }
        Relationships: []
      }
      medicalprocedures: {
        Row: {
          code1: string | null
          code2: string | null
          id: number
          procedurename: string
        }
        Insert: {
          code1?: string | null
          code2?: string | null
          id?: never
          procedurename: string
        }
        Update: {
          code1?: string | null
          code2?: string | null
          id?: never
          procedurename?: string
        }
        Relationships: []
      }
      medication: {
        Row: {
          barcode: string | null
          brand_name: string[] | null
          category: string | null
          created_at: string
          description: string | null
          dosage: string | null
          drug_id: string | null
          druginfo: string | null
          exp_date: string | null
          Exp_date: string | null
          generic: string | null
          generic_name: string | null
          id: string
          is_deleted: boolean | null
          is_implant: boolean | null
          item_code: string | null
          item_type: number | null
          loose_stock: number | null
          loose_stock_quantity: number | null
          manufacturer: string | null
          manufacturer_id: string | null
          medicine_code: string | null
          name: string
          pack: string | null
          price_per_strip: string | null
          product_name: string | null
          shelf: string | null
          stock: string | null
          strength: string | null
          supplier_id: string | null
          supplier_name: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          brand_name?: string[] | null
          category?: string | null
          created_at?: string
          description?: string | null
          dosage?: string | null
          drug_id?: string | null
          druginfo?: string | null
          exp_date?: string | null
          Exp_date?: string | null
          generic?: string | null
          generic_name?: string | null
          id?: string
          is_deleted?: boolean | null
          is_implant?: boolean | null
          item_code?: string | null
          item_type?: number | null
          loose_stock?: number | null
          loose_stock_quantity?: number | null
          manufacturer?: string | null
          manufacturer_id?: string | null
          medicine_code?: string | null
          name: string
          pack?: string | null
          price_per_strip?: string | null
          product_name?: string | null
          shelf?: string | null
          stock?: string | null
          strength?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          brand_name?: string[] | null
          category?: string | null
          created_at?: string
          description?: string | null
          dosage?: string | null
          drug_id?: string | null
          druginfo?: string | null
          exp_date?: string | null
          Exp_date?: string | null
          generic?: string | null
          generic_name?: string | null
          id?: string
          is_deleted?: boolean | null
          is_implant?: boolean | null
          item_code?: string | null
          item_type?: number | null
          loose_stock?: number | null
          loose_stock_quantity?: number | null
          manufacturer?: string | null
          manufacturer_id?: string | null
          medicine_code?: string | null
          name?: string
          pack?: string | null
          price_per_strip?: string | null
          product_name?: string | null
          shelf?: string | null
          stock?: string | null
          strength?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      medication_administration: {
        Row: {
          administered_at: string | null
          administered_by: string | null
          created_at: string | null
          dose: string | null
          frequency: string | null
          id: string
          medication_name: string
          missed_reason: string | null
          notes: string | null
          patient_id: string | null
          prescription_item_id: string | null
          route: string | null
          scheduled_time: string | null
          status: string | null
          visit_id: string | null
        }
        Insert: {
          administered_at?: string | null
          administered_by?: string | null
          created_at?: string | null
          dose?: string | null
          frequency?: string | null
          id?: string
          medication_name: string
          missed_reason?: string | null
          notes?: string | null
          patient_id?: string | null
          prescription_item_id?: string | null
          route?: string | null
          scheduled_time?: string | null
          status?: string | null
          visit_id?: string | null
        }
        Update: {
          administered_at?: string | null
          administered_by?: string | null
          created_at?: string | null
          dose?: string | null
          frequency?: string | null
          id?: string
          medication_name?: string
          missed_reason?: string | null
          notes?: string | null
          patient_id?: string | null
          prescription_item_id?: string | null
          route?: string | null
          scheduled_time?: string | null
          status?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medication_administration_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_administration_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "medication_administration_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      medications: {
        Row: {
          brand_name: string | null
          category: string | null
          cost: number | null
          created_at: string | null
          description: string | null
          generic_name: string | null
          id: string
          is_active: boolean | null
          manufacturer: string | null
          name: string
          requires_prescription: boolean | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          brand_name?: string | null
          category?: string | null
          cost?: number | null
          created_at?: string | null
          description?: string | null
          generic_name?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          name: string
          requires_prescription?: boolean | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          brand_name?: string | null
          category?: string | null
          cost?: number | null
          created_at?: string | null
          description?: string | null
          generic_name?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          name?: string
          requires_prescription?: boolean | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      medicine_batch_inventory: {
        Row: {
          adjustment_quantity: number | null
          batch_number: string
          cgst: number | null
          created_at: string | null
          created_by: string | null
          current_stock: number
          expiry_date: string
          free_quantity: number
          grn_date: string | null
          grn_number: string | null
          gst: number | null
          gst_amount: number | null
          hospital_name: string | null
          id: string
          is_active: boolean | null
          is_expired: boolean | null
          manufacturing_date: string | null
          medicine_id: string | null
          mrp: number | null
          pieces_per_pack: number | null
          purchase_order_id: string | null
          purchase_price: number | null
          rack_number: string | null
          received_quantity: number
          reserved_stock: number
          selling_price: number | null
          sgst: number | null
          shelf_location: string | null
          sold_quantity: number
          supplier_id: number | null
          updated_at: string | null
        }
        Insert: {
          adjustment_quantity?: number | null
          batch_number: string
          cgst?: number | null
          created_at?: string | null
          created_by?: string | null
          current_stock?: number
          expiry_date: string
          free_quantity?: number
          grn_date?: string | null
          grn_number?: string | null
          gst?: number | null
          gst_amount?: number | null
          hospital_name?: string | null
          id?: string
          is_active?: boolean | null
          is_expired?: boolean | null
          manufacturing_date?: string | null
          medicine_id?: string | null
          mrp?: number | null
          pieces_per_pack?: number | null
          purchase_order_id?: string | null
          purchase_price?: number | null
          rack_number?: string | null
          received_quantity?: number
          reserved_stock?: number
          selling_price?: number | null
          sgst?: number | null
          shelf_location?: string | null
          sold_quantity?: number
          supplier_id?: number | null
          updated_at?: string | null
        }
        Update: {
          adjustment_quantity?: number | null
          batch_number?: string
          cgst?: number | null
          created_at?: string | null
          created_by?: string | null
          current_stock?: number
          expiry_date?: string
          free_quantity?: number
          grn_date?: string | null
          grn_number?: string | null
          gst?: number | null
          gst_amount?: number | null
          hospital_name?: string | null
          id?: string
          is_active?: boolean | null
          is_expired?: boolean | null
          manufacturing_date?: string | null
          medicine_id?: string | null
          mrp?: number | null
          pieces_per_pack?: number | null
          purchase_order_id?: string | null
          purchase_price?: number | null
          rack_number?: string | null
          received_quantity?: number
          reserved_stock?: number
          selling_price?: number | null
          sgst?: number | null
          shelf_location?: string | null
          sold_quantity?: number
          supplier_id?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicine_batch_inventory_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_batch_inventory_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      medicine_inventory: {
        Row: {
          batch_number: string | null
          created_at: string | null
          expiry_date: string | null
          hospital_name: string | null
          id: string
          medicine_id: string
          quantity_in_stock: number | null
          updated_at: string | null
        }
        Insert: {
          batch_number?: string | null
          created_at?: string | null
          expiry_date?: string | null
          hospital_name?: string | null
          id?: string
          medicine_id: string
          quantity_in_stock?: number | null
          updated_at?: string | null
        }
        Update: {
          batch_number?: string | null
          created_at?: string | null
          expiry_date?: string | null
          hospital_name?: string | null
          id?: string
          medicine_id?: string
          quantity_in_stock?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      medicine_master: {
        Row: {
          created_at: string | null
          generic_name: string | null
          hospital_name: string | null
          id: string
          is_deleted: boolean | null
          loose_stock_quantity: number | null
          manufacturer_id: number | null
          maximum_stock: number | null
          medicine_name: string
          minimum_stock: number | null
          pack_size: number | null
          reorder_level: number | null
          shelf_location: string | null
          stock: number | null
          supplier_id: number | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          generic_name?: string | null
          hospital_name?: string | null
          id?: string
          is_deleted?: boolean | null
          loose_stock_quantity?: number | null
          manufacturer_id?: number | null
          maximum_stock?: number | null
          medicine_name: string
          minimum_stock?: number | null
          pack_size?: number | null
          reorder_level?: number | null
          shelf_location?: string | null
          stock?: number | null
          supplier_id?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          generic_name?: string | null
          hospital_name?: string | null
          id?: string
          is_deleted?: boolean | null
          loose_stock_quantity?: number | null
          manufacturer_id?: number | null
          maximum_stock?: number | null
          medicine_name?: string
          minimum_stock?: number | null
          pack_size?: number | null
          reorder_level?: number | null
          shelf_location?: string | null
          stock?: number | null
          supplier_id?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_medicine_master_supplier"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_master_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      medicine_return_items: {
        Row: {
          batch_number: string | null
          can_restock: boolean | null
          created_at: string | null
          expiry_date: string | null
          id: string
          medicine_condition: string | null
          medicine_id: string | null
          original_sale_item_id: number | null
          quantity_returned: number
          refund_amount: number
          return_id: string | null
          unit_price: number
        }
        Insert: {
          batch_number?: string | null
          can_restock?: boolean | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          medicine_condition?: string | null
          medicine_id?: string | null
          original_sale_item_id?: number | null
          quantity_returned: number
          refund_amount: number
          return_id?: string | null
          unit_price: number
        }
        Update: {
          batch_number?: string | null
          can_restock?: boolean | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          medicine_condition?: string | null
          medicine_id?: string | null
          original_sale_item_id?: number | null
          quantity_returned?: number
          refund_amount?: number
          return_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "medicine_return_items_original_sale_item_id_fkey"
            columns: ["original_sale_item_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_sale_items"
            referencedColumns: ["sale_item_id"]
          },
          {
            foreignKeyName: "medicine_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "medicine_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      medicine_returns: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          hospital_name: string | null
          id: string
          is_hidden: boolean | null
          net_refund: number | null
          notes: string | null
          original_sale_id: number | null
          patient_id: string | null
          processed_at: string | null
          processed_by: string | null
          processing_fee: number | null
          refund_amount: number | null
          refund_method: string | null
          return_date: string | null
          return_number: string
          return_reason: string
          return_type: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          hospital_name?: string | null
          id?: string
          is_hidden?: boolean | null
          net_refund?: number | null
          notes?: string | null
          original_sale_id?: number | null
          patient_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          processing_fee?: number | null
          refund_amount?: number | null
          refund_method?: string | null
          return_date?: string | null
          return_number: string
          return_reason: string
          return_type?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          hospital_name?: string | null
          id?: string
          is_hidden?: boolean | null
          net_refund?: number | null
          notes?: string | null
          original_sale_id?: number | null
          patient_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          processing_fee?: number | null
          refund_amount?: number | null
          refund_method?: string | null
          return_date?: string | null
          return_number?: string
          return_reason?: string
          return_type?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicine_returns_original_sale_id_fkey"
            columns: ["original_sale_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_sales"
            referencedColumns: ["sale_id"]
          },
        ]
      }
      medicine_sale_items: {
        Row: {
          batch_number: string | null
          created_at: string | null
          discount_amount: number | null
          discount_percentage: number | null
          expiry_date: string | null
          id: string
          inventory_id: string | null
          medicine_id: string | null
          quantity_sold: number
          sale_id: string | null
          tax_amount: number | null
          tax_percentage: number | null
          total_amount: number
          unit_price: number
        }
        Insert: {
          batch_number?: string | null
          created_at?: string | null
          discount_amount?: number | null
          discount_percentage?: number | null
          expiry_date?: string | null
          id?: string
          inventory_id?: string | null
          medicine_id?: string | null
          quantity_sold: number
          sale_id?: string | null
          tax_amount?: number | null
          tax_percentage?: number | null
          total_amount: number
          unit_price: number
        }
        Update: {
          batch_number?: string | null
          created_at?: string | null
          discount_amount?: number | null
          discount_percentage?: number | null
          expiry_date?: string | null
          id?: string
          inventory_id?: string | null
          medicine_id?: string | null
          quantity_sold?: number
          sale_id?: string | null
          tax_amount?: number | null
          tax_percentage?: number | null
          total_amount?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "medicine_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "medicine_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      medicine_sales: {
        Row: {
          balance_amount: number | null
          bill_number: string
          cashier_id: string | null
          created_at: string | null
          discount_amount: number | null
          id: string
          insurance_claim_number: string | null
          notes: string | null
          paid_amount: number | null
          patient_id: string | null
          payment_method: string | null
          payment_reference: string | null
          pharmacist_id: string | null
          prescription_id: string | null
          sale_date: string | null
          sale_type: string | null
          status: string | null
          subtotal: number
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          balance_amount?: number | null
          bill_number: string
          cashier_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          insurance_claim_number?: string | null
          notes?: string | null
          paid_amount?: number | null
          patient_id?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          pharmacist_id?: string | null
          prescription_id?: string | null
          sale_date?: string | null
          sale_type?: string | null
          status?: string | null
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
        }
        Update: {
          balance_amount?: number | null
          bill_number?: string
          cashier_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          insurance_claim_number?: string | null
          notes?: string | null
          paid_amount?: number | null
          patient_id?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          pharmacist_id?: string | null
          prescription_id?: string | null
          sale_date?: string | null
          sale_type?: string | null
          status?: string | null
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicine_sales_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_sales_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "medicine_sales_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      nabh_rates: {
        Row: {
          category: string | null
          code: string
          created_at: string
          id: string
          item_name: string
          rate: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          id?: string
          item_name: string
          rate: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          item_name?: string
          rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      nursing_care_plan: {
        Row: {
          assessment: Json | null
          care_tasks: Json | null
          created_at: string | null
          handover_notes: string | null
          id: string
          nurse_name: string | null
          patient_id: string | null
          shift: string | null
          shift_date: string
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          assessment?: Json | null
          care_tasks?: Json | null
          created_at?: string | null
          handover_notes?: string | null
          id?: string
          nurse_name?: string | null
          patient_id?: string | null
          shift?: string | null
          shift_date: string
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          assessment?: Json | null
          care_tasks?: Json | null
          created_at?: string | null
          handover_notes?: string | null
          id?: string
          nurse_name?: string | null
          patient_id?: string | null
          shift?: string | null
          shift_date?: string
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nursing_care_plan_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nursing_care_plan_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "nursing_care_plan_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      obligation_default_payees: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          obligation_id: string
          payee_name: string
        }
        Insert: {
          amount?: number
          created_at?: string | null
          id?: string
          obligation_id: string
          payee_name: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          obligation_id?: string
          payee_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "obligation_default_payees_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "payment_obligations"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_theatres: {
        Row: {
          capacity: number
          created_at: string | null
          id: number
          last_cleaned: string | null
          name: string
          next_maintenance: string | null
          specialty_type: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          capacity?: number
          created_at?: string | null
          id?: number
          last_cleaned?: string | null
          name: string
          next_maintenance?: string | null
          specialty_type?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          capacity?: number
          created_at?: string | null
          id?: number
          last_cleaned?: string | null
          name?: string
          next_maintenance?: string | null
          specialty_type?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      order_test_items: {
        Row: {
          analyzer_used: string | null
          assigned_technician: string | null
          container_type: string | null
          created_at: string | null
          id: string
          item_code: string
          item_name: string
          item_status: string | null
          item_type: string
          order_id: string | null
          panel_id: string | null
          processing_end_time: string | null
          processing_start_time: string | null
          quality_notes: string | null
          quantity: number | null
          sample_type: string | null
          sample_volume: string | null
          technician_notes: string | null
          test_id: string | null
          total_price: number | null
          unit_price: number | null
          updated_at: string | null
        }
        Insert: {
          analyzer_used?: string | null
          assigned_technician?: string | null
          container_type?: string | null
          created_at?: string | null
          id?: string
          item_code: string
          item_name: string
          item_status?: string | null
          item_type: string
          order_id?: string | null
          panel_id?: string | null
          processing_end_time?: string | null
          processing_start_time?: string | null
          quality_notes?: string | null
          quantity?: number | null
          sample_type?: string | null
          sample_volume?: string | null
          technician_notes?: string | null
          test_id?: string | null
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string | null
        }
        Update: {
          analyzer_used?: string | null
          assigned_technician?: string | null
          container_type?: string | null
          created_at?: string | null
          id?: string
          item_code?: string
          item_name?: string
          item_status?: string | null
          item_type?: string
          order_id?: string | null
          panel_id?: string | null
          processing_end_time?: string | null
          processing_start_time?: string | null
          quality_notes?: string | null
          quantity?: number | null
          sample_type?: string | null
          sample_volume?: string | null
          technician_notes?: string | null
          test_id?: string | null
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_test_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_test_items_panel_id_fkey"
            columns: ["panel_id"]
            isOneToOne: false
            referencedRelation: "test_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_test_items_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "lab_subspeciality"
            referencedColumns: ["id"]
          },
        ]
      }
      ot_notes: {
        Row: {
          ai_generated: boolean | null
          ai_prompt: string | null
          alias: string | null
          anaesthesia: string | null
          anaesthetist: string | null
          created_at: string | null
          date: string
          description: string | null
          id: string
          implant: string | null
          is_printed: boolean | null
          is_saved: boolean | null
          patient_id: string | null
          patient_name: string | null
          printed_at: string | null
          procedure_performed: string
          saved_at: string | null
          surgeon: string
          surgery_code: string | null
          surgery_name: string | null
          surgery_rate: number | null
          surgery_status: string | null
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          ai_generated?: boolean | null
          ai_prompt?: string | null
          alias?: string | null
          anaesthesia?: string | null
          anaesthetist?: string | null
          created_at?: string | null
          date: string
          description?: string | null
          id?: string
          implant?: string | null
          is_printed?: boolean | null
          is_saved?: boolean | null
          patient_id?: string | null
          patient_name?: string | null
          printed_at?: string | null
          procedure_performed: string
          saved_at?: string | null
          surgeon: string
          surgery_code?: string | null
          surgery_name?: string | null
          surgery_rate?: number | null
          surgery_status?: string | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          ai_generated?: boolean | null
          ai_prompt?: string | null
          alias?: string | null
          anaesthesia?: string | null
          anaesthetist?: string | null
          created_at?: string | null
          date?: string
          description?: string | null
          id?: string
          implant?: string | null
          is_printed?: boolean | null
          is_saved?: boolean | null
          patient_id?: string | null
          patient_name?: string | null
          printed_at?: string | null
          procedure_performed?: string
          saved_at?: string | null
          surgeon?: string
          surgery_code?: string | null
          surgery_name?: string | null
          surgery_rate?: number | null
          surgery_status?: string | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ot_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "ot_notes_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      ot_notes_templates: {
        Row: {
          content: string
          created_at: string | null
          display_order: number | null
          id: string
          is_default: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_default?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_default?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ot_schedule: {
        Row: {
          actual_end_time: string | null
          actual_start_time: string | null
          anesthetist_id: string | null
          anesthetist_name: string | null
          cancelled_reason: string | null
          created_at: string | null
          estimated_duration_min: number | null
          id: string
          notes: string | null
          ot_room: string
          patient_id: string | null
          pre_op_checklist: Json | null
          scheduled_date: string
          scheduled_time: string
          special_requirements: string | null
          status: string | null
          surgeon_id: string | null
          surgeon_name: string | null
          surgery_name: string
          updated_at: string | null
          urgency: string | null
          visit_id: string | null
        }
        Insert: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          anesthetist_id?: string | null
          anesthetist_name?: string | null
          cancelled_reason?: string | null
          created_at?: string | null
          estimated_duration_min?: number | null
          id?: string
          notes?: string | null
          ot_room: string
          patient_id?: string | null
          pre_op_checklist?: Json | null
          scheduled_date: string
          scheduled_time: string
          special_requirements?: string | null
          status?: string | null
          surgeon_id?: string | null
          surgeon_name?: string | null
          surgery_name: string
          updated_at?: string | null
          urgency?: string | null
          visit_id?: string | null
        }
        Update: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          anesthetist_id?: string | null
          anesthetist_name?: string | null
          cancelled_reason?: string | null
          created_at?: string | null
          estimated_duration_min?: number | null
          id?: string
          notes?: string | null
          ot_room?: string
          patient_id?: string | null
          pre_op_checklist?: Json | null
          scheduled_date?: string
          scheduled_time?: string
          special_requirements?: string | null
          status?: string | null
          surgeon_id?: string | null
          surgeon_name?: string | null
          surgery_name?: string
          updated_at?: string | null
          urgency?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ot_schedule_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ot_schedule_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "ot_schedule_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      outstanding_invoices: {
        Row: {
          aging_bucket: string | null
          bill_id: string | null
          created_at: string | null
          days_outstanding: number | null
          due_date: string
          id: string
          invoice_date: string
          invoice_number: string
          original_amount: number
          outstanding_amount: number
          paid_amount: number | null
          patient_id: string | null
          status: string | null
          updated_at: string | null
          voucher_id: string | null
        }
        Insert: {
          aging_bucket?: string | null
          bill_id?: string | null
          created_at?: string | null
          days_outstanding?: number | null
          due_date: string
          id?: string
          invoice_date: string
          invoice_number: string
          original_amount: number
          outstanding_amount: number
          paid_amount?: number | null
          patient_id?: string | null
          status?: string | null
          updated_at?: string | null
          voucher_id?: string | null
        }
        Update: {
          aging_bucket?: string | null
          bill_id?: string | null
          created_at?: string | null
          days_outstanding?: number | null
          due_date?: string
          id?: string
          invoice_date?: string
          invoice_number?: string
          original_amount?: number
          outstanding_amount?: number
          paid_amount?: number | null
          patient_id?: string | null
          status?: string | null
          updated_at?: string | null
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outstanding_invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outstanding_invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "outstanding_invoices_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      pacs_images: {
        Row: {
          body_part: string | null
          capture_source: string | null
          captured_at: string | null
          created_at: string | null
          description: string | null
          file_name: string
          file_path: string
          file_size_kb: number | null
          gps_accuracy: number | null
          gps_captured_at: string | null
          id: string
          image_type: string | null
          latitude: number | null
          longitude: number | null
          mime_type: string | null
          patient_id: string | null
          study_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          body_part?: string | null
          capture_source?: string | null
          captured_at?: string | null
          created_at?: string | null
          description?: string | null
          file_name: string
          file_path: string
          file_size_kb?: number | null
          gps_accuracy?: number | null
          gps_captured_at?: string | null
          id?: string
          image_type?: string | null
          latitude?: number | null
          longitude?: number | null
          mime_type?: string | null
          patient_id?: string | null
          study_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          body_part?: string | null
          capture_source?: string | null
          captured_at?: string | null
          created_at?: string | null
          description?: string | null
          file_name?: string
          file_path?: string
          file_size_kb?: number | null
          gps_accuracy?: number | null
          gps_captured_at?: string | null
          id?: string
          image_type?: string | null
          latitude?: number | null
          longitude?: number | null
          mime_type?: string | null
          patient_id?: string | null
          study_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pacs_images_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pacs_images_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "pacs_images_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "dicom_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      panel_tests: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          is_mandatory: boolean | null
          panel_id: string | null
          test_id: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_mandatory?: boolean | null
          panel_id?: string | null
          test_id?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_mandatory?: boolean | null
          panel_id?: string | null
          test_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "panel_tests_panel_id_fkey"
            columns: ["panel_id"]
            isOneToOne: false
            referencedRelation: "test_panels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "panel_tests_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "lab_subspeciality"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_call_records: {
        Row: {
          admission_type: string | null
          budget_amount: string | null
          call_date: string
          call_outcome: string | null
          call_status: string | null
          called_on: string | null
          created_at: string | null
          created_by: string | null
          department: string | null
          diagnosis_surgery: string | null
          discharge_date: string | null
          disposition: string | null
          follow_up_date: string | null
          follow_up_required: boolean | null
          hospital_name: string | null
          id: string
          notes: string | null
          patient_id: string | null
          patient_name: string | null
          patient_phone: string | null
          relationship_man: string | null
          remark: string | null
          sub_disposition: string | null
          telecaller_name: string | null
          update_reason: string | null
          updated_at: string | null
          updated_by: string | null
          visit_id: string | null
        }
        Insert: {
          admission_type?: string | null
          budget_amount?: string | null
          call_date?: string
          call_outcome?: string | null
          call_status?: string | null
          called_on?: string | null
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          diagnosis_surgery?: string | null
          discharge_date?: string | null
          disposition?: string | null
          follow_up_date?: string | null
          follow_up_required?: boolean | null
          hospital_name?: string | null
          id?: string
          notes?: string | null
          patient_id?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          relationship_man?: string | null
          remark?: string | null
          sub_disposition?: string | null
          telecaller_name?: string | null
          update_reason?: string | null
          updated_at?: string | null
          updated_by?: string | null
          visit_id?: string | null
        }
        Update: {
          admission_type?: string | null
          budget_amount?: string | null
          call_date?: string
          call_outcome?: string | null
          call_status?: string | null
          called_on?: string | null
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          diagnosis_surgery?: string | null
          discharge_date?: string | null
          disposition?: string | null
          follow_up_date?: string | null
          follow_up_required?: boolean | null
          hospital_name?: string | null
          id?: string
          notes?: string | null
          patient_id?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          relationship_man?: string | null
          remark?: string | null
          sub_disposition?: string | null
          telecaller_name?: string | null
          update_reason?: string | null
          updated_at?: string | null
          updated_by?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_call_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_call_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_call_records_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_data: {
        Row: {
          adhar_card_yes_no: string | null
          age: string | null
          bill_amount: string | null
          bill_made_by_name_of_billing_executive: string | null
          cghs_code_unlisted_with_approval_from_esic: string | null
          cghs_package_amount_approved_unlisted_amount: string | null
          cghs_surgery_esic_referral: string | null
          claim_id: string | null
          date_column_1: Database["public"]["Enums"]["date_status"] | null
          date_column_2: Database["public"]["Enums"]["date_status"] | null
          date_column_3: Database["public"]["Enums"]["date_status"] | null
          date_column_4: Database["public"]["Enums"]["date_status"] | null
          date_column_5: Database["public"]["Enums"]["date_status"] | null
          date_of_admission: string | null
          date_of_discharge: string | null
          date_of_surgery: string | null
          delay_waiver_for_intimation_bill_submission_taken_not_required:
            | string
            | null
          diagnosis_and_surgery_performed: string | null
          e_pahachan_card_yes_no: string | null
          extension_taken_not_taken_not_required: string | null
          hitlabh_or_entitelment_benefits_yes_no: string | null
          intimation_done_not_done: string | null
          mrn: string | null
          on_portal_submission_date: string | null
          patient_id: string | null
          patient_name: string | null
          patient_type: string | null
          patient_uuid: string | null
          payment_status: string | null
          referral_original_yes_no: string | null
          reff_dr_name: string | null
          remark_1: string | null
          remark_2: string | null
          sex: string | null
          sr_no: number
          sst_or_secondary_treatment: string | null
          surgery_name_with_cghs_amount_with_cghs_code: string | null
          surgery_performed_by: string | null
          surgery1_in_referral_letter: string | null
          surgery2: string | null
          surgery3: string | null
          surgery4: string | null
          surgical_additional_approval_taken_not_taken_not_required_both_:
            | string
            | null
          total_package_amount: string | null
        }
        Insert: {
          adhar_card_yes_no?: string | null
          age?: string | null
          bill_amount?: string | null
          bill_made_by_name_of_billing_executive?: string | null
          cghs_code_unlisted_with_approval_from_esic?: string | null
          cghs_package_amount_approved_unlisted_amount?: string | null
          cghs_surgery_esic_referral?: string | null
          claim_id?: string | null
          date_column_1?: Database["public"]["Enums"]["date_status"] | null
          date_column_2?: Database["public"]["Enums"]["date_status"] | null
          date_column_3?: Database["public"]["Enums"]["date_status"] | null
          date_column_4?: Database["public"]["Enums"]["date_status"] | null
          date_column_5?: Database["public"]["Enums"]["date_status"] | null
          date_of_admission?: string | null
          date_of_discharge?: string | null
          date_of_surgery?: string | null
          delay_waiver_for_intimation_bill_submission_taken_not_required?:
            | string
            | null
          diagnosis_and_surgery_performed?: string | null
          e_pahachan_card_yes_no?: string | null
          extension_taken_not_taken_not_required?: string | null
          hitlabh_or_entitelment_benefits_yes_no?: string | null
          intimation_done_not_done?: string | null
          mrn?: string | null
          on_portal_submission_date?: string | null
          patient_id?: string | null
          patient_name?: string | null
          patient_type?: string | null
          patient_uuid?: string | null
          payment_status?: string | null
          referral_original_yes_no?: string | null
          reff_dr_name?: string | null
          remark_1?: string | null
          remark_2?: string | null
          sex?: string | null
          sr_no?: number
          sst_or_secondary_treatment?: string | null
          surgery_name_with_cghs_amount_with_cghs_code?: string | null
          surgery_performed_by?: string | null
          surgery1_in_referral_letter?: string | null
          surgery2?: string | null
          surgery3?: string | null
          surgery4?: string | null
          surgical_additional_approval_taken_not_taken_not_required_both_?:
            | string
            | null
          total_package_amount?: string | null
        }
        Update: {
          adhar_card_yes_no?: string | null
          age?: string | null
          bill_amount?: string | null
          bill_made_by_name_of_billing_executive?: string | null
          cghs_code_unlisted_with_approval_from_esic?: string | null
          cghs_package_amount_approved_unlisted_amount?: string | null
          cghs_surgery_esic_referral?: string | null
          claim_id?: string | null
          date_column_1?: Database["public"]["Enums"]["date_status"] | null
          date_column_2?: Database["public"]["Enums"]["date_status"] | null
          date_column_3?: Database["public"]["Enums"]["date_status"] | null
          date_column_4?: Database["public"]["Enums"]["date_status"] | null
          date_column_5?: Database["public"]["Enums"]["date_status"] | null
          date_of_admission?: string | null
          date_of_discharge?: string | null
          date_of_surgery?: string | null
          delay_waiver_for_intimation_bill_submission_taken_not_required?:
            | string
            | null
          diagnosis_and_surgery_performed?: string | null
          e_pahachan_card_yes_no?: string | null
          extension_taken_not_taken_not_required?: string | null
          hitlabh_or_entitelment_benefits_yes_no?: string | null
          intimation_done_not_done?: string | null
          mrn?: string | null
          on_portal_submission_date?: string | null
          patient_id?: string | null
          patient_name?: string | null
          patient_type?: string | null
          patient_uuid?: string | null
          payment_status?: string | null
          referral_original_yes_no?: string | null
          reff_dr_name?: string | null
          remark_1?: string | null
          remark_2?: string | null
          sex?: string | null
          sr_no?: number
          sst_or_secondary_treatment?: string | null
          surgery_name_with_cghs_amount_with_cghs_code?: string | null
          surgery_performed_by?: string | null
          surgery1_in_referral_letter?: string | null
          surgery2?: string | null
          surgery3?: string | null
          surgery4?: string | null
          surgical_additional_approval_taken_not_taken_not_required_both_?:
            | string
            | null
          total_package_amount?: string | null
        }
        Relationships: []
      }
      patient_documents: {
        Row: {
          capture_source: string | null
          created_at: string | null
          document_name: string
          document_type_id: number
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          gps_accuracy: number | null
          gps_captured_at: string | null
          id: string
          is_uploaded: boolean | null
          latitude: number | null
          longitude: number | null
          patient_id: string | null
          remark_reason: string | null
          remarks: string | null
          updated_at: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          visit_id: string
        }
        Insert: {
          capture_source?: string | null
          created_at?: string | null
          document_name: string
          document_type_id: number
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          gps_accuracy?: number | null
          gps_captured_at?: string | null
          id?: string
          is_uploaded?: boolean | null
          latitude?: number | null
          longitude?: number | null
          patient_id?: string | null
          remark_reason?: string | null
          remarks?: string | null
          updated_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          visit_id: string
        }
        Update: {
          capture_source?: string | null
          created_at?: string | null
          document_name?: string
          document_type_id?: number
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          gps_accuracy?: number | null
          gps_captured_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          is_uploaded?: boolean | null
          patient_id?: string | null
          remark_reason?: string | null
          remarks?: string | null
          updated_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          visit_id?: string
        }
        Relationships: []
      }
      patient_ledgers: {
        Row: {
          account_id: string | null
          address: string | null
          contact_person: string | null
          created_at: string | null
          credit_days: number | null
          credit_limit: number | null
          current_balance: number | null
          current_balance_type: string | null
          email: string | null
          id: string
          is_active: boolean | null
          ledger_name: string
          opening_balance: number | null
          opening_balance_type: string | null
          patient_id: string | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          credit_days?: number | null
          credit_limit?: number | null
          current_balance?: number | null
          current_balance_type?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          ledger_name: string
          opening_balance?: number | null
          opening_balance_type?: string | null
          patient_id?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          credit_days?: number | null
          credit_limit?: number | null
          current_balance?: number | null
          current_balance_type?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          ledger_name?: string
          opening_balance?: number | null
          opening_balance_type?: string | null
          patient_id?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_ledgers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_ledgers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_ledgers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      patient_payment_transactions: {
        Row: {
          amount: number
          bank_name: string | null
          created_at: string | null
          created_by: string | null
          id: string
          narration: string | null
          patient_id: string | null
          payment_date: string
          payment_mode: string
          payment_source: string
          reference_number: string | null
          service_details: Json | null
          source_reference_id: string | null
          source_table_name: string | null
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          amount: number
          bank_name?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          narration?: string | null
          patient_id?: string | null
          payment_date?: string
          payment_mode?: string
          payment_source: string
          reference_number?: string | null
          service_details?: Json | null
          source_reference_id?: string | null
          source_table_name?: string | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          amount?: number
          bank_name?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          narration?: string | null
          patient_id?: string | null
          payment_date?: string
          payment_mode?: string
          payment_source?: string
          reference_number?: string | null
          service_details?: Json | null
          source_reference_id?: string | null
          source_table_name?: string | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_payment_transactions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_payment_transactions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_payment_transactions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["visit_id"]
          },
        ]
      }
      patients: {
        Row: {
          aadhaar_number: string | null
          aadhar_passport: string | null
          address: string | null
          age: number | null
          allergies: string | null
          billing_link: string | null
          blood_group: string | null
          category: string | null
          city_town: string | null
          corporate: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          emergency_contact_mobile: string | null
          emergency_contact_name: string | null
          gender: string | null
          hospital_name: string | null
          id: string
          identity_type: string | null
          instructions: string | null
          insurance_person_no: string | null
          marketed_by: string | null
          name: string
          panchayat: string | null
          patient_photo: string | null
          patients_id: string | null
          phone: string | null
          pin_code: string | null
          privilege_card_number: string | null
          quarter_plot_no: string | null
          referral_source: string | null
          registration_id: string | null
          relationship_manager: string | null
          relative_phone_no: string | null
          second_emergency_contact_mobile: string | null
          second_emergency_contact_name: string | null
          spouse_name: string | null
          state: string | null
          updated_at: string
          ward: string | null
        }
        Insert: {
          aadhaar_number?: string | null
          aadhar_passport?: string | null
          address?: string | null
          age?: number | null
          allergies?: string | null
          billing_link?: string | null
          blood_group?: string | null
          category?: string | null
          city_town?: string | null
          corporate?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_mobile?: string | null
          emergency_contact_name?: string | null
          gender?: string | null
          hospital_name?: string | null
          id?: string
          identity_type?: string | null
          instructions?: string | null
          insurance_person_no?: string | null
          marketed_by?: string | null
          name: string
          panchayat?: string | null
          patient_photo?: string | null
          patients_id?: string | null
          phone?: string | null
          pin_code?: string | null
          privilege_card_number?: string | null
          quarter_plot_no?: string | null
          referral_source?: string | null
          registration_id?: string | null
          relationship_manager?: string | null
          relative_phone_no?: string | null
          second_emergency_contact_mobile?: string | null
          second_emergency_contact_name?: string | null
          spouse_name?: string | null
          state?: string | null
          updated_at?: string
          ward?: string | null
        }
        Update: {
          aadhaar_number?: string | null
          aadhar_passport?: string | null
          address?: string | null
          age?: number | null
          allergies?: string | null
          billing_link?: string | null
          blood_group?: string | null
          category?: string | null
          city_town?: string | null
          corporate?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_mobile?: string | null
          emergency_contact_name?: string | null
          gender?: string | null
          hospital_name?: string | null
          id?: string
          identity_type?: string | null
          instructions?: string | null
          insurance_person_no?: string | null
          marketed_by?: string | null
          name?: string
          panchayat?: string | null
          patient_photo?: string | null
          patients_id?: string | null
          phone?: string | null
          pin_code?: string | null
          privilege_card_number?: string | null
          quarter_plot_no?: string | null
          referral_source?: string | null
          registration_id?: string | null
          relationship_manager?: string | null
          relative_phone_no?: string | null
          second_emergency_contact_mobile?: string | null
          second_emergency_contact_name?: string | null
          spouse_name?: string | null
          state?: string | null
          updated_at?: string
          ward?: string | null
        }
        Relationships: []
      }
      payment_allocations: {
        Row: {
          allocated_amount: number
          allocation_date: string
          created_at: string | null
          id: string
          outstanding_invoice_id: string | null
          payment_transaction_id: string | null
        }
        Insert: {
          allocated_amount: number
          allocation_date: string
          created_at?: string | null
          id?: string
          outstanding_invoice_id?: string | null
          payment_transaction_id?: string | null
        }
        Update: {
          allocated_amount?: number
          allocation_date?: string
          created_at?: string | null
          id?: string
          outstanding_invoice_id?: string | null
          payment_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_outstanding_invoice_id_fkey"
            columns: ["outstanding_invoice_id"]
            isOneToOne: false
            referencedRelation: "outstanding_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_deadlines: {
        Row: {
          amount: number
          created_at: string | null
          due_date: string
          hospital_type: string
          id: string
          notes: string | null
          service_name: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          due_date: string
          hospital_type?: string
          id?: string
          notes?: string | null
          service_name: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          due_date?: string
          hospital_type?: string
          id?: string
          notes?: string | null
          service_name?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payment_obligation_ledgers: {
        Row: {
          company_id: string
          created_at: string
          ledger_id: string
          obligation_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          ledger_id: string
          obligation_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          ledger_id?: string
          obligation_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_obligation_ledgers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_obligation_ledgers_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "tally_ledgers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_obligation_ledgers_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "payment_obligations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_obligation_sub_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          section: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          section: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          section?: string
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      payment_obligations: {
        Row: {
          approximate_balance: number | null
          attachment_url: string | null
          category: string
          chart_of_accounts_id: string | null
          company_id: string | null
          created_at: string | null
          default_daily_amount: number
          google_sheet_link: string | null
          hospital_name: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          party_name: string
          payee_name: string | null
          payee_search_table: string | null
          priority: number
          section: string | null
          sub_category: string | null
          tally_ledger_id: string | null
          updated_at: string | null
        }
        Insert: {
          approximate_balance?: number | null
          attachment_url?: string | null
          category: string
          chart_of_accounts_id?: string | null
          company_id?: string | null
          created_at?: string | null
          default_daily_amount?: number
          google_sheet_link?: string | null
          hospital_name?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          party_name: string
          payee_name?: string | null
          payee_search_table?: string | null
          priority?: number
          section?: string | null
          sub_category?: string | null
          tally_ledger_id?: string | null
          updated_at?: string | null
        }
        Update: {
          approximate_balance?: number | null
          attachment_url?: string | null
          category?: string
          chart_of_accounts_id?: string | null
          company_id?: string | null
          created_at?: string | null
          default_daily_amount?: number
          google_sheet_link?: string | null
          hospital_name?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          party_name?: string
          payee_name?: string | null
          payee_search_table?: string | null
          priority?: number
          section?: string | null
          sub_category?: string | null
          tally_ledger_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_obligations_chart_of_accounts_id_fkey"
            columns: ["chart_of_accounts_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_obligations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_obligations_tally_ledger_id_fkey"
            columns: ["tally_ledger_id"]
            isOneToOne: false
            referencedRelation: "tally_ledgers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          amount: number
          created_at: string | null
          expires_at: string | null
          gateway: string | null
          id: string
          notes: string | null
          paid_at: string | null
          patient_name: string | null
          qr_data: string | null
          status: string | null
          upi_id: string | null
          upi_ref: string | null
          visit_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          expires_at?: string | null
          gateway?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          patient_name?: string | null
          qr_data?: string | null
          status?: string | null
          upi_id?: string | null
          upi_ref?: string | null
          visit_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          expires_at?: string | null
          gateway?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          patient_name?: string | null
          qr_data?: string | null
          status?: string | null
          upi_id?: string | null
          upi_ref?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_sub_allocations: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          is_paid: boolean | null
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          payee_name: string
          schedule_id: string
          updated_at: string | null
          voucher_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          id?: string
          is_paid?: boolean | null
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payee_name: string
          schedule_id: string
          updated_at?: string | null
          voucher_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          is_paid?: boolean | null
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payee_name?: string
          schedule_id?: string
          updated_at?: string | null
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_sub_allocations_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "daily_payment_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_sub_allocations_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          bank_name: string | null
          cheque_date: string | null
          cheque_number: string | null
          created_at: string | null
          id: string
          patient_id: string | null
          payment_amount: number
          payment_date: string
          payment_mode: string
          reference_number: string | null
          remarks: string | null
          status: string | null
          updated_at: string | null
          voucher_id: string | null
        }
        Insert: {
          bank_name?: string | null
          cheque_date?: string | null
          cheque_number?: string | null
          created_at?: string | null
          id?: string
          patient_id?: string | null
          payment_amount: number
          payment_date: string
          payment_mode: string
          reference_number?: string | null
          remarks?: string | null
          status?: string | null
          updated_at?: string | null
          voucher_id?: string | null
        }
        Update: {
          bank_name?: string | null
          cheque_date?: string | null
          cheque_number?: string | null
          created_at?: string | null
          id?: string
          patient_id?: string | null
          payment_amount?: number
          payment_date?: string
          payment_mode?: string
          reference_number?: string | null
          remarks?: string | null
          status?: string | null
          updated_at?: string | null
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "payment_transactions_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_vouchers: {
        Row: {
          amount: number
          created_at: string | null
          hospital_type: string
          id: string
          paid_by: string | null
          person_name: string
          purpose: string | null
          updated_at: string | null
          voucher_date: string
          voucher_no: string
        }
        Insert: {
          amount?: number
          created_at?: string | null
          hospital_type?: string
          id?: string
          paid_by?: string | null
          person_name: string
          purpose?: string | null
          updated_at?: string | null
          voucher_date: string
          voucher_no: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          hospital_type?: string
          id?: string
          paid_by?: string | null
          person_name?: string
          purpose?: string | null
          updated_at?: string | null
          voucher_date?: string
          voucher_no?: string
        }
        Relationships: []
      }
      pharmacy_credit_payments: {
        Row: {
          amount: number
          created_at: string | null
          hospital_name: string
          id: string
          patient_id: string | null
          patient_name: string | null
          patient_uuid: string | null
          payment_date: string | null
          payment_method: string
          payment_reference: string | null
          pharmacy_executive: string | null
          received_by: string | null
          remarks: string | null
          sale_id: number | null
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          hospital_name: string
          id?: string
          patient_id?: string | null
          patient_name?: string | null
          patient_uuid?: string | null
          payment_date?: string | null
          payment_method: string
          payment_reference?: string | null
          pharmacy_executive?: string | null
          received_by?: string | null
          remarks?: string | null
          sale_id?: number | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          hospital_name?: string
          id?: string
          patient_id?: string | null
          patient_name?: string | null
          patient_uuid?: string | null
          payment_date?: string | null
          payment_method?: string
          payment_reference?: string | null
          pharmacy_executive?: string | null
          received_by?: string | null
          remarks?: string | null
          sale_id?: number | null
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_credit_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_sales"
            referencedColumns: ["sale_id"]
          },
        ]
      }
      pharmacy_sale_items: {
        Row: {
          batch_inventory_id: string | null
          batch_number: string | null
          cost_price: number | null
          created_at: string | null
          discount: number | null
          discount_percentage: number | null
          dosage_form: string | null
          expiry_date: string | null
          generic_name: string | null
          is_implant: boolean | null
          item_code: string | null
          loose_quantity: number | null
          manufacturer: string | null
          medication_id: string | null
          medication_name: string | null
          mrp: number | null
          pack_size: number | null
          quantity: number
          sale_id: number
          sale_item_id: number
          strength: string | null
          tax_amount: number | null
          tax_percentage: number | null
          total_price: number | null
          unit_price: number | null
          ward_discount: number | null
        }
        Insert: {
          batch_inventory_id?: string | null
          batch_number?: string | null
          cost_price?: number | null
          created_at?: string | null
          discount?: number | null
          discount_percentage?: number | null
          dosage_form?: string | null
          expiry_date?: string | null
          generic_name?: string | null
          is_implant?: boolean | null
          item_code?: string | null
          loose_quantity?: number | null
          manufacturer?: string | null
          medication_id?: string | null
          medication_name?: string | null
          mrp?: number | null
          pack_size?: number | null
          quantity: number
          sale_id: number
          sale_item_id?: number
          strength?: string | null
          tax_amount?: number | null
          tax_percentage?: number | null
          total_price?: number | null
          unit_price?: number | null
          ward_discount?: number | null
        }
        Update: {
          batch_inventory_id?: string | null
          batch_number?: string | null
          cost_price?: number | null
          created_at?: string | null
          discount?: number | null
          discount_percentage?: number | null
          dosage_form?: string | null
          expiry_date?: string | null
          generic_name?: string | null
          is_implant?: boolean | null
          item_code?: string | null
          loose_quantity?: number | null
          manufacturer?: string | null
          medication_id?: string | null
          medication_name?: string | null
          mrp?: number | null
          pack_size?: number | null
          quantity?: number
          sale_id?: number
          sale_item_id?: number
          strength?: string | null
          tax_amount?: number | null
          tax_percentage?: number | null
          total_price?: number | null
          unit_price?: number | null
          ward_discount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sale"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "pharmacy_sale_items_batch_inventory_id_fkey"
            columns: ["batch_inventory_id"]
            isOneToOne: false
            referencedRelation: "medicine_batch_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_sale_items_batch_inventory_id_fkey"
            columns: ["batch_inventory_id"]
            isOneToOne: false
            referencedRelation: "v_batch_stock_details"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacy_sales: {
        Row: {
          bill_number: string | null
          created_at: string | null
          created_by: string | null
          discount: number | null
          discount_percentage: number | null
          doctor_id: number | null
          doctor_name: string | null
          hospital_name: string | null
          is_third_party_payment: boolean | null
          patient_id: string | null
          patient_name: string | null
          payment_method: string | null
          payment_status: string | null
          prescription_number: string | null
          remarks: string | null
          sale_date: string | null
          sale_id: number
          sale_type: string | null
          status: string | null
          subtotal: number | null
          tax_gst: number | null
          tax_percentage: number | null
          third_party_payment_date: string | null
          third_party_pharmacy_name: string | null
          total_amount: number | null
          updated_at: string | null
          updated_by: string | null
          visit_id: string | null
          ward_type: string | null
        }
        Insert: {
          bill_number?: string | null
          created_at?: string | null
          created_by?: string | null
          discount?: number | null
          discount_percentage?: number | null
          doctor_id?: number | null
          doctor_name?: string | null
          hospital_name?: string | null
          is_third_party_payment?: boolean | null
          patient_id?: string | null
          patient_name?: string | null
          payment_method?: string | null
          payment_status?: string | null
          prescription_number?: string | null
          remarks?: string | null
          sale_date?: string | null
          sale_id?: number
          sale_type?: string | null
          status?: string | null
          subtotal?: number | null
          tax_gst?: number | null
          tax_percentage?: number | null
          third_party_payment_date?: string | null
          third_party_pharmacy_name?: string | null
          total_amount?: number | null
          updated_at?: string | null
          updated_by?: string | null
          visit_id?: string | null
          ward_type?: string | null
        }
        Update: {
          bill_number?: string | null
          created_at?: string | null
          created_by?: string | null
          discount?: number | null
          discount_percentage?: number | null
          doctor_id?: number | null
          doctor_name?: string | null
          hospital_name?: string | null
          is_third_party_payment?: boolean | null
          patient_id?: string | null
          patient_name?: string | null
          payment_method?: string | null
          payment_status?: string | null
          prescription_number?: string | null
          remarks?: string | null
          sale_date?: string | null
          sale_id?: number
          sale_type?: string | null
          status?: string | null
          subtotal?: number | null
          tax_gst?: number | null
          tax_percentage?: number | null
          third_party_payment_date?: string | null
          third_party_pharmacy_name?: string | null
          total_amount?: number | null
          updated_at?: string | null
          updated_by?: string | null
          visit_id?: string | null
          ward_type?: string | null
        }
        Relationships: []
      }
      physiotherapy_bill_items: {
        Row: {
          amount: number | null
          cghs_code: string | null
          cghs_rate: number | null
          created_at: string | null
          id: string
          item_name: string | null
          quantity: number | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          amount?: number | null
          cghs_code?: string | null
          cghs_rate?: number | null
          created_at?: string | null
          id?: string
          item_name?: string | null
          quantity?: number | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          amount?: number | null
          cghs_code?: string | null
          cghs_rate?: number | null
          created_at?: string | null
          id?: string
          item_name?: string | null
          quantity?: number | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: []
      }
      playbook_events: {
        Row: {
          account_id: string
          created_at: string | null
          event_type: string
          id: number
          metadata: Json | null
          step_number: number | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          event_type: string
          id?: number
          metadata?: Json | null
          step_number?: number | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          event_type?: string
          id?: number
          metadata?: Json | null
          step_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "playbook_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "client_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      pmjay_mjpjay_packages: {
        Row: {
          category: string | null
          created_at: string | null
          diagnosis: string | null
          diagnosis_code: string | null
          id: string
          is_active: boolean | null
          package_price: number | null
          patient_name_example: string | null
          remark: string | null
          scheme: string
          treatment_code: string | null
          treatment_plan: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          diagnosis?: string | null
          diagnosis_code?: string | null
          id?: string
          is_active?: boolean | null
          package_price?: number | null
          patient_name_example?: string | null
          remark?: string | null
          scheme: string
          treatment_code?: string | null
          treatment_plan?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          diagnosis?: string | null
          diagnosis_code?: string | null
          id?: string
          is_active?: boolean | null
          package_price?: number | null
          patient_name_example?: string | null
          remark?: string | null
          scheme?: string
          treatment_code?: string | null
          treatment_plan?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      post_surgical_consultations: {
        Row: {
          amount: number
          code_number: string | null
          cost: number
          created_at: string | null
          date_from: string | null
          date_to: string | null
          doctor_id: string | null
          doctor_name: string
          id: string
          nabh_rate: number
          quantity: number
          sort_order: number
          surgical_billing_id: string | null
          updated_at: string | null
          visible: boolean
        }
        Insert: {
          amount?: number
          code_number?: string | null
          cost?: number
          created_at?: string | null
          date_from?: string | null
          date_to?: string | null
          doctor_id?: string | null
          doctor_name: string
          id?: string
          nabh_rate?: number
          quantity?: number
          sort_order?: number
          surgical_billing_id?: string | null
          updated_at?: string | null
          visible?: boolean
        }
        Update: {
          amount?: number
          code_number?: string | null
          cost?: number
          created_at?: string | null
          date_from?: string | null
          date_to?: string | null
          doctor_id?: string | null
          doctor_name?: string
          id?: string
          nabh_rate?: number
          quantity?: number
          sort_order?: number
          surgical_billing_id?: string | null
          updated_at?: string | null
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "post_surgical_consultations_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "hope_consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_surgical_consultations_surgical_billing_id_fkey"
            columns: ["surgical_billing_id"]
            isOneToOne: false
            referencedRelation: "surgical_billing"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_items: {
        Row: {
          batch_numbers: string[] | null
          brand_name: string | null
          created_at: string | null
          discount_percentage: number | null
          dispensed_at: string | null
          dosage_frequency: string | null
          dosage_timing: string | null
          duration_days: number | null
          generic_name: string | null
          id: string
          is_substituted: boolean | null
          medicine_id: string | null
          medicine_name: string | null
          prescription_id: string | null
          quantity_dispensed: number | null
          quantity_prescribed: number
          special_instructions: string | null
          substitute_medicine_id: string | null
          substitute_reason: string | null
          total_price: number | null
          unit_price: number | null
          updated_at: string | null
          visit_medication_id: string | null
        }
        Insert: {
          batch_numbers?: string[] | null
          brand_name?: string | null
          created_at?: string | null
          discount_percentage?: number | null
          dispensed_at?: string | null
          dosage_frequency?: string | null
          dosage_timing?: string | null
          duration_days?: number | null
          generic_name?: string | null
          id?: string
          is_substituted?: boolean | null
          medicine_id?: string | null
          medicine_name?: string | null
          prescription_id?: string | null
          quantity_dispensed?: number | null
          quantity_prescribed: number
          special_instructions?: string | null
          substitute_medicine_id?: string | null
          substitute_reason?: string | null
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string | null
          visit_medication_id?: string | null
        }
        Update: {
          batch_numbers?: string[] | null
          brand_name?: string | null
          created_at?: string | null
          discount_percentage?: number | null
          dispensed_at?: string | null
          dosage_frequency?: string | null
          dosage_timing?: string | null
          duration_days?: number | null
          generic_name?: string | null
          id?: string
          is_substituted?: boolean | null
          medicine_id?: string | null
          medicine_name?: string | null
          prescription_id?: string | null
          quantity_dispensed?: number | null
          quantity_prescribed?: number
          special_instructions?: string | null
          substitute_medicine_id?: string | null
          substitute_reason?: string | null
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string | null
          visit_medication_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string | null
          diagnosis: string | null
          discount_amount: number | null
          dispensed_at: string | null
          dispensed_by: string | null
          doctor_id: string | null
          doctor_name: string | null
          drug_interaction_checked_at: string | null
          drug_interaction_report: Json | null
          drug_interaction_signature: string | null
          final_amount: number | null
          hospital_name: string | null
          id: string
          notes: string | null
          patient_id: string | null
          patient_location: string | null
          prescription_date: string
          prescription_image_type: string | null
          prescription_image_url: string | null
          prescription_number: string
          priority: string | null
          source: string
          status: string | null
          symptoms: string | null
          tax_amount: number | null
          total_amount: number | null
          updated_at: string | null
          visit_id: string | null
          vital_signs: Json | null
        }
        Insert: {
          created_at?: string | null
          diagnosis?: string | null
          discount_amount?: number | null
          dispensed_at?: string | null
          dispensed_by?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          drug_interaction_checked_at?: string | null
          drug_interaction_report?: Json | null
          drug_interaction_signature?: string | null
          final_amount?: number | null
          hospital_name?: string | null
          id?: string
          notes?: string | null
          patient_id?: string | null
          patient_location?: string | null
          prescription_date: string
          prescription_image_type?: string | null
          prescription_image_url?: string | null
          prescription_number: string
          priority?: string | null
          source?: string
          status?: string | null
          symptoms?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
          visit_id?: string | null
          vital_signs?: Json | null
        }
        Update: {
          created_at?: string | null
          diagnosis?: string | null
          discount_amount?: number | null
          dispensed_at?: string | null
          dispensed_by?: string | null
          doctor_id?: string | null
          doctor_name?: string | null
          drug_interaction_checked_at?: string | null
          drug_interaction_report?: Json | null
          drug_interaction_signature?: string | null
          final_amount?: number | null
          hospital_name?: string | null
          id?: string
          notes?: string | null
          patient_id?: string | null
          patient_location?: string | null
          prescription_date?: string
          prescription_image_type?: string | null
          prescription_image_url?: string | null
          prescription_number?: string
          priority?: string | null
          source?: string
          status?: string | null
          symptoms?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
          visit_id?: string | null
          vital_signs?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      project_documents: {
        Row: {
          amount: string | null
          delivered: boolean
          direction: string
          doc_type: string
          filename: string | null
          id: string
          label: string | null
          pdf_filename: string | null
          project: string
          sort_order: number
          stage: string
          updated_at: string
        }
        Insert: {
          amount?: string | null
          delivered?: boolean
          direction: string
          doc_type: string
          filename?: string | null
          id?: string
          label?: string | null
          pdf_filename?: string | null
          project: string
          sort_order?: number
          stage?: string
          updated_at?: string
        }
        Update: {
          amount?: string | null
          delivered?: boolean
          direction?: string
          doc_type?: string
          filename?: string | null
          id?: string
          label?: string | null
          pdf_filename?: string | null
          project?: string
          sort_order?: number
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          amount: number | null
          batch_no: string | null
          cgst: number | null
          created_at: string | null
          expiry_date: string | null
          free_quantity: number | null
          gst: number | null
          gst_amount: number | null
          id: string
          manufacturer: string | null
          medicine_id: string | null
          mrp: number | null
          order_quantity: number
          pack: string | null
          product_name: string
          purchase_order_id: string
          purchase_price: number | null
          received_quantity: number | null
          sale_price: number | null
          sgst: number | null
          tax_amount: number | null
          tax_percentage: number | null
        }
        Insert: {
          amount?: number | null
          batch_no?: string | null
          cgst?: number | null
          created_at?: string | null
          expiry_date?: string | null
          free_quantity?: number | null
          gst?: number | null
          gst_amount?: number | null
          id?: string
          manufacturer?: string | null
          medicine_id?: string | null
          mrp?: number | null
          order_quantity?: number
          pack?: string | null
          product_name: string
          purchase_order_id: string
          purchase_price?: number | null
          received_quantity?: number | null
          sale_price?: number | null
          sgst?: number | null
          tax_amount?: number | null
          tax_percentage?: number | null
        }
        Update: {
          amount?: number | null
          batch_no?: string | null
          cgst?: number | null
          created_at?: string | null
          expiry_date?: string | null
          free_quantity?: number | null
          gst?: number | null
          gst_amount?: number | null
          id?: string
          manufacturer?: string | null
          medicine_id?: string | null
          mrp?: number | null
          order_quantity?: number
          pack?: string | null
          product_name?: string
          purchase_order_id?: string
          purchase_price?: number | null
          received_quantity?: number | null
          sale_price?: number | null
          sgst?: number | null
          tax_amount?: number | null
          tax_percentage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicine_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacy_low_stock_alert"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          actual_delivery_date: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          discount: number | null
          expected_delivery_date: string | null
          id: string
          notes: string | null
          order_date: string
          order_for: string | null
          po_number: string
          status: string | null
          subtotal: number | null
          supplier_id: number | null
          tax_amount: number | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          actual_delivery_date?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          discount?: number | null
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_date: string
          order_for?: string | null
          po_number: string
          status?: string | null
          subtotal?: number | null
          supplier_id?: number | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          actual_delivery_date?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          discount?: number | null
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_for?: string | null
          po_number?: string
          status?: string | null
          subtotal?: number | null
          supplier_id?: number | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_controls: {
        Row: {
          acceptable_range_max: number | null
          acceptable_range_min: number | null
          actual_value: number | null
          corrective_action: string | null
          created_at: string | null
          equipment_id: string | null
          expected_unit: string | null
          expected_value: number | null
          expiry_date: string | null
          follow_up_required: boolean | null
          id: string
          level: string | null
          lot_number: string | null
          performed_by: string | null
          performed_datetime: string | null
          qc_material: string | null
          qc_status: string | null
          qc_type: string
          result_unit: string | null
          reviewed_by: string | null
          reviewed_datetime: string | null
          test_id: string | null
          updated_at: string | null
        }
        Insert: {
          acceptable_range_max?: number | null
          acceptable_range_min?: number | null
          actual_value?: number | null
          corrective_action?: string | null
          created_at?: string | null
          equipment_id?: string | null
          expected_unit?: string | null
          expected_value?: number | null
          expiry_date?: string | null
          follow_up_required?: boolean | null
          id?: string
          level?: string | null
          lot_number?: string | null
          performed_by?: string | null
          performed_datetime?: string | null
          qc_material?: string | null
          qc_status?: string | null
          qc_type: string
          result_unit?: string | null
          reviewed_by?: string | null
          reviewed_datetime?: string | null
          test_id?: string | null
          updated_at?: string | null
        }
        Update: {
          acceptable_range_max?: number | null
          acceptable_range_min?: number | null
          actual_value?: number | null
          corrective_action?: string | null
          created_at?: string | null
          equipment_id?: string | null
          expected_unit?: string | null
          expected_value?: number | null
          expiry_date?: string | null
          follow_up_required?: boolean | null
          id?: string
          level?: string | null
          lot_number?: string | null
          performed_by?: string | null
          performed_datetime?: string | null
          qc_material?: string | null
          qc_status?: string | null
          qc_type?: string
          result_unit?: string | null
          reviewed_by?: string | null
          reviewed_datetime?: string | null
          test_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_controls_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "lab_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_controls_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "lab_subspeciality"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_tokens: {
        Row: {
          called_at: string | null
          counter_name: string | null
          created_at: string
          created_by: string | null
          department: string
          id: string
          mobile: string | null
          notes: string | null
          patient_id: string | null
          patient_name: string
          served_at: string | null
          status: string
          token_number: number
          visit_id: string | null
        }
        Insert: {
          called_at?: string | null
          counter_name?: string | null
          created_at?: string
          created_by?: string | null
          department: string
          id?: string
          mobile?: string | null
          notes?: string | null
          patient_id?: string | null
          patient_name: string
          served_at?: string | null
          status?: string
          token_number: number
          visit_id?: string | null
        }
        Update: {
          called_at?: string | null
          counter_name?: string | null
          created_at?: string
          created_by?: string | null
          department?: string
          id?: string
          mobile?: string | null
          notes?: string | null
          patient_id?: string | null
          patient_name?: string
          served_at?: string | null
          status?: string
          token_number?: number
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "queue_tokens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_tokens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "queue_tokens_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      radiation_dose_tracking: {
        Row: {
          body_part: string | null
          created_at: string | null
          ct_dose_index: number | null
          dose_length_product: number | null
          dose_optimization_notes: string | null
          dose_reference_level: number | null
          effective_dose: number | null
          entrance_skin_dose: number | null
          exceeds_drl: boolean | null
          exposure_factors: Json | null
          fluoroscopy_time: number | null
          id: string
          kvp: number | null
          mas: number | null
          modality: string
          patient_age: number | null
          patient_id: string
          patient_weight: number | null
          pregnancy_status: string | null
          procedure_name: string | null
          recorded_at: string | null
          study_id: string | null
        }
        Insert: {
          body_part?: string | null
          created_at?: string | null
          ct_dose_index?: number | null
          dose_length_product?: number | null
          dose_optimization_notes?: string | null
          dose_reference_level?: number | null
          effective_dose?: number | null
          entrance_skin_dose?: number | null
          exceeds_drl?: boolean | null
          exposure_factors?: Json | null
          fluoroscopy_time?: number | null
          id?: string
          kvp?: number | null
          mas?: number | null
          modality: string
          patient_age?: number | null
          patient_id: string
          patient_weight?: number | null
          pregnancy_status?: string | null
          procedure_name?: string | null
          recorded_at?: string | null
          study_id?: string | null
        }
        Update: {
          body_part?: string | null
          created_at?: string | null
          ct_dose_index?: number | null
          dose_length_product?: number | null
          dose_optimization_notes?: string | null
          dose_reference_level?: number | null
          effective_dose?: number | null
          entrance_skin_dose?: number | null
          exceeds_drl?: boolean | null
          exposure_factors?: Json | null
          fluoroscopy_time?: number | null
          id?: string
          kvp?: number | null
          mas?: number | null
          modality?: string
          patient_age?: number | null
          patient_id?: string
          patient_weight?: number | null
          pregnancy_status?: string | null
          procedure_name?: string | null
          recorded_at?: string | null
          study_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "radiation_dose_tracking_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "dicom_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      radiologists: {
        Row: {
          created_at: string | null
          digital_signature_path: string | null
          email: string | null
          employee_id: string | null
          first_name: string
          hire_date: string | null
          id: string
          is_active: boolean | null
          last_name: string
          license_number: string | null
          phone: string | null
          reporting_rate: number | null
          specializations: string[] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          digital_signature_path?: string | null
          email?: string | null
          employee_id?: string | null
          first_name: string
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_name: string
          license_number?: string | null
          phone?: string | null
          reporting_rate?: number | null
          specializations?: string[] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          digital_signature_path?: string | null
          email?: string | null
          employee_id?: string | null
          first_name?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_name?: string
          license_number?: string | null
          phone?: string | null
          reporting_rate?: number | null
          specializations?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      radiology: {
        Row: {
          bhopal_nabh: number | null
          bhopal_non_nabh: number | null
          category: string | null
          CGHS_Code: string | null
          created_at: string
          description: string | null
          id: string
          nabh_nabl_rate: number | null
          NABH_NABL_Rate: string | null
          name: string
          non_nabh_nabl_rate: number | null
          Non_NABH_NABL_Rate: string | null
          private: string | null
          updated_at: string
        }
        Insert: {
          bhopal_nabh?: number | null
          bhopal_non_nabh?: number | null
          category?: string | null
          CGHS_Code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          nabh_nabl_rate?: number | null
          NABH_NABL_Rate?: string | null
          name: string
          non_nabh_nabl_rate?: number | null
          Non_NABH_NABL_Rate?: string | null
          private?: string | null
          updated_at?: string
        }
        Update: {
          bhopal_nabh?: number | null
          bhopal_non_nabh?: number | null
          category?: string | null
          CGHS_Code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          nabh_nabl_rate?: number | null
          NABH_NABL_Rate?: string | null
          name?: string
          non_nabh_nabl_rate?: number | null
          Non_NABH_NABL_Rate?: string | null
          private?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      radiology_appointments: {
        Row: {
          actual_end_time: string | null
          actual_start_time: string | null
          appointment_date: string
          appointment_number: string | null
          appointment_time: string
          complications: string | null
          contrast_administered: boolean | null
          contrast_volume: number | null
          created_at: string | null
          estimated_duration: number | null
          id: string
          modality_id: string | null
          notes: string | null
          order_id: string | null
          patient_arrived_at: string | null
          patient_id: string
          preparation_completed: boolean | null
          status: string | null
          technologist_id: string | null
          updated_at: string | null
        }
        Insert: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          appointment_date: string
          appointment_number?: string | null
          appointment_time: string
          complications?: string | null
          contrast_administered?: boolean | null
          contrast_volume?: number | null
          created_at?: string | null
          estimated_duration?: number | null
          id?: string
          modality_id?: string | null
          notes?: string | null
          order_id?: string | null
          patient_arrived_at?: string | null
          patient_id: string
          preparation_completed?: boolean | null
          status?: string | null
          technologist_id?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_end_time?: string | null
          actual_start_time?: string | null
          appointment_date?: string
          appointment_number?: string | null
          appointment_time?: string
          complications?: string | null
          contrast_administered?: boolean | null
          contrast_volume?: number | null
          created_at?: string | null
          estimated_duration?: number | null
          id?: string
          modality_id?: string | null
          notes?: string | null
          order_id?: string | null
          patient_arrived_at?: string | null
          patient_id?: string
          preparation_completed?: boolean | null
          status?: string | null
          technologist_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "radiology_appointments_modality_id_fkey"
            columns: ["modality_id"]
            isOneToOne: false
            referencedRelation: "radiology_modalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radiology_appointments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "radiology_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radiology_appointments_technologist_id_fkey"
            columns: ["technologist_id"]
            isOneToOne: false
            referencedRelation: "radiology_technologists"
            referencedColumns: ["id"]
          },
        ]
      }
      radiology_modalities: {
        Row: {
          avg_study_duration: number | null
          calibration_date: string | null
          code: string
          created_at: string | null
          description: string | null
          id: string
          installation_date: string | null
          is_active: boolean | null
          location: string | null
          manufacturer: string | null
          max_patients_per_day: number | null
          model: string | null
          name: string
          next_calibration_date: string | null
          radiation_type: string | null
          updated_at: string | null
        }
        Insert: {
          avg_study_duration?: number | null
          calibration_date?: string | null
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          installation_date?: string | null
          is_active?: boolean | null
          location?: string | null
          manufacturer?: string | null
          max_patients_per_day?: number | null
          model?: string | null
          name: string
          next_calibration_date?: string | null
          radiation_type?: string | null
          updated_at?: string | null
        }
        Update: {
          avg_study_duration?: number | null
          calibration_date?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          installation_date?: string | null
          is_active?: boolean | null
          location?: string | null
          manufacturer?: string | null
          max_patients_per_day?: number | null
          model?: string | null
          name?: string
          next_calibration_date?: string | null
          radiation_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      radiology_orders: {
        Row: {
          clinical_history: string | null
          clinical_indication: string | null
          contrast_allergies: string | null
          created_at: string | null
          created_by: string | null
          estimated_cost: number | null
          id: string
          insurance_authorization: string | null
          modality_id: string | null
          notes: string | null
          order_date: string | null
          order_number: string
          ordering_department: string | null
          ordering_physician: string | null
          patient_height: number | null
          patient_id: string
          patient_weight: number | null
          pregnancy_status: string | null
          priority: string | null
          procedure_id: string | null
          radiologist_notes: string | null
          requested_date: string | null
          scan_completed_at: string | null
          scan_started_at: string | null
          scheduled_date: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          clinical_history?: string | null
          clinical_indication?: string | null
          contrast_allergies?: string | null
          created_at?: string | null
          created_by?: string | null
          estimated_cost?: number | null
          id?: string
          insurance_authorization?: string | null
          modality_id?: string | null
          notes?: string | null
          order_date?: string | null
          order_number: string
          ordering_department?: string | null
          ordering_physician?: string | null
          patient_height?: number | null
          patient_id: string
          patient_weight?: number | null
          pregnancy_status?: string | null
          priority?: string | null
          procedure_id?: string | null
          radiologist_notes?: string | null
          requested_date?: string | null
          scan_completed_at?: string | null
          scan_started_at?: string | null
          scheduled_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          clinical_history?: string | null
          clinical_indication?: string | null
          contrast_allergies?: string | null
          created_at?: string | null
          created_by?: string | null
          estimated_cost?: number | null
          id?: string
          insurance_authorization?: string | null
          modality_id?: string | null
          notes?: string | null
          order_date?: string | null
          order_number?: string
          ordering_department?: string | null
          ordering_physician?: string | null
          patient_height?: number | null
          patient_id?: string
          patient_weight?: number | null
          pregnancy_status?: string | null
          priority?: string | null
          procedure_id?: string | null
          radiologist_notes?: string | null
          requested_date?: string | null
          scan_completed_at?: string | null
          scan_started_at?: string | null
          scheduled_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "radiology_orders_modality_id_fkey"
            columns: ["modality_id"]
            isOneToOne: false
            referencedRelation: "radiology_modalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radiology_orders_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "radiology_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      radiology_procedures: {
        Row: {
          body_part: string | null
          code: string
          contrast_required: boolean | null
          contrast_type: string | null
          cpt_code: string | null
          created_at: string | null
          estimated_duration: number | null
          icd_codes: string[] | null
          id: string
          is_active: boolean | null
          modality_id: string | null
          name: string
          preparation_instructions: string | null
          price: number | null
          procedure_steps: string | null
          radiation_dose: number | null
          study_type: string | null
          updated_at: string | null
        }
        Insert: {
          body_part?: string | null
          code: string
          contrast_required?: boolean | null
          contrast_type?: string | null
          cpt_code?: string | null
          created_at?: string | null
          estimated_duration?: number | null
          icd_codes?: string[] | null
          id?: string
          is_active?: boolean | null
          modality_id?: string | null
          name: string
          preparation_instructions?: string | null
          price?: number | null
          procedure_steps?: string | null
          radiation_dose?: number | null
          study_type?: string | null
          updated_at?: string | null
        }
        Update: {
          body_part?: string | null
          code?: string
          contrast_required?: boolean | null
          contrast_type?: string | null
          cpt_code?: string | null
          created_at?: string | null
          estimated_duration?: number | null
          icd_codes?: string[] | null
          id?: string
          is_active?: boolean | null
          modality_id?: string | null
          name?: string
          preparation_instructions?: string | null
          price?: number | null
          procedure_steps?: string | null
          radiation_dose?: number | null
          study_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "radiology_procedures_modality_id_fkey"
            columns: ["modality_id"]
            isOneToOne: false
            referencedRelation: "radiology_modalities"
            referencedColumns: ["id"]
          },
        ]
      }
      radiology_qa_checks: {
        Row: {
          corrective_action: string | null
          created_at: string | null
          deviation_percentage: number | null
          documentation_path: string | null
          id: string
          measured_values: Json | null
          modality_id: string | null
          next_test_date: string | null
          pass_fail_status: string | null
          performed_by: string | null
          phantom_used: string | null
          qa_type: string
          reference_values: Json | null
          supervisor_comments: string | null
          supervisor_review: boolean | null
          test_date: string
          test_name: string
          test_parameters: Json | null
          tolerance_limits: Json | null
          updated_at: string | null
        }
        Insert: {
          corrective_action?: string | null
          created_at?: string | null
          deviation_percentage?: number | null
          documentation_path?: string | null
          id?: string
          measured_values?: Json | null
          modality_id?: string | null
          next_test_date?: string | null
          pass_fail_status?: string | null
          performed_by?: string | null
          phantom_used?: string | null
          qa_type: string
          reference_values?: Json | null
          supervisor_comments?: string | null
          supervisor_review?: boolean | null
          test_date: string
          test_name: string
          test_parameters?: Json | null
          tolerance_limits?: Json | null
          updated_at?: string | null
        }
        Update: {
          corrective_action?: string | null
          created_at?: string | null
          deviation_percentage?: number | null
          documentation_path?: string | null
          id?: string
          measured_values?: Json | null
          modality_id?: string | null
          next_test_date?: string | null
          pass_fail_status?: string | null
          performed_by?: string | null
          phantom_used?: string | null
          qa_type?: string
          reference_values?: Json | null
          supervisor_comments?: string | null
          supervisor_review?: boolean | null
          test_date?: string
          test_name?: string
          test_parameters?: Json | null
          tolerance_limits?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "radiology_qa_checks_modality_id_fkey"
            columns: ["modality_id"]
            isOneToOne: false
            referencedRelation: "radiology_modalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radiology_qa_checks_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "radiology_technologists"
            referencedColumns: ["id"]
          },
        ]
      }
      radiology_reports: {
        Row: {
          amended_at: string | null
          amendment_reason: string | null
          clinical_information: string | null
          comparison_studies: string | null
          created_at: string | null
          critical_findings: string | null
          critical_notification_time: string | null
          critical_notified: boolean | null
          critical_notified_to: string | null
          dictated_at: string | null
          final_report_time: string | null
          findings: string
          id: string
          impression: string
          order_id: string | null
          patient_id: string
          preliminary_radiologist_id: string | null
          preliminary_report_time: string | null
          priority: string | null
          radiologist_id: string | null
          recommendations: string | null
          report_number: string
          report_status: string | null
          signed_at: string | null
          structured_reporting: Json | null
          study_id: string | null
          technique: string | null
          template_used: string | null
          turnaround_time_minutes: number | null
          updated_at: string | null
          word_count: number | null
        }
        Insert: {
          amended_at?: string | null
          amendment_reason?: string | null
          clinical_information?: string | null
          comparison_studies?: string | null
          created_at?: string | null
          critical_findings?: string | null
          critical_notification_time?: string | null
          critical_notified?: boolean | null
          critical_notified_to?: string | null
          dictated_at?: string | null
          final_report_time?: string | null
          findings: string
          id?: string
          impression: string
          order_id?: string | null
          patient_id: string
          preliminary_radiologist_id?: string | null
          preliminary_report_time?: string | null
          priority?: string | null
          radiologist_id?: string | null
          recommendations?: string | null
          report_number: string
          report_status?: string | null
          signed_at?: string | null
          structured_reporting?: Json | null
          study_id?: string | null
          technique?: string | null
          template_used?: string | null
          turnaround_time_minutes?: number | null
          updated_at?: string | null
          word_count?: number | null
        }
        Update: {
          amended_at?: string | null
          amendment_reason?: string | null
          clinical_information?: string | null
          comparison_studies?: string | null
          created_at?: string | null
          critical_findings?: string | null
          critical_notification_time?: string | null
          critical_notified?: boolean | null
          critical_notified_to?: string | null
          dictated_at?: string | null
          final_report_time?: string | null
          findings?: string
          id?: string
          impression?: string
          order_id?: string | null
          patient_id?: string
          preliminary_radiologist_id?: string | null
          preliminary_report_time?: string | null
          priority?: string | null
          radiologist_id?: string | null
          recommendations?: string | null
          report_number?: string
          report_status?: string | null
          signed_at?: string | null
          structured_reporting?: Json | null
          study_id?: string | null
          technique?: string | null
          template_used?: string | null
          turnaround_time_minutes?: number | null
          updated_at?: string | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "radiology_reports_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "radiology_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radiology_reports_preliminary_radiologist_id_fkey"
            columns: ["preliminary_radiologist_id"]
            isOneToOne: false
            referencedRelation: "radiologists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radiology_reports_radiologist_id_fkey"
            columns: ["radiologist_id"]
            isOneToOne: false
            referencedRelation: "radiologists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radiology_reports_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "dicom_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      radiology_technologists: {
        Row: {
          certified_modalities: string[] | null
          created_at: string | null
          email: string | null
          employee_id: string | null
          first_name: string
          hire_date: string | null
          id: string
          is_active: boolean | null
          last_name: string
          license_number: string | null
          phone: string | null
          shift_timings: Json | null
          updated_at: string | null
        }
        Insert: {
          certified_modalities?: string[] | null
          created_at?: string | null
          email?: string | null
          employee_id?: string | null
          first_name: string
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_name: string
          license_number?: string | null
          phone?: string | null
          shift_timings?: Json | null
          updated_at?: string | null
        }
        Update: {
          certified_modalities?: string[] | null
          created_at?: string | null
          email?: string | null
          employee_id?: string | null
          first_name?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_name?: string
          license_number?: string | null
          phone?: string | null
          shift_timings?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      referee_doa_payments: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          notes: string | null
          payment_date: string | null
          referral_payment_status: string | null
          visit_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string | null
          referral_payment_status?: string | null
          visit_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string | null
          referral_payment_status?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referee_doa_payments_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      referees: {
        Row: {
          contact_info: string | null
          created_at: string
          id: string
          institution: string | null
          name: string
          specialty: string | null
          updated_at: string
        }
        Insert: {
          contact_info?: string | null
          created_at?: string
          id?: string
          institution?: string | null
          name: string
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          contact_info?: string | null
          created_at?: string
          id?: string
          institution?: string | null
          name?: string
          specialty?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      referral_register: {
        Row: {
          consultant: string | null
          created_at: string
          date_of_registration: string | null
          id: string
          paid_amount: number
          patient_name: string
          referral_amount: number
          referral_name: string | null
          sort_order: number
          total_paid_amount: number
          updated_at: string
        }
        Insert: {
          consultant?: string | null
          created_at?: string
          date_of_registration?: string | null
          id?: string
          paid_amount?: number
          patient_name?: string
          referral_amount?: number
          referral_name?: string | null
          sort_order?: number
          total_paid_amount?: number
          updated_at?: string
        }
        Update: {
          consultant?: string | null
          created_at?: string
          date_of_registration?: string | null
          id?: string
          paid_amount?: number
          patient_name?: string
          referral_amount?: number
          referral_name?: string | null
          sort_order?: number
          total_paid_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      relationship_managers: {
        Row: {
          code: string | null
          contact_no: string | null
          created_at: string | null
          id: string
          is_hidden: boolean
          name: string
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          contact_no?: string | null
          created_at?: string | null
          id?: string
          is_hidden?: boolean
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          contact_no?: string | null
          created_at?: string | null
          id?: string
          is_hidden?: boolean
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      requisitions: {
        Row: {
          clinical_history: string | null
          clinical_indication: string | null
          created_at: string | null
          diagnosis: string | null
          fasting_required: boolean | null
          id: string
          internal_notes: string | null
          lab_test_costs: number[] | null
          lab_test_names: string[] | null
          order_date: string | null
          ordering_department: string | null
          ordering_physician: string | null
          patient_id: string
          patient_instructions: string | null
          priority: string | null
          radiology_test_costs: number[] | null
          radiology_test_names: string[] | null
          requisition_number: string
          requisition_type: string
          sample_type: string | null
          status: string | null
          total_cost: number | null
          updated_at: string | null
        }
        Insert: {
          clinical_history?: string | null
          clinical_indication?: string | null
          created_at?: string | null
          diagnosis?: string | null
          fasting_required?: boolean | null
          id?: string
          internal_notes?: string | null
          lab_test_costs?: number[] | null
          lab_test_names?: string[] | null
          order_date?: string | null
          ordering_department?: string | null
          ordering_physician?: string | null
          patient_id: string
          patient_instructions?: string | null
          priority?: string | null
          radiology_test_costs?: number[] | null
          radiology_test_names?: string[] | null
          requisition_number: string
          requisition_type: string
          sample_type?: string | null
          status?: string | null
          total_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          clinical_history?: string | null
          clinical_indication?: string | null
          created_at?: string | null
          diagnosis?: string | null
          fasting_required?: boolean | null
          id?: string
          internal_notes?: string | null
          lab_test_costs?: number[] | null
          lab_test_names?: string[] | null
          order_date?: string | null
          ordering_department?: string | null
          ordering_physician?: string | null
          patient_id?: string
          patient_instructions?: string | null
          priority?: string | null
          radiology_test_costs?: number[] | null
          radiology_test_names?: string[] | null
          requisition_number?: string
          requisition_type?: string
          sample_type?: string | null
          status?: string | null
          total_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requisitions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisitions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      room_management: {
        Row: {
          created_at: string | null
          hospital_name: string | null
          id: string
          location: string
          maximum_rooms: number
          updated_at: string | null
          ward_id: string
          ward_type: string
        }
        Insert: {
          created_at?: string | null
          hospital_name?: string | null
          id?: string
          location: string
          maximum_rooms: number
          updated_at?: string | null
          ward_id: string
          ward_type: string
        }
        Update: {
          created_at?: string | null
          hospital_name?: string | null
          id?: string
          location?: string
          maximum_rooms?: number
          updated_at?: string | null
          ward_id?: string
          ward_type?: string
        }
        Relationships: []
      }
      staff_attendance: {
        Row: {
          check_in_at: string | null
          check_out_at: string | null
          created_at: string | null
          department: string | null
          duration_minutes: number | null
          employee_id: string | null
          employee_name: string
          id: string
          notes: string | null
          shift_type: string | null
          status: string | null
          work_date: string
        }
        Insert: {
          check_in_at?: string | null
          check_out_at?: string | null
          created_at?: string | null
          department?: string | null
          duration_minutes?: number | null
          employee_id?: string | null
          employee_name: string
          id?: string
          notes?: string | null
          shift_type?: string | null
          status?: string | null
          work_date?: string
        }
        Update: {
          check_in_at?: string | null
          check_out_at?: string | null
          created_at?: string | null
          department?: string | null
          duration_minutes?: number | null
          employee_id?: string | null
          employee_name?: string
          id?: string
          notes?: string | null
          shift_type?: string | null
          status?: string | null
          work_date?: string
        }
        Relationships: []
      }
      staff_members: {
        Row: {
          availability_status: string
          created_at: string | null
          current_assignment: string | null
          id: string
          name: string
          role: string
          shift_end: string
          shift_start: string
          specialization: string | null
          updated_at: string | null
        }
        Insert: {
          availability_status?: string
          created_at?: string | null
          current_assignment?: string | null
          id?: string
          name: string
          role: string
          shift_end: string
          shift_start: string
          specialization?: string | null
          updated_at?: string | null
        }
        Update: {
          availability_status?: string
          created_at?: string | null
          current_assignment?: string | null
          id?: string
          name?: string
          role?: string
          shift_end?: string
          shift_start?: string
          specialization?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      step_progress: {
        Row: {
          account_id: string
          completed_at: string | null
          id: string
          payload: Json | null
          started_at: string | null
          status: string
          step_number: number
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          id?: string
          payload?: Json | null
          started_at?: string | null
          status: string
          step_number: number
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          id?: string
          payload?: Json | null
          started_at?: string | null
          status?: string
          step_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "step_progress_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "client_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transactions: {
        Row: {
          created_at: string | null
          id: string
          inventory_item_id: string | null
          new_stock: number
          notes: string | null
          performed_by: string
          previous_stock: number
          quantity_change: number
          reference_id: string | null
          total_cost: number | null
          transaction_type: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          inventory_item_id?: string | null
          new_stock: number
          notes?: string | null
          performed_by: string
          previous_stock: number
          quantity_change: number
          reference_id?: string | null
          total_cost?: number | null
          transaction_type: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          inventory_item_id?: string | null
          new_stock?: number
          notes?: string | null
          performed_by?: string
          previous_stock?: number
          quantity_change?: number
          reference_id?: string | null
          total_cost?: number | null
          transaction_type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transactions_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transactions_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_status"
            referencedColumns: ["id"]
          },
        ]
      }
      stretch_badges: {
        Row: {
          account_id: string
          awarded_at: string | null
          badge_slug: string
          id: string
        }
        Insert: {
          account_id: string
          awarded_at?: string | null
          badge_slug: string
          id?: string
        }
        Update: {
          account_id?: string
          awarded_at?: string | null
          badge_slug?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stretch_badges_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "client_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          account_group: string | null
          address: string | null
          bank_or_branch: string | null
          created_at: string | null
          credit_day: number | null
          credit_limit: number | null
          cst: string | null
          dl_no: string | null
          email: string | null
          id: number
          mobile: string | null
          phone: string | null
          pin: string | null
          s_tax_no: string | null
          supplier_code: string
          supplier_name: string
          supplier_type: string | null
          updated_at: string | null
        }
        Insert: {
          account_group?: string | null
          address?: string | null
          bank_or_branch?: string | null
          created_at?: string | null
          credit_day?: number | null
          credit_limit?: number | null
          cst?: string | null
          dl_no?: string | null
          email?: string | null
          id?: number
          mobile?: string | null
          phone?: string | null
          pin?: string | null
          s_tax_no?: string | null
          supplier_code: string
          supplier_name: string
          supplier_type?: string | null
          updated_at?: string | null
        }
        Update: {
          account_group?: string | null
          address?: string | null
          bank_or_branch?: string | null
          created_at?: string | null
          credit_day?: number | null
          credit_limit?: number | null
          cst?: string | null
          dl_no?: string | null
          email?: string | null
          id?: number
          mobile?: string | null
          phone?: string | null
          pin?: string | null
          s_tax_no?: string | null
          supplier_code?: string
          supplier_name?: string
          supplier_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      surgical_billing: {
        Row: {
          claim_id: string | null
          corporate_type: string
          created_at: string | null
          id: string
          patient_id: string | null
          presurgical_date_from: string | null
          presurgical_date_to: string | null
          section_visibility: Json | null
          surgical_conservative_date_from: string | null
          surgical_conservative_date_to: string | null
          surgical_package_date_from: string | null
          surgical_package_date_to: string | null
          updated_at: string | null
        }
        Insert: {
          claim_id?: string | null
          corporate_type?: string
          created_at?: string | null
          id?: string
          patient_id?: string | null
          presurgical_date_from?: string | null
          presurgical_date_to?: string | null
          section_visibility?: Json | null
          surgical_conservative_date_from?: string | null
          surgical_conservative_date_to?: string | null
          surgical_package_date_from?: string | null
          surgical_package_date_to?: string | null
          updated_at?: string | null
        }
        Update: {
          claim_id?: string | null
          corporate_type?: string
          created_at?: string | null
          id?: string
          patient_id?: string | null
          presurgical_date_from?: string | null
          presurgical_date_to?: string | null
          section_visibility?: Json | null
          surgical_conservative_date_from?: string | null
          surgical_conservative_date_to?: string | null
          surgical_package_date_from?: string | null
          surgical_package_date_to?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "surgical_billing_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surgical_billing_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      surgical_treatments: {
        Row: {
          adjustment_type: string
          adjustment_value: number
          amount: number
          base_amount: number
          created_at: string | null
          final_amount: number
          id: string
          quantity: number
          sort_order: number
          surgery_name: string
          surgical_billing_id: string | null
          updated_at: string | null
          visible: boolean
        }
        Insert: {
          adjustment_type?: string
          adjustment_value?: number
          amount?: number
          base_amount?: number
          created_at?: string | null
          final_amount?: number
          id?: string
          quantity?: number
          sort_order?: number
          surgery_name: string
          surgical_billing_id?: string | null
          updated_at?: string | null
          visible?: boolean
        }
        Update: {
          adjustment_type?: string
          adjustment_value?: number
          amount?: number
          base_amount?: number
          created_at?: string | null
          final_amount?: number
          id?: string
          quantity?: number
          sort_order?: number
          surgery_name?: string
          surgical_billing_id?: string | null
          updated_at?: string | null
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "surgical_treatments_surgical_billing_id_fkey"
            columns: ["surgical_billing_id"]
            isOneToOne: false
            referencedRelation: "surgical_billing"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_bank_statements: {
        Row: {
          balance: number | null
          bank_ledger: string
          company_id: string | null
          date: string
          deposit: number | null
          description: string | null
          id: string
          match_status: string | null
          matched_voucher_id: string | null
          reference: string | null
          uploaded_at: string | null
          withdrawal: number | null
        }
        Insert: {
          balance?: number | null
          bank_ledger: string
          company_id?: string | null
          date: string
          deposit?: number | null
          description?: string | null
          id?: string
          match_status?: string | null
          matched_voucher_id?: string | null
          reference?: string | null
          uploaded_at?: string | null
          withdrawal?: number | null
        }
        Update: {
          balance?: number | null
          bank_ledger?: string
          company_id?: string | null
          date?: string
          deposit?: number | null
          description?: string | null
          id?: string
          match_status?: string | null
          matched_voucher_id?: string | null
          reference?: string | null
          uploaded_at?: string | null
          withdrawal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_bank_statements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_bank_statements_matched_voucher_id_fkey"
            columns: ["matched_voucher_id"]
            isOneToOne: false
            referencedRelation: "tally_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_config: {
        Row: {
          auto_sync_enabled: boolean | null
          company_name: string
          created_at: string | null
          hospital_id: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          metadata: Json | null
          server_url: string
          sync_interval_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          auto_sync_enabled?: boolean | null
          company_name: string
          created_at?: string | null
          hospital_id?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          metadata?: Json | null
          server_url?: string
          sync_interval_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          auto_sync_enabled?: boolean | null
          company_name?: string
          created_at?: string | null
          hospital_id?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          metadata?: Json | null
          server_url?: string
          sync_interval_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      tally_cost_centres: {
        Row: {
          adamrit_department_id: string | null
          category: string | null
          company_id: string | null
          created_at: string | null
          id: string
          last_synced_at: string | null
          name: string
          parent: string | null
          raw_data: Json | null
          tally_guid: string | null
        }
        Insert: {
          adamrit_department_id?: string | null
          category?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string
          last_synced_at?: string | null
          name: string
          parent?: string | null
          raw_data?: Json | null
          tally_guid?: string | null
        }
        Update: {
          adamrit_department_id?: string | null
          category?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string
          parent?: string | null
          raw_data?: Json | null
          tally_guid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_cost_centres_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_groups: {
        Row: {
          company_id: string | null
          created_at: string | null
          id: string
          is_deemed_positive: boolean | null
          is_revenue: boolean | null
          last_synced_at: string | null
          name: string
          nature_of_group: string | null
          parent_group: string | null
          raw_data: Json | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          is_deemed_positive?: boolean | null
          is_revenue?: boolean | null
          last_synced_at?: string | null
          name: string
          nature_of_group?: string | null
          parent_group?: string | null
          raw_data?: Json | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          is_deemed_positive?: boolean | null
          is_revenue?: boolean | null
          last_synced_at?: string | null
          name?: string
          nature_of_group?: string | null
          parent_group?: string | null
          raw_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_groups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_gst_data: {
        Row: {
          company_id: string | null
          data: Json
          fetched_at: string | null
          id: string
          period_from: string | null
          period_to: string | null
          report_type: string
        }
        Insert: {
          company_id?: string | null
          data: Json
          fetched_at?: string | null
          id?: string
          period_from?: string | null
          period_to?: string | null
          report_type: string
        }
        Update: {
          company_id?: string | null
          data?: Json
          fetched_at?: string | null
          id?: string
          period_from?: string | null
          period_to?: string | null
          report_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tally_gst_data_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_ledger_mapping: {
        Row: {
          adamrit_entity_name: string
          adamrit_entity_type: string
          company_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          tally_group: string | null
          tally_ledger_name: string
          updated_at: string | null
        }
        Insert: {
          adamrit_entity_name: string
          adamrit_entity_type: string
          company_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          tally_group?: string | null
          tally_ledger_name: string
          updated_at?: string | null
        }
        Update: {
          adamrit_entity_name?: string
          adamrit_entity_type?: string
          company_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          tally_group?: string | null
          tally_ledger_name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_ledger_mapping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_ledgers: {
        Row: {
          adamrit_entity_id: string | null
          adamrit_entity_type: string | null
          address: string | null
          closing_balance: number | null
          company_id: string | null
          created_at: string | null
          email: string | null
          gst_number: string | null
          id: string
          is_hidden: boolean | null
          is_mapped: boolean | null
          last_synced_at: string | null
          ledger_type: string | null
          name: string
          opening_balance: number | null
          pan_number: string | null
          parent_group: string | null
          phone: string | null
          raw_data: Json | null
          tally_guid: string | null
          updated_at: string | null
        }
        Insert: {
          adamrit_entity_id?: string | null
          adamrit_entity_type?: string | null
          address?: string | null
          closing_balance?: number | null
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          is_hidden?: boolean | null
          is_mapped?: boolean | null
          last_synced_at?: string | null
          ledger_type?: string | null
          name: string
          opening_balance?: number | null
          pan_number?: string | null
          parent_group?: string | null
          phone?: string | null
          raw_data?: Json | null
          tally_guid?: string | null
          updated_at?: string | null
        }
        Update: {
          adamrit_entity_id?: string | null
          adamrit_entity_type?: string | null
          address?: string | null
          closing_balance?: number | null
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          gst_number?: string | null
          id?: string
          is_hidden?: boolean | null
          is_mapped?: boolean | null
          last_synced_at?: string | null
          ledger_type?: string | null
          name?: string
          opening_balance?: number | null
          pan_number?: string | null
          parent_group?: string | null
          phone?: string | null
          raw_data?: Json | null
          tally_guid?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_ledgers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_push_queue: {
        Row: {
          company_id: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          last_error: string | null
          last_retry_at: string | null
          max_retries: number | null
          next_retry_at: string | null
          payload: Json
          push_action: string
          push_type: string
          reference_id: string | null
          retry_count: number | null
          status: string | null
        }
        Insert: {
          company_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          last_error?: string | null
          last_retry_at?: string | null
          max_retries?: number | null
          next_retry_at?: string | null
          payload: Json
          push_action: string
          push_type: string
          reference_id?: string | null
          retry_count?: number | null
          status?: string | null
        }
        Update: {
          company_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          last_error?: string | null
          last_retry_at?: string | null
          max_retries?: number | null
          next_retry_at?: string | null
          payload?: Json
          push_action?: string
          push_type?: string
          reference_id?: string | null
          retry_count?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_push_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_reports: {
        Row: {
          company_id: string | null
          data: Json
          fetched_at: string | null
          id: string
          period_from: string | null
          period_to: string | null
          report_date: string | null
          report_type: string
        }
        Insert: {
          company_id?: string | null
          data: Json
          fetched_at?: string | null
          id?: string
          period_from?: string | null
          period_to?: string | null
          report_date?: string | null
          report_type: string
        }
        Update: {
          company_id?: string | null
          data?: Json
          fetched_at?: string | null
          id?: string
          period_from?: string | null
          period_to?: string | null
          report_date?: string | null
          report_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tally_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_stock_items: {
        Row: {
          closing_balance: number | null
          closing_value: number | null
          company_id: string | null
          created_at: string | null
          gst_rate: number | null
          hsn_code: string | null
          id: string
          last_synced_at: string | null
          name: string
          opening_balance: number | null
          opening_value: number | null
          rate: number | null
          raw_data: Json | null
          stock_group: string | null
          tally_guid: string | null
          unit: string | null
        }
        Insert: {
          closing_balance?: number | null
          closing_value?: number | null
          company_id?: string | null
          created_at?: string | null
          gst_rate?: number | null
          hsn_code?: string | null
          id?: string
          last_synced_at?: string | null
          name: string
          opening_balance?: number | null
          opening_value?: number | null
          rate?: number | null
          raw_data?: Json | null
          stock_group?: string | null
          tally_guid?: string | null
          unit?: string | null
        }
        Update: {
          closing_balance?: number | null
          closing_value?: number | null
          company_id?: string | null
          created_at?: string | null
          gst_rate?: number | null
          hsn_code?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string
          opening_balance?: number | null
          opening_value?: number | null
          rate?: number | null
          raw_data?: Json | null
          stock_group?: string | null
          tally_guid?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_stock_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_sync_log: {
        Row: {
          company_id: string | null
          completed_at: string | null
          direction: string
          duration_ms: number | null
          error_details: Json | null
          id: string
          records_failed: number | null
          records_synced: number | null
          started_at: string | null
          status: string
          sync_type: string
        }
        Insert: {
          company_id?: string | null
          completed_at?: string | null
          direction: string
          duration_ms?: number | null
          error_details?: Json | null
          id?: string
          records_failed?: number | null
          records_synced?: number | null
          started_at?: string | null
          status: string
          sync_type: string
        }
        Update: {
          company_id?: string | null
          completed_at?: string | null
          direction?: string
          duration_ms?: number | null
          error_details?: Json | null
          id?: string
          records_failed?: number | null
          records_synced?: number | null
          started_at?: string | null
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tally_sync_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_vouchers: {
        Row: {
          adamrit_bill_id: string | null
          adamrit_payment_id: string | null
          amount: number
          company_id: string | null
          created_at: string | null
          date: string
          error_message: string | null
          id: string
          is_cancelled: boolean | null
          ledger_entries: Json | null
          narration: string | null
          party_ledger: string | null
          raw_data: Json | null
          sync_direction: string | null
          sync_status: string | null
          synced_at: string | null
          tally_guid: string | null
          voucher_number: string | null
          voucher_type: string
        }
        Insert: {
          adamrit_bill_id?: string | null
          adamrit_payment_id?: string | null
          amount: number
          company_id?: string | null
          created_at?: string | null
          date: string
          error_message?: string | null
          id?: string
          is_cancelled?: boolean | null
          ledger_entries?: Json | null
          narration?: string | null
          party_ledger?: string | null
          raw_data?: Json | null
          sync_direction?: string | null
          sync_status?: string | null
          synced_at?: string | null
          tally_guid?: string | null
          voucher_number?: string | null
          voucher_type: string
        }
        Update: {
          adamrit_bill_id?: string | null
          adamrit_payment_id?: string | null
          amount?: number
          company_id?: string | null
          created_at?: string | null
          date?: string
          error_message?: string | null
          id?: string
          is_cancelled?: boolean | null
          ledger_entries?: Json | null
          narration?: string | null
          party_ledger?: string | null
          raw_data?: Json | null
          sync_direction?: string | null
          sync_status?: string | null
          synced_at?: string | null
          tally_guid?: string | null
          voucher_number?: string | null
          voucher_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tally_vouchers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tally_config"
            referencedColumns: ["id"]
          },
        ]
      }
      team_resources: {
        Row: {
          created_at: string
          description: string | null
          file_path: string
          folder: string
          hidden: boolean
          id: string
          mime: string | null
          share_token: string
          size_bytes: number | null
          title: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          file_path: string
          folder?: string
          hidden?: boolean
          id?: string
          mime?: string | null
          share_token?: string
          size_bytes?: number | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          file_path?: string
          folder?: string
          hidden?: boolean
          id?: string
          mime?: string | null
          share_token?: string
          size_bytes?: number | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      technicians: {
        Row: {
          created_at: string | null
          email: string | null
          employee_id: string
          id: string
          is_active: boolean | null
          name: string
          phone: string | null
          role: string | null
          specialization: string[] | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          employee_id: string
          id?: string
          is_active?: boolean | null
          name: string
          phone?: string | null
          role?: string | null
          specialization?: string[] | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          phone?: string | null
          role?: string | null
          specialization?: string[] | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "technicians_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      test_categories: {
        Row: {
          category_code: string
          category_name: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          parent_category_id: string | null
          updated_at: string | null
        }
        Insert: {
          category_code: string
          category_name: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          parent_category_id?: string | null
          updated_at?: string | null
        }
        Update: {
          category_code?: string
          category_name?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          parent_category_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "test_categories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "test_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      test_panels: {
        Row: {
          category_id: string | null
          created_at: string | null
          department_id: string | null
          description: string | null
          discount_percentage: number | null
          id: string
          is_active: boolean | null
          panel_code: string
          panel_name: string
          panel_price: number | null
          updated_at: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          discount_percentage?: number | null
          id?: string
          is_active?: boolean | null
          panel_code: string
          panel_name: string
          panel_price?: number | null
          updated_at?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          discount_percentage?: number | null
          id?: string
          is_active?: boolean | null
          panel_code?: string
          panel_name?: string
          panel_price?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "test_panels_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "test_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_panels_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "lab_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      User: {
        Row: {
          company_id: string | null
          created_at: string | null
          department: string | null
          designation: string | null
          email: string
          full_name: string | null
          hospital_type: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          must_change_password: boolean | null
          password: string
          password_changed_at: string | null
          phone: string | null
          profile_photo: string | null
          role: string
          staff_pin: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          department?: string | null
          designation?: string | null
          email: string
          full_name?: string | null
          hospital_type?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          must_change_password?: boolean | null
          password: string
          password_changed_at?: string | null
          phone?: string | null
          profile_photo?: string | null
          role?: string
          staff_pin?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          department?: string | null
          designation?: string | null
          email?: string
          full_name?: string | null
          hospital_type?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          must_change_password?: boolean | null
          password?: string
          password_changed_at?: string | null
          phone?: string | null
          profile_photo?: string | null
          role?: string
          staff_pin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "User_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          hospital_type: string | null
          id: string
          ip_address: string | null
          page: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
          user_role: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          hospital_type?: string | null
          id?: string
          ip_address?: string | null
          page?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          hospital_type?: string | null
          id?: string
          ip_address?: string | null
          page?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Relationships: []
      }
      vendors: {
        Row: {
          address: string | null
          company_name: string
          contact_person: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          phone: string | null
          service_areas: string[] | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          company_name: string
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          phone?: string | null
          service_areas?: string[] | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          company_name?: string
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          phone?: string | null
          service_areas?: string[] | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      visit_accommodations: {
        Row: {
          accommodation_id: string
          amount: number
          created_at: string | null
          days: number | null
          end_date: string
          id: string
          rate_type: string
          rate_used: number
          selected_at: string | null
          source: string | null
          start_date: string
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          accommodation_id: string
          amount: number
          created_at?: string | null
          days?: number | null
          end_date: string
          id?: string
          rate_type: string
          rate_used: number
          selected_at?: string | null
          source?: string | null
          start_date: string
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          accommodation_id?: string
          amount?: number
          created_at?: string | null
          days?: number | null
          end_date?: string
          id?: string
          rate_type?: string
          rate_used?: number
          selected_at?: string | null
          source?: string | null
          start_date?: string
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_accommodations_accommodation_id_fkey"
            columns: ["accommodation_id"]
            isOneToOne: false
            referencedRelation: "accommodations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_accommodations_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_anesthetists: {
        Row: {
          anesthetist_name: string
          anesthetist_type: string | null
          created_at: string | null
          id: string
          ot_charges: number | null
          rate: number | null
          visit_id: string
        }
        Insert: {
          anesthetist_name: string
          anesthetist_type?: string | null
          created_at?: string | null
          id?: string
          ot_charges?: number | null
          rate?: number | null
          visit_id: string
        }
        Update: {
          anesthetist_name?: string
          anesthetist_type?: string | null
          created_at?: string | null
          id?: string
          ot_charges?: number | null
          rate?: number | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_anesthetists_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_clinical_services: {
        Row: {
          amount: number
          clinical_service_id: string
          created_at: string | null
          end_date: string | null
          external_requisition: string | null
          id: string
          quantity: number | null
          rate_type: string
          rate_used: number
          selected_at: string | null
          start_date: string | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          amount: number
          clinical_service_id: string
          created_at?: string | null
          end_date?: string | null
          external_requisition?: string | null
          id?: string
          quantity?: number | null
          rate_type: string
          rate_used: number
          selected_at?: string | null
          start_date?: string | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          amount?: number
          clinical_service_id?: string
          created_at?: string | null
          end_date?: string | null
          external_requisition?: string | null
          id?: string
          quantity?: number | null
          rate_type?: string
          rate_used?: number
          selected_at?: string | null
          start_date?: string | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_clinical_services_clinical_service_id_fkey"
            columns: ["clinical_service_id"]
            isOneToOne: false
            referencedRelation: "clinical_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_clinical_services_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_complications: {
        Row: {
          complication_id: string | null
          id: string
          visit_id: string | null
        }
        Insert: {
          complication_id?: string | null
          id?: string
          visit_id?: string | null
        }
        Update: {
          complication_id?: string | null
          id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_complications_complication_id_fkey"
            columns: ["complication_id"]
            isOneToOne: false
            referencedRelation: "complications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_complications_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_consultants: {
        Row: {
          consultant_id: string | null
          id: string
          visit_id: string | null
        }
        Insert: {
          consultant_id?: string | null
          id?: string
          visit_id?: string | null
        }
        Update: {
          consultant_id?: string | null
          id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_consultants_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "referees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_consultants_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_diagnoses: {
        Row: {
          created_at: string | null
          diagnosis_id: string
          id: string
          is_primary: boolean | null
          notes: string | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          created_at?: string | null
          diagnosis_id: string
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          created_at?: string | null
          diagnosis_id?: string
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_diagnoses_diagnosis_id_fkey"
            columns: ["diagnosis_id"]
            isOneToOne: false
            referencedRelation: "diagnoses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_diagnoses_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_discounts: {
        Row: {
          applied_by: string | null
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          discount_amount: number
          discount_reason: string | null
          hospital_name: string | null
          id: string
          rejection_reason: string | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          applied_by?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          discount_amount?: number
          discount_reason?: string | null
          hospital_name?: string | null
          id?: string
          rejection_reason?: string | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          applied_by?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          discount_amount?: number
          discount_reason?: string | null
          hospital_name?: string | null
          id?: string
          rejection_reason?: string | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_discounts_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_esic_surgeons: {
        Row: {
          created_at: string | null
          id: string
          surgeon_id: string
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          surgeon_id: string
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          surgeon_id?: string
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_esic_surgeons_surgeon_id_fkey"
            columns: ["surgeon_id"]
            isOneToOne: false
            referencedRelation: "esic_surgeons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_esic_surgeons_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_hope_consultants: {
        Row: {
          consultant_id: string
          created_at: string | null
          id: string
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          consultant_id: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          consultant_id?: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_hope_consultants_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "hope_consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_hope_consultants_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_hope_surgeons: {
        Row: {
          created_at: string | null
          id: string
          surgeon_id: string
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          surgeon_id: string
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          surgeon_id?: string
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_hope_surgeons_surgeon_id_fkey"
            columns: ["surgeon_id"]
            isOneToOne: false
            referencedRelation: "hope_surgeons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_hope_surgeons_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_implants: {
        Row: {
          amount: number
          created_at: string | null
          created_by: string | null
          id: string
          implant_id: string
          implant_name: string
          quantity: number
          rate: number
          rate_type: string | null
          remarks: string | null
          status: string | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          implant_id: string
          implant_name: string
          quantity?: number
          rate?: number
          rate_type?: string | null
          remarks?: string | null
          status?: string | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          implant_id?: string
          implant_name?: string
          quantity?: number
          rate?: number
          rate_type?: string | null
          remarks?: string | null
          status?: string | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_implants_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_labs: {
        Row: {
          collected_date: string | null
          completed_date: string | null
          cost: number | null
          created_at: string | null
          id: string
          is_hidden: boolean | null
          lab_id: string
          normal_range: string | null
          notes: string | null
          ordered_date: string | null
          printed_at: string | null
          quantity: number
          result_value: string | null
          status: string | null
          unit_rate: number | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          collected_date?: string | null
          completed_date?: string | null
          cost?: number | null
          created_at?: string | null
          id?: string
          is_hidden?: boolean | null
          lab_id: string
          normal_range?: string | null
          notes?: string | null
          ordered_date?: string | null
          printed_at?: string | null
          quantity?: number
          result_value?: string | null
          status?: string | null
          unit_rate?: number | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          collected_date?: string | null
          completed_date?: string | null
          cost?: number | null
          created_at?: string | null
          id?: string
          is_hidden?: boolean | null
          lab_id?: string
          normal_range?: string | null
          notes?: string | null
          ordered_date?: string | null
          printed_at?: string | null
          quantity?: number
          result_value?: string | null
          status?: string | null
          unit_rate?: number | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_labs_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "lab"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_labs_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_mandatory_services: {
        Row: {
          amount: number
          created_at: string | null
          end_date: string | null
          external_requisition: string | null
          id: string
          mandatory_service_id: string
          quantity: number | null
          rate_type: string
          rate_used: number
          selected_at: string | null
          start_date: string | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          end_date?: string | null
          external_requisition?: string | null
          id?: string
          mandatory_service_id: string
          quantity?: number | null
          rate_type: string
          rate_used: number
          selected_at?: string | null
          start_date?: string | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          end_date?: string | null
          external_requisition?: string | null
          id?: string
          mandatory_service_id?: string
          quantity?: number | null
          rate_type?: string
          rate_used?: number
          selected_at?: string | null
          start_date?: string | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_mandatory_services_mandatory_service_id_fkey"
            columns: ["mandatory_service_id"]
            isOneToOne: false
            referencedRelation: "mandatory_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_mandatory_services_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_medical_data: {
        Row: {
          allergies: string | null
          created_at: string | null
          current_medications: string | null
          examination_findings: string | null
          id: string
          medical_history: string | null
          notes: string | null
          primary_diagnosis: string | null
          secondary_diagnosis: string | null
          symptoms: string | null
          treatment_plan: string | null
          updated_at: string | null
          visit_id: string
          vital_signs: Json | null
        }
        Insert: {
          allergies?: string | null
          created_at?: string | null
          current_medications?: string | null
          examination_findings?: string | null
          id?: string
          medical_history?: string | null
          notes?: string | null
          primary_diagnosis?: string | null
          secondary_diagnosis?: string | null
          symptoms?: string | null
          treatment_plan?: string | null
          updated_at?: string | null
          visit_id: string
          vital_signs?: Json | null
        }
        Update: {
          allergies?: string | null
          created_at?: string | null
          current_medications?: string | null
          examination_findings?: string | null
          id?: string
          medical_history?: string | null
          notes?: string | null
          primary_diagnosis?: string | null
          secondary_diagnosis?: string | null
          symptoms?: string | null
          treatment_plan?: string | null
          updated_at?: string | null
          visit_id?: string
          vital_signs?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_medical_data_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: true
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_medications: {
        Row: {
          approved_at: string | null
          created_at: string | null
          custom_medication_name: string | null
          dispensed_at: string | null
          dispensed_by: string | null
          dispensed_medication_id: string | null
          dispensed_medication_name: string | null
          dosage: string | null
          duration: string | null
          end_date: string | null
          frequency: string | null
          id: string
          is_approved: boolean | null
          is_substituted: boolean | null
          medication_id: string | null
          medication_name: string | null
          notes: string | null
          prescribed_date: string | null
          route: string | null
          start_date: string | null
          status: string
          substitute_reason: string | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string | null
          custom_medication_name?: string | null
          dispensed_at?: string | null
          dispensed_by?: string | null
          dispensed_medication_id?: string | null
          dispensed_medication_name?: string | null
          dosage?: string | null
          duration?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          is_approved?: boolean | null
          is_substituted?: boolean | null
          medication_id?: string | null
          medication_name?: string | null
          notes?: string | null
          prescribed_date?: string | null
          route?: string | null
          start_date?: string | null
          status?: string
          substitute_reason?: string | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string | null
          custom_medication_name?: string | null
          dispensed_at?: string | null
          dispensed_by?: string | null
          dispensed_medication_id?: string | null
          dispensed_medication_name?: string | null
          dosage?: string | null
          duration?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          is_approved?: boolean | null
          is_substituted?: boolean | null
          medication_id?: string | null
          medication_name?: string | null
          notes?: string | null
          prescribed_date?: string | null
          route?: string | null
          start_date?: string | null
          status?: string
          substitute_reason?: string | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_medications_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_medications_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_pathology_charges: {
        Row: {
          amount: number
          created_at: string | null
          end_date: string
          id: string
          qty: number
          rate: number | null
          start_date: string
          updated_at: string | null
          visit_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          end_date: string
          id?: string
          qty?: number
          rate?: number | null
          start_date: string
          updated_at?: string | null
          visit_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          end_date?: string
          id?: string
          qty?: number
          rate?: number | null
          start_date?: string
          updated_at?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_pathology_charges_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_radiology: {
        Row: {
          completed_date: string | null
          cost: number | null
          created_at: string | null
          external_requisition: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          file_url: string | null
          findings: string | null
          id: string
          impression: string | null
          notes: string | null
          ordered_date: string | null
          quantity: number
          radiology_id: string
          report_text: string | null
          scheduled_date: string | null
          selected_doctor: string | null
          status: string | null
          unit_rate: number | null
          updated_at: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          visit_id: string
          xray_started_at: string | null
        }
        Insert: {
          completed_date?: string | null
          cost?: number | null
          created_at?: string | null
          external_requisition?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          findings?: string | null
          id?: string
          impression?: string | null
          notes?: string | null
          ordered_date?: string | null
          quantity?: number
          radiology_id: string
          report_text?: string | null
          scheduled_date?: string | null
          selected_doctor?: string | null
          status?: string | null
          unit_rate?: number | null
          updated_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          visit_id: string
          xray_started_at?: string | null
        }
        Update: {
          completed_date?: string | null
          cost?: number | null
          created_at?: string | null
          external_requisition?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          findings?: string | null
          id?: string
          impression?: string | null
          notes?: string | null
          ordered_date?: string | null
          quantity?: number
          radiology_id?: string
          report_text?: string | null
          scheduled_date?: string | null
          selected_doctor?: string | null
          status?: string | null
          unit_rate?: number | null
          updated_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          visit_id?: string
          xray_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_radiology_radiology_id_fkey"
            columns: ["radiology_id"]
            isOneToOne: false
            referencedRelation: "radiology"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_radiology_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_referees: {
        Row: {
          created_at: string | null
          id: string
          referee_id: string
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          referee_id: string
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          referee_id?: string
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_referees_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: false
            referencedRelation: "referees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_referees_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_surgeons: {
        Row: {
          id: string
          surgeon_id: string | null
          surgeon_type: string | null
          visit_id: string | null
        }
        Insert: {
          id?: string
          surgeon_id?: string | null
          surgeon_type?: string | null
          visit_id?: string | null
        }
        Update: {
          id?: string
          surgeon_id?: string | null
          surgeon_type?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_surgeons_surgeon_id_fkey"
            columns: ["surgeon_id"]
            isOneToOne: false
            referencedRelation: "esic_surgeons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_surgeons_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_surgeries: {
        Row: {
          created_at: string | null
          id: string
          is_primary: boolean | null
          notes: string | null
          package_days: number | null
          rate: number | null
          rate_type: string | null
          sanction_status: string | null
          status: string | null
          surgery_id: string | null
          updated_at: string | null
          visit_id: string
          yojana_procedure_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          package_days?: number | null
          rate?: number | null
          rate_type?: string | null
          sanction_status?: string | null
          status?: string | null
          surgery_id?: string | null
          updated_at?: string | null
          visit_id: string
          yojana_procedure_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          package_days?: number | null
          rate?: number | null
          rate_type?: string | null
          sanction_status?: string | null
          status?: string | null
          surgery_id?: string | null
          updated_at?: string | null
          visit_id?: string
          yojana_procedure_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_surgeries_surgery_id_fkey"
            columns: ["surgery_id"]
            isOneToOne: false
            referencedRelation: "cghs_surgery"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_surgeries_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_surgeries_yojana_procedure_id_fkey"
            columns: ["yojana_procedure_id"]
            isOneToOne: false
            referencedRelation: "yojana_mh_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          additional_approvals: string | null
          admission_date: string | null
          appointment_with: string
          authorized_by: string | null
          bill_paid: boolean | null
          billing_executive: string | null
          billing_status: string | null
          billing_sub_status: string | null
          bunch_no: string | null
          card_no: string | null
          cghs_code: string | null
          claim_id: string | null
          clinical_service_id: string | null
          clinical_services: Json | null
          comments: string | null
          condonation_delay_claim: string | null
          condonation_delay_intimation: string | null
          condonation_delay_submission: string | null
          corporate: string | null
          created_at: string
          delay_waiver_intimation: string | null
          diagnosis_id: string | null
          discharge_date: string | null
          discharge_intimation_at: string | null
          discharge_mode: string | null
          discharge_notes: string | null
          discharge_summary: string | null
          discharge_summary_signed: boolean | null
          discharged_sr_no: number | null
          dr_surgeon_stamp_documents: Json | null
          esic_uh_id: string | null
          extension_days_count: number | null
          extension_of_stay: string | null
          extension_taken: string | null
          extracted_notes: string | null
          fetched_data_text: string | null
          file_status: string | null
          final_bill_printed: boolean | null
          gate_pass_generated: boolean | null
          gate_pass_id: string | null
          hospital_stamp_documents: Json | null
          id: string
          insurance_type: string | null
          intimation_done: string | null
          ipd_admission_notes: Json | null
          is_discharged: boolean | null
          is_package_patient: boolean | null
          mandatory_service_id: string | null
          mandatory_services: Json | null
          medicine_amount: number | null
          nurse_clearance: boolean | null
          opd_admission_notes: Json | null
          opd_summary_text: string | null
          package_amount: string | null
          package_approved_at: string | null
          package_approved_by: string | null
          package_days: number | null
          package_includes_medicine: boolean | null
          package_name: string | null
          package_status: string | null
          patient_id: string
          patient_type: string | null
          pharmacy_clearance: boolean | null
          photos_documents: Json | null
          physiotherapy_bill_date_from: string | null
          physiotherapy_bill_date_to: string | null
          physiotherapy_bill_generated_at: string | null
          physiotherapy_bill_number: string | null
          physiotherapy_bill_total: number | null
          reason_for_visit: string | null
          referee_discharge_amt_paid: number | null
          referee_doa_amt_paid: number | null
          referral_payment_status: string | null
          referring_doctor_id: string | null
          relation_with_employee: string | null
          relationship_manager_id: string | null
          remark1: string | null
          remark2: string | null
          room_allotted: string | null
          sign_documents: Json | null
          sr_no: string | null
          sst_treatment: string | null
          status: string | null
          surgery_date: string | null
          surgical_approval: string | null
          thumb_registration_no: string | null
          treatment_type: string | null
          updated_at: string
          visit_date: string
          visit_id: string
          visit_type: string
          visits_file_status_check: string | null
          ward_allotted: string | null
          yojana_registration_id: string | null
        }
        Insert: {
          additional_approvals?: string | null
          admission_date?: string | null
          appointment_with: string
          authorized_by?: string | null
          bill_paid?: boolean | null
          billing_executive?: string | null
          billing_status?: string | null
          billing_sub_status?: string | null
          bunch_no?: string | null
          card_no?: string | null
          cghs_code?: string | null
          claim_id?: string | null
          clinical_service_id?: string | null
          clinical_services?: Json | null
          comments?: string | null
          condonation_delay_claim?: string | null
          condonation_delay_intimation?: string | null
          condonation_delay_submission?: string | null
          corporate?: string | null
          created_at?: string
          delay_waiver_intimation?: string | null
          diagnosis_id?: string | null
          discharge_date?: string | null
          discharge_intimation_at?: string | null
          discharge_mode?: string | null
          discharge_notes?: string | null
          discharge_summary?: string | null
          discharge_summary_signed?: boolean | null
          discharged_sr_no?: number | null
          dr_surgeon_stamp_documents?: Json | null
          esic_uh_id?: string | null
          extension_days_count?: number | null
          extension_of_stay?: string | null
          extension_taken?: string | null
          extracted_notes?: string | null
          fetched_data_text?: string | null
          file_status?: string | null
          final_bill_printed?: boolean | null
          gate_pass_generated?: boolean | null
          gate_pass_id?: string | null
          hospital_stamp_documents?: Json | null
          id?: string
          insurance_type?: string | null
          intimation_done?: string | null
          ipd_admission_notes?: Json | null
          is_discharged?: boolean | null
          is_package_patient?: boolean | null
          mandatory_service_id?: string | null
          mandatory_services?: Json | null
          medicine_amount?: number | null
          nurse_clearance?: boolean | null
          opd_admission_notes?: Json | null
          opd_summary_text?: string | null
          package_amount?: string | null
          package_approved_at?: string | null
          package_approved_by?: string | null
          package_days?: number | null
          package_includes_medicine?: boolean | null
          package_name?: string | null
          package_status?: string | null
          patient_id: string
          patient_type?: string | null
          pharmacy_clearance?: boolean | null
          photos_documents?: Json | null
          physiotherapy_bill_date_from?: string | null
          physiotherapy_bill_date_to?: string | null
          physiotherapy_bill_generated_at?: string | null
          physiotherapy_bill_number?: string | null
          physiotherapy_bill_total?: number | null
          reason_for_visit?: string | null
          referee_discharge_amt_paid?: number | null
          referee_doa_amt_paid?: number | null
          referral_payment_status?: string | null
          referring_doctor_id?: string | null
          relation_with_employee?: string | null
          relationship_manager_id?: string | null
          remark1?: string | null
          remark2?: string | null
          room_allotted?: string | null
          sign_documents?: Json | null
          sr_no?: string | null
          sst_treatment?: string | null
          status?: string | null
          surgery_date?: string | null
          surgical_approval?: string | null
          thumb_registration_no?: string | null
          treatment_type?: string | null
          updated_at?: string
          visit_date: string
          visit_id: string
          visit_type: string
          visits_file_status_check?: string | null
          ward_allotted?: string | null
          yojana_registration_id?: string | null
        }
        Update: {
          additional_approvals?: string | null
          admission_date?: string | null
          appointment_with?: string
          authorized_by?: string | null
          bill_paid?: boolean | null
          billing_executive?: string | null
          billing_status?: string | null
          billing_sub_status?: string | null
          bunch_no?: string | null
          card_no?: string | null
          cghs_code?: string | null
          claim_id?: string | null
          clinical_service_id?: string | null
          clinical_services?: Json | null
          comments?: string | null
          condonation_delay_claim?: string | null
          condonation_delay_intimation?: string | null
          condonation_delay_submission?: string | null
          corporate?: string | null
          created_at?: string
          delay_waiver_intimation?: string | null
          diagnosis_id?: string | null
          discharge_date?: string | null
          discharge_intimation_at?: string | null
          discharge_mode?: string | null
          discharge_notes?: string | null
          discharge_summary?: string | null
          discharge_summary_signed?: boolean | null
          discharged_sr_no?: number | null
          dr_surgeon_stamp_documents?: Json | null
          esic_uh_id?: string | null
          extension_days_count?: number | null
          extension_of_stay?: string | null
          extension_taken?: string | null
          extracted_notes?: string | null
          fetched_data_text?: string | null
          file_status?: string | null
          final_bill_printed?: boolean | null
          gate_pass_generated?: boolean | null
          gate_pass_id?: string | null
          hospital_stamp_documents?: Json | null
          id?: string
          insurance_type?: string | null
          intimation_done?: string | null
          ipd_admission_notes?: Json | null
          is_discharged?: boolean | null
          is_package_patient?: boolean | null
          mandatory_service_id?: string | null
          mandatory_services?: Json | null
          medicine_amount?: number | null
          nurse_clearance?: boolean | null
          opd_admission_notes?: Json | null
          opd_summary_text?: string | null
          package_amount?: string | null
          package_approved_at?: string | null
          package_approved_by?: string | null
          package_days?: number | null
          package_includes_medicine?: boolean | null
          package_name?: string | null
          package_status?: string | null
          patient_id?: string
          patient_type?: string | null
          pharmacy_clearance?: boolean | null
          photos_documents?: Json | null
          physiotherapy_bill_date_from?: string | null
          physiotherapy_bill_date_to?: string | null
          physiotherapy_bill_generated_at?: string | null
          physiotherapy_bill_number?: string | null
          physiotherapy_bill_total?: number | null
          reason_for_visit?: string | null
          referee_discharge_amt_paid?: number | null
          referee_doa_amt_paid?: number | null
          referral_payment_status?: string | null
          referring_doctor_id?: string | null
          relation_with_employee?: string | null
          relationship_manager_id?: string | null
          remark1?: string | null
          remark2?: string | null
          room_allotted?: string | null
          sign_documents?: Json | null
          sr_no?: string | null
          sst_treatment?: string | null
          status?: string | null
          surgery_date?: string | null
          surgical_approval?: string | null
          thumb_registration_no?: string | null
          treatment_type?: string | null
          updated_at?: string
          visit_date?: string
          visit_id?: string
          visit_type?: string
          visits_file_status_check?: string | null
          ward_allotted?: string | null
          yojana_registration_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_visits_clinical_service_id"
            columns: ["clinical_service_id"]
            isOneToOne: false
            referencedRelation: "clinical_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_visits_mandatory_service_id"
            columns: ["mandatory_service_id"]
            isOneToOne: false
            referencedRelation: "mandatory_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_clinical_service_id_fkey"
            columns: ["clinical_service_id"]
            isOneToOne: false
            referencedRelation: "clinical_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_diagnosis_id_fkey"
            columns: ["diagnosis_id"]
            isOneToOne: false
            referencedRelation: "diagnoses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_mandatory_service_id_fkey"
            columns: ["mandatory_service_id"]
            isOneToOne: false
            referencedRelation: "mandatory_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "visits_referring_doctor_id_fkey"
            columns: ["referring_doctor_id"]
            isOneToOne: false
            referencedRelation: "referees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_relationship_manager_id_fkey"
            columns: ["relationship_manager_id"]
            isOneToOne: false
            referencedRelation: "relationship_managers"
            referencedColumns: ["id"]
          },
        ]
      }
      vital_signs: {
        Row: {
          bed_no: string | null
          blood_sugar: number | null
          bp_diastolic: number | null
          bp_systolic: number | null
          gcs_score: number | null
          id: string
          notes: string | null
          pain_score: number | null
          patient_id: string | null
          pulse: number | null
          recorded_at: string | null
          recorded_by: string | null
          respiratory_rate: number | null
          spo2: number | null
          temperature: number | null
          urine_output_ml: number | null
          visit_id: string | null
          ward: string | null
        }
        Insert: {
          bed_no?: string | null
          blood_sugar?: number | null
          bp_diastolic?: number | null
          bp_systolic?: number | null
          gcs_score?: number | null
          id?: string
          notes?: string | null
          pain_score?: number | null
          patient_id?: string | null
          pulse?: number | null
          recorded_at?: string | null
          recorded_by?: string | null
          respiratory_rate?: number | null
          spo2?: number | null
          temperature?: number | null
          urine_output_ml?: number | null
          visit_id?: string | null
          ward?: string | null
        }
        Update: {
          bed_no?: string | null
          blood_sugar?: number | null
          bp_diastolic?: number | null
          bp_systolic?: number | null
          gcs_score?: number | null
          id?: string
          notes?: string | null
          pain_score?: number | null
          patient_id?: string | null
          pulse?: number | null
          recorded_at?: string | null
          recorded_by?: string | null
          respiratory_rate?: number | null
          spo2?: number | null
          temperature?: number | null
          urine_output_ml?: number | null
          visit_id?: string | null
          ward?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vital_signs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "vital_signs_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_entries: {
        Row: {
          account_id: string | null
          created_at: string | null
          credit_amount: number | null
          debit_amount: number | null
          entry_order: number | null
          id: string
          narration: string | null
          patient_ledger_id: string | null
          voucher_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          credit_amount?: number | null
          debit_amount?: number | null
          entry_order?: number | null
          id?: string
          narration?: string | null
          patient_ledger_id?: string | null
          voucher_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          credit_amount?: number | null
          debit_amount?: number | null
          entry_order?: number | null
          id?: string
          narration?: string | null
          patient_ledger_id?: string | null
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voucher_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_entries_patient_ledger_id_fkey"
            columns: ["patient_ledger_id"]
            isOneToOne: false
            referencedRelation: "patient_ledgers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_entries_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_types: {
        Row: {
          created_at: string | null
          current_number: number | null
          id: string
          is_active: boolean | null
          prefix: string
          updated_at: string | null
          voucher_category: string
          voucher_type_code: string
          voucher_type_name: string
        }
        Insert: {
          created_at?: string | null
          current_number?: number | null
          id?: string
          is_active?: boolean | null
          prefix: string
          updated_at?: string | null
          voucher_category: string
          voucher_type_code: string
          voucher_type_name: string
        }
        Update: {
          created_at?: string | null
          current_number?: number | null
          id?: string
          is_active?: boolean | null
          prefix?: string
          updated_at?: string | null
          voucher_category?: string
          voucher_type_code?: string
          voucher_type_name?: string
        }
        Relationships: []
      }
      vouchers: {
        Row: {
          bill_id: string | null
          company_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          narration: string | null
          patient_id: string | null
          reference_date: string | null
          reference_number: string | null
          status: string | null
          total_amount: number
          updated_at: string | null
          voucher_date: string
          voucher_number: string
          voucher_type_id: string | null
        }
        Insert: {
          bill_id?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          narration?: string | null
          patient_id?: string | null
          reference_date?: string | null
          reference_number?: string | null
          status?: string | null
          total_amount?: number
          updated_at?: string | null
          voucher_date: string
          voucher_number: string
          voucher_type_id?: string | null
        }
        Update: {
          bill_id?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          narration?: string | null
          patient_id?: string | null
          reference_date?: string | null
          reference_number?: string | null
          status?: string | null
          total_amount?: number
          updated_at?: string | null
          voucher_date?: string
          voucher_number?: string
          voucher_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_corporate_patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "vouchers_voucher_type_id_fkey"
            columns: ["voucher_type_id"]
            isOneToOne: false
            referencedRelation: "voucher_types"
            referencedColumns: ["id"]
          },
        ]
      }
      ward_shiftings: {
        Row: {
          created_at: string | null
          from_ward: string | null
          hospital_name: string | null
          id: string
          patient_name: string
          remark: string | null
          shifting_date: string | null
          shifting_ward: string
          visit_id: string | null
        }
        Insert: {
          created_at?: string | null
          from_ward?: string | null
          hospital_name?: string | null
          id?: string
          patient_name: string
          remark?: string | null
          shifting_date?: string | null
          shifting_ward: string
          visit_id?: string | null
        }
        Update: {
          created_at?: string | null
          from_ward?: string | null
          hospital_name?: string | null
          id?: string
          patient_name?: string
          remark?: string | null
          shifting_date?: string | null
          shifting_ward?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ward_shiftings_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_metrics: {
        Row: {
          account_id: string
          created_at: string | null
          human_hours: number
          id: string
          notes: string | null
          tasks_completed: number
          week_starting: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          human_hours: number
          id?: string
          notes?: string | null
          tasks_completed: number
          week_starting: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          human_hours?: number
          id?: string
          notes?: string | null
          tasks_completed?: number
          week_starting?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_metrics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "client_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_parts: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          part_id: string
          quantity_used: number
          total_cost: number | null
          unit_cost: number | null
          work_order_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          part_id: string
          quantity_used: number
          total_cost?: number | null
          unit_cost?: number | null
          work_order_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          part_id?: string
          quantity_used?: number
          total_cost?: number | null
          unit_cost?: number | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_parts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "inventory_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_parts_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          actual_cost: number | null
          actual_end_date: string | null
          actual_start_date: string | null
          assigned_technician_id: string | null
          assigned_vendor_id: string | null
          attachments: string[] | null
          created_at: string | null
          description: string | null
          downtime_impact: string | null
          equipment_id: string
          estimated_cost: number | null
          id: string
          issue_details: string | null
          labor_cost: number | null
          maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          parts_cost: number | null
          priority: Database["public"]["Enums"]["priority_level"] | null
          reported_by: string | null
          reported_by_role: string | null
          requested_date: string | null
          resolution_details: string | null
          safety_precautions: string | null
          scheduled_end_date: string | null
          scheduled_start_date: string | null
          status: Database["public"]["Enums"]["work_order_status"] | null
          title: string
          updated_at: string | null
          work_order_number: string
        }
        Insert: {
          actual_cost?: number | null
          actual_end_date?: string | null
          actual_start_date?: string | null
          assigned_technician_id?: string | null
          assigned_vendor_id?: string | null
          attachments?: string[] | null
          created_at?: string | null
          description?: string | null
          downtime_impact?: string | null
          equipment_id: string
          estimated_cost?: number | null
          id?: string
          issue_details?: string | null
          labor_cost?: number | null
          maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          parts_cost?: number | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          reported_by?: string | null
          reported_by_role?: string | null
          requested_date?: string | null
          resolution_details?: string | null
          safety_precautions?: string | null
          scheduled_end_date?: string | null
          scheduled_start_date?: string | null
          status?: Database["public"]["Enums"]["work_order_status"] | null
          title: string
          updated_at?: string | null
          work_order_number: string
        }
        Update: {
          actual_cost?: number | null
          actual_end_date?: string | null
          actual_start_date?: string | null
          assigned_technician_id?: string | null
          assigned_vendor_id?: string | null
          attachments?: string[] | null
          created_at?: string | null
          description?: string | null
          downtime_impact?: string | null
          equipment_id?: string
          estimated_cost?: number | null
          id?: string
          issue_details?: string | null
          labor_cost?: number | null
          maintenance_type?: Database["public"]["Enums"]["maintenance_type"]
          parts_cost?: number | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          reported_by?: string | null
          reported_by_role?: string | null
          requested_date?: string | null
          resolution_details?: string | null
          safety_precautions?: string | null
          scheduled_end_date?: string | null
          scheduled_start_date?: string | null
          status?: Database["public"]["Enums"]["work_order_status"] | null
          title?: string
          updated_at?: string | null
          work_order_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_assigned_technician_id_fkey"
            columns: ["assigned_technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_assigned_vendor_id_fkey"
            columns: ["assigned_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      worklist_items: {
        Row: {
          completed_by: string | null
          completion_time: string | null
          created_at: string | null
          id: string
          item_status: string | null
          order_id: string | null
          order_item_id: string | null
          priority: string | null
          processing_notes: string | null
          sample_id: string | null
          sample_type: string | null
          sequence_number: number | null
          start_time: string | null
          started_by: string | null
          test_name: string | null
          updated_at: string | null
          worklist_id: string | null
        }
        Insert: {
          completed_by?: string | null
          completion_time?: string | null
          created_at?: string | null
          id?: string
          item_status?: string | null
          order_id?: string | null
          order_item_id?: string | null
          priority?: string | null
          processing_notes?: string | null
          sample_id?: string | null
          sample_type?: string | null
          sequence_number?: number | null
          start_time?: string | null
          started_by?: string | null
          test_name?: string | null
          updated_at?: string | null
          worklist_id?: string | null
        }
        Update: {
          completed_by?: string | null
          completion_time?: string | null
          created_at?: string | null
          id?: string
          item_status?: string | null
          order_id?: string | null
          order_item_id?: string | null
          priority?: string | null
          processing_notes?: string | null
          sample_id?: string | null
          sample_type?: string | null
          sequence_number?: number | null
          start_time?: string | null
          started_by?: string | null
          test_name?: string | null
          updated_at?: string | null
          worklist_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worklist_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worklist_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_test_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worklist_items_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "lab_samples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worklist_items_worklist_id_fkey"
            columns: ["worklist_id"]
            isOneToOne: false
            referencedRelation: "lab_worklists"
            referencedColumns: ["id"]
          },
        ]
      }
      yojana_mh_addon_primary: {
        Row: {
          addon_procedure_code: string
          created_at: string | null
          id: string
          primary_procedure_code: string
          remarks: string | null
        }
        Insert: {
          addon_procedure_code: string
          created_at?: string | null
          id?: string
          primary_procedure_code: string
          remarks?: string | null
        }
        Update: {
          addon_procedure_code?: string
          created_at?: string | null
          id?: string
          primary_procedure_code?: string
          remarks?: string | null
        }
        Relationships: []
      }
      yojana_mh_addon_specialty: {
        Row: {
          created_at: string | null
          id: string
          procedure_code: string
          specialty_code: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          procedure_code: string
          specialty_code: string
        }
        Update: {
          created_at?: string | null
          id?: string
          procedure_code?: string
          specialty_code?: string
        }
        Relationships: []
      }
      yojana_mh_followup_procedure: {
        Row: {
          created_at: string | null
          followup_code: string | null
          id: string
          procedure_code: string
          remarks: string | null
        }
        Insert: {
          created_at?: string | null
          followup_code?: string | null
          id?: string
          procedure_code: string
          remarks?: string | null
        }
        Update: {
          created_at?: string | null
          followup_code?: string | null
          id?: string
          procedure_code?: string
          remarks?: string | null
        }
        Relationships: []
      }
      yojana_mh_implant_procedure_map: {
        Row: {
          created_at: string | null
          id: string
          implant_code: string
          procedure_code: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          implant_code: string
          procedure_code: string
        }
        Update: {
          created_at?: string | null
          id?: string
          implant_code?: string
          procedure_code?: string
        }
        Relationships: []
      }
      yojana_mh_implants: {
        Row: {
          created_at: string | null
          id: string
          implant_code: string
          implant_name: string | null
          implant_price: string | null
          max_multiplier: string | null
          procedure_code: string | null
          remarks: string | null
          specialty: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          implant_code: string
          implant_name?: string | null
          implant_price?: string | null
          max_multiplier?: string | null
          procedure_code?: string | null
          remarks?: string | null
          specialty?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          implant_code?: string
          implant_name?: string | null
          implant_price?: string | null
          max_multiplier?: string | null
          procedure_code?: string | null
          remarks?: string | null
          specialty?: string | null
        }
        Relationships: []
      }
      yojana_mh_investigation_procedure_map: {
        Row: {
          created_at: string | null
          id: string
          investigation_code: string | null
          procedure_code: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          investigation_code?: string | null
          procedure_code?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          investigation_code?: string | null
          procedure_code?: string | null
        }
        Relationships: []
      }
      yojana_mh_investigations: {
        Row: {
          created_at: string | null
          id: string
          investigation_code: string
          investigation_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          investigation_code: string
          investigation_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          investigation_code?: string
          investigation_name?: string | null
        }
        Relationships: []
      }
      yojana_mh_popup_conditions: {
        Row: {
          created_at: string | null
          id: string
          popup_description: string | null
          procedure_code: string
          stage: string | null
          step: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          popup_description?: string | null
          procedure_code: string
          stage?: string | null
          step?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          popup_description?: string | null
          procedure_code?: string
          stage?: string | null
          step?: string | null
        }
        Relationships: []
      }
      yojana_mh_procedures: {
        Row: {
          auto_approved: string | null
          created_at: string | null
          day_care_procedure: string | null
          enhancement_applicable: string | null
          id: string
          implant_criteria: string | null
          level_of_care: string | null
          los: string | null
          mandatory_docs_claim: string | null
          mandatory_docs_preauth: string | null
          medical_or_surgical: string | null
          multiple_procedures: string | null
          package_code: string | null
          package_name: string | null
          procedure_code: string
          procedure_label: string | null
          procedure_name: string | null
          reservation_public: string | null
          reservation_tertiary: string | null
          reserved_procedure: string | null
          special_condition_popup: string | null
          special_conditions: string | null
          special_conditions_rule: string | null
          specialty: string | null
          specialty_code: string | null
          stratification_criteria: string | null
          tier3_rate: number | null
        }
        Insert: {
          auto_approved?: string | null
          created_at?: string | null
          day_care_procedure?: string | null
          enhancement_applicable?: string | null
          id?: string
          implant_criteria?: string | null
          level_of_care?: string | null
          los?: string | null
          mandatory_docs_claim?: string | null
          mandatory_docs_preauth?: string | null
          medical_or_surgical?: string | null
          multiple_procedures?: string | null
          package_code?: string | null
          package_name?: string | null
          procedure_code: string
          procedure_label?: string | null
          procedure_name?: string | null
          reservation_public?: string | null
          reservation_tertiary?: string | null
          reserved_procedure?: string | null
          special_condition_popup?: string | null
          special_conditions?: string | null
          special_conditions_rule?: string | null
          specialty?: string | null
          specialty_code?: string | null
          stratification_criteria?: string | null
          tier3_rate?: number | null
        }
        Update: {
          auto_approved?: string | null
          created_at?: string | null
          day_care_procedure?: string | null
          enhancement_applicable?: string | null
          id?: string
          implant_criteria?: string | null
          level_of_care?: string | null
          los?: string | null
          mandatory_docs_claim?: string | null
          mandatory_docs_preauth?: string | null
          medical_or_surgical?: string | null
          multiple_procedures?: string | null
          package_code?: string | null
          package_name?: string | null
          procedure_code?: string
          procedure_label?: string | null
          procedure_name?: string | null
          reservation_public?: string | null
          reservation_tertiary?: string | null
          reserved_procedure?: string | null
          special_condition_popup?: string | null
          special_conditions?: string | null
          special_conditions_rule?: string | null
          specialty?: string | null
          specialty_code?: string | null
          stratification_criteria?: string | null
          tier3_rate?: number | null
        }
        Relationships: []
      }
      yojana_mh_special_conditions: {
        Row: {
          created_at: string | null
          id: string
          procedure_code: string
          rule_description: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          procedure_code: string
          rule_description?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          procedure_code?: string
          rule_description?: string | null
        }
        Relationships: []
      }
      yojana_mh_stratification: {
        Row: {
          created_at: string | null
          id: string
          override_procedure_price: string | null
          rule: string | null
          stratification_code: string
          stratification_detail_code: string | null
          stratification_detail_options: string | null
          stratification_details: string | null
          stratification_options: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          override_procedure_price?: string | null
          rule?: string | null
          stratification_code: string
          stratification_detail_code?: string | null
          stratification_detail_options?: string | null
          stratification_details?: string | null
          stratification_options?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          override_procedure_price?: string | null
          rule?: string | null
          stratification_code?: string
          stratification_detail_code?: string | null
          stratification_detail_options?: string | null
          stratification_details?: string | null
          stratification_options?: string | null
        }
        Relationships: []
      }
      yojana_mh_stratification_procedure_map: {
        Row: {
          created_at: string | null
          id: string
          procedure_code: string
          stratification_code: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          procedure_code: string
          stratification_code: string
        }
        Update: {
          created_at?: string | null
          id?: string
          procedure_code?: string
          stratification_code?: string
        }
        Relationships: []
      }
      yojna_bills: {
        Row: {
          address: string | null
          age_sex: string | null
          corporate_name: string | null
          created_at: string | null
          created_by: string | null
          date_of_discharge: string | null
          date_of_invoice: string | null
          date_of_registration: string | null
          diagnosis: string | null
          hospital_name: string | null
          id: string
          invoice_no: string | null
          items: Json
          notes: string | null
          pan_no: string | null
          patient_name: string | null
          primary_consultant: string | null
          registration_no: string | null
          status: string | null
          tax_no: string | null
          total_amount: number | null
          updated_at: string | null
          visit_id: string
        }
        Insert: {
          address?: string | null
          age_sex?: string | null
          corporate_name?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_discharge?: string | null
          date_of_invoice?: string | null
          date_of_registration?: string | null
          diagnosis?: string | null
          hospital_name?: string | null
          id?: string
          invoice_no?: string | null
          items?: Json
          notes?: string | null
          pan_no?: string | null
          patient_name?: string | null
          primary_consultant?: string | null
          registration_no?: string | null
          status?: string | null
          tax_no?: string | null
          total_amount?: number | null
          updated_at?: string | null
          visit_id: string
        }
        Update: {
          address?: string | null
          age_sex?: string | null
          corporate_name?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_discharge?: string | null
          date_of_invoice?: string | null
          date_of_registration?: string | null
          diagnosis?: string | null
          hospital_name?: string | null
          id?: string
          invoice_no?: string | null
          items?: Json
          notes?: string | null
          pan_no?: string | null
          patient_name?: string | null
          primary_consultant?: string | null
          registration_no?: string | null
          status?: string | null
          tax_no?: string | null
          total_amount?: number | null
          updated_at?: string | null
          visit_id?: string
        }
        Relationships: []
      }
      zero_contacts: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          organization: string | null
          phone: string | null
          role: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          role?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          role?: string | null
        }
        Relationships: []
      }
      zero_login_user: {
        Row: {
          created_at: string | null
          email: string
          full_name: string
          id: string
          password: string
          role: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          password: string
          role: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          password?: string
          role?: string
          status?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      inventory_status: {
        Row: {
          batch_number: string | null
          category: string | null
          created_at: string | null
          current_stock: number | null
          expiring_soon: boolean | null
          expiry_date: string | null
          id: string | null
          last_restocked: string | null
          last_sterilized: string | null
          max_stock_level: number | null
          min_stock_level: number | null
          name: string | null
          sterilization_required: boolean | null
          stock_status: string | null
          supplier: string | null
          total_value: number | null
          unit_cost: number | null
          updated_at: string | null
          usage_per_day: number | null
        }
        Insert: {
          batch_number?: string | null
          category?: string | null
          created_at?: string | null
          current_stock?: number | null
          expiring_soon?: never
          expiry_date?: string | null
          id?: string | null
          last_restocked?: string | null
          last_sterilized?: string | null
          max_stock_level?: number | null
          min_stock_level?: number | null
          name?: string | null
          sterilization_required?: boolean | null
          stock_status?: never
          supplier?: string | null
          total_value?: never
          unit_cost?: number | null
          updated_at?: string | null
          usage_per_day?: number | null
        }
        Update: {
          batch_number?: string | null
          category?: string | null
          created_at?: string | null
          current_stock?: number | null
          expiring_soon?: never
          expiry_date?: string | null
          id?: string | null
          last_restocked?: string | null
          last_sterilized?: string | null
          max_stock_level?: number | null
          min_stock_level?: number | null
          name?: string | null
          sterilization_required?: boolean | null
          stock_status?: never
          supplier?: string | null
          total_value?: never
          unit_cost?: number | null
          updated_at?: string | null
          usage_per_day?: number | null
        }
        Relationships: []
      }
      v_active_work_orders: {
        Row: {
          assigned_technician: string | null
          equipment_id: string | null
          equipment_name: string | null
          estimated_cost: number | null
          location: string | null
          priority: Database["public"]["Enums"]["priority_level"] | null
          scheduled_start_date: string | null
          status: Database["public"]["Enums"]["work_order_status"] | null
          title: string | null
          work_order_number: string | null
        }
        Relationships: []
      }
      v_batch_stock_details: {
        Row: {
          batch_number: string | null
          current_stock: number | null
          days_to_expiry: number | null
          expiry_date: string | null
          expiry_status: string | null
          free_quantity: number | null
          grn_date: string | null
          grn_number: string | null
          hospital_name: string | null
          id: string | null
          is_expired: boolean | null
          medicine_id: string | null
          mrp: number | null
          purchase_price: number | null
          rack_number: string | null
          received_quantity: number | null
          selling_price: number | null
          shelf_location: string | null
          sold_quantity: number | null
        }
        Insert: {
          batch_number?: string | null
          current_stock?: number | null
          days_to_expiry?: never
          expiry_date?: string | null
          expiry_status?: never
          free_quantity?: number | null
          grn_date?: string | null
          grn_number?: string | null
          hospital_name?: string | null
          id?: string | null
          is_expired?: boolean | null
          medicine_id?: string | null
          mrp?: number | null
          purchase_price?: number | null
          rack_number?: string | null
          received_quantity?: number | null
          selling_price?: number | null
          shelf_location?: string | null
          sold_quantity?: number | null
        }
        Update: {
          batch_number?: string | null
          current_stock?: number | null
          days_to_expiry?: never
          expiry_date?: string | null
          expiry_status?: never
          free_quantity?: number | null
          grn_date?: string | null
          grn_number?: string | null
          hospital_name?: string | null
          id?: string | null
          is_expired?: boolean | null
          medicine_id?: string | null
          mrp?: number | null
          purchase_price?: number | null
          rack_number?: string | null
          received_quantity?: number | null
          selling_price?: number | null
          shelf_location?: string | null
          sold_quantity?: number | null
        }
        Relationships: []
      }
      v_corporate_patients: {
        Row: {
          address: string | null
          age: number | null
          age_group: string | null
          corporate_created_at: string | null
          corporate_description: string | null
          corporate_id: string | null
          corporate_name: string | null
          corporate_text: string | null
          email: string | null
          gender: string | null
          patient_created_at: string | null
          patient_id: string | null
          patient_name: string | null
          patient_status: string | null
          patients_id: string | null
          phone: string | null
        }
        Relationships: []
      }
      v_equipment_status_summary: {
        Row: {
          category: string | null
          color_code: string | null
          count: number | null
          status: Database["public"]["Enums"]["equipment_status"] | null
        }
        Relationships: []
      }
      v_medicine_combined_stock: {
        Row: {
          batch_count: number | null
          hospital_name: string | null
          medicine_id: string | null
          near_expiry_batches: number | null
          nearest_expiry: string | null
          total_received: number | null
          total_sold: number | null
          total_stock: number | null
        }
        Relationships: []
      }
      v_overdue_maintenance: {
        Row: {
          days_overdue: number | null
          equipment_id: string | null
          location: string | null
          name: string | null
          next_maintenance_date: string | null
          priority: Database["public"]["Enums"]["priority_level"] | null
        }
        Relationships: []
      }
      v_pharmacy_low_stock_alert: {
        Row: {
          current_stock: number | null
          generic_name: string | null
          id: string | null
          item_code: string | null
          manufacturer: string | null
          minimum_stock: number | null
          name: string | null
          pack_size: number | null
          reorder_level: number | null
          shelf: string | null
          supplier_name: string | null
        }
        Relationships: []
      }
      v_pharmacy_today_sales: {
        Row: {
          payment_method: string | null
          sales_by_payment: number | null
          total_discount: number | null
          total_revenue: number | null
          total_sales: number | null
          unique_patients: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      auto_queue_from_bill: {
        Args: { p_patient_name: string; p_visit_id: string }
        Returns: number
      }
      backfill_all_advance_payment_vouchers: {
        Args: never
        Returns: {
          amount: number
          debit_account: string
          message: string
          payment_date: string
          payment_id: string
          payment_mode: string
          status: string
          voucher_number: string
        }[]
      }
      backfill_formatted_bill_numbers: { Args: never; Returns: undefined }
      brain_search: {
        Args: {
          match_count?: number
          off_limits_ok?: boolean
          project_filter: string[]
          query_embedding: string
        }
        Returns: {
          content: string
          created_at: string
          id: string
          project_tag: string
          similarity: number
          source_ref: string
          source_type: string
        }[]
      }
      change_user_password: {
        Args: {
          p_current_password: string
          p_email: string
          p_new_password: string
        }
        Returns: Json
      }
      complete_work_order: {
        Args: {
          p_actual_cost?: number
          p_condition_after?: number
          p_labor_cost?: number
          p_next_maintenance_date?: string
          p_parts_cost?: number
          p_resolution_details: string
          p_work_order_id: string
        }
        Returns: boolean
      }
      create_pharmacy_sale: {
        Args: {
          p_items: Json
          p_patient_id: string
          p_patient_name: string
          p_payment_method: string
          p_sale_type: string
          p_visit_id: string
        }
        Returns: number
      }
      create_work_order_with_assignment: {
        Args: {
          p_auto_assign?: boolean
          p_description: string
          p_equipment_id: string
          p_estimated_cost?: number
          p_issue_details: string
          p_maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          p_priority: Database["public"]["Enums"]["priority_level"]
          p_reported_by: string
          p_reported_by_role: string
          p_title: string
        }
        Returns: {
          assigned_technician_name: string
          work_order_id: string
          work_order_number: string
        }[]
      }
      generate_daily_payment_schedule: {
        Args: { p_date: string; p_hospital?: string }
        Returns: undefined
      }
      generate_gate_pass_number: { Args: never; Returns: string }
      generate_requisition_number: {
        Args: { requisition_type: string }
        Returns: string
      }
      generate_voucher_number: {
        Args: { p_voucher_type_code: string }
        Returns: string
      }
      get_available_batches: {
        Args: { p_hospital_name?: string; p_medicine_id: string }
        Returns: {
          available_stock: number
          batch_id: string
          batch_number: string
          days_to_expiry: number
          expiry_date: string
          mrp: number
          selling_price: number
        }[]
      }
      get_available_technicians: {
        Args: { equipment_uuid: string }
        Returns: {
          current_workload: number
          email: string
          employee_id: string
          name: string
          phone: string
          specialization: string[]
          technician_id: string
        }[]
      }
      get_cash_book_transactions_direct: {
        Args: {
          p_from_date?: string
          p_hospital_name?: string
          p_patient_id?: string
          p_to_date?: string
          p_transaction_type?: string
        }
        Returns: {
          amount: number
          created_at: string
          description: string
          patient_id: string
          patient_name: string
          payment_mode: string
          quantity: number
          rate_type: string
          transaction_date: string
          transaction_id: string
          transaction_time: string
          transaction_type: string
          unit_rate: number
          updated_at: string
          visit_id: string
        }[]
      }
      get_compliance_alerts: {
        Args: { p_days_ahead?: number }
        Returns: {
          alert_level: string
          certificate_number: string
          compliance_type: string
          days_until_expiry: number
          equipment_id: string
          equipment_name: string
          expiry_date: string
          location: string
        }[]
      }
      get_equipment_list_with_details: {
        Args: {
          category_filter?: string
          location_filter?: string
          search_term?: string
          status_filter?: string
        }
        Returns: {
          assigned_technician: string
          brand: string
          category_color: string
          category_name: string
          condition_rating: number
          current_issue: string
          days_until_maintenance: number
          equipment_id: string
          issue_reported_by: string
          last_maintenance_date: string
          location_name: string
          maintenance_overdue: boolean
          model: string
          name: string
          next_maintenance_date: string
          priority: Database["public"]["Enums"]["priority_level"]
          status: Database["public"]["Enums"]["equipment_status"]
          vendor_name: string
          warranty_status: Database["public"]["Enums"]["warranty_status"]
        }[]
      }
      get_equipment_maintenance_schedule: {
        Args: { p_equipment_id: string }
        Returns: {
          days_until_due: number
          frequency_days: number
          last_performed: string
          maintenance_type: Database["public"]["Enums"]["maintenance_type"]
          next_due_date: string
          schedule_name: string
          status: string
        }[]
      }
      get_equipment_utilization_report: {
        Args: never
        Returns: {
          category: string
          equipment_id: string
          equipment_name: string
          last_maintenance: string
          location: string
          maintenance_frequency: number
          reliability_score: number
          total_downtime_hours: number
          utilization_status: string
        }[]
      }
      get_ledger_statement_with_patients: {
        Args: {
          p_account_name: string
          p_from_date: string
          p_hospital_name?: string
          p_mrn_filter?: string
          p_payment_mode?: string
          p_to_date: string
        }
        Returns: {
          account_code: string
          bank_account: string
          credit_amount: number
          debit_amount: number
          is_refund: boolean
          mrn_number: string
          narration: string
          patient_id: string
          patient_name: string
          patient_type: string
          payment_mode: string
          payment_type: string
          remarks: string
          visit_id: string
          visit_type: string
          voucher_date: string
          voucher_number: string
          voucher_type: string
        }[]
      }
      get_maintenance_cost_analytics: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: {
          average_cost_per_maintenance: number
          corrective_cost: number
          emergency_cost: number
          month: string
          preventive_cost: number
          total_cost: number
          total_maintenance_count: number
        }[]
      }
      increment_medicine_quantity: {
        Args: { medicine_id: string; qty_to_add: number }
        Returns: undefined
      }
      lookup_user_by_email: {
        Args: { lookup_email: string }
        Returns: {
          email: string
          hospital_type: string
          id: string
          role: string
        }[]
      }
      mark_obligation_paid: {
        Args: { p_amount: number; p_schedule_id: string; p_user_id?: string }
        Returns: string
      }
      next_queue_token: { Args: { dept: string }; Returns: number }
      record_opd_service_payment: {
        Args: {
          p_amount: number
          p_created_by?: string
          p_payment_date?: string
          p_payment_mode: string
          p_service_details?: Json
          p_visit_id: string
        }
        Returns: string
      }
      record_opd_visit_payment: {
        Args: {
          p_amount: number
          p_created_by?: string
          p_narration?: string
          p_payment_date?: string
          p_payment_mode: string
          p_visit_id: string
        }
        Returns: string
      }
      record_pharmacy_payment: {
        Args: {
          p_amount: number
          p_created_by?: string
          p_medicine_details?: Json
          p_payment_date?: string
          p_payment_mode: string
          p_sale_id: number
        }
        Returns: string
      }
      schedule_preventive_maintenance: {
        Args: {
          p_description?: string
          p_equipment_id: string
          p_maintenance_type?: Database["public"]["Enums"]["maintenance_type"]
          p_scheduled_date?: string
        }
        Returns: string
      }
      update_all_expired_batches: { Args: never; Returns: number }
      verify_user_password: {
        Args: { p_email: string; p_password: string }
        Returns: {
          is_valid: boolean
          user_email: string
          user_full_name: string
          user_hospital_type: string
          user_id: string
          user_is_active: boolean
          user_phone: string
          user_role: string
        }[]
      }
    }
    Enums: {
      date_status: "0" | "1" | "2"
      equipment_status:
        | "operational"
        | "needs_repair"
        | "under_maintenance"
        | "out_of_service"
        | "decommissioned"
      maintenance_type:
        | "preventive"
        | "corrective"
        | "emergency"
        | "calibration"
        | "inspection"
      priority_level: "low" | "medium" | "high" | "critical"
      procedure_category:
        | "Surgery"
        | "Radiology"
        | "Lab"
        | "Medication"
        | "Consultation"
        | "Other"
      warranty_status: "active" | "expired" | "not_applicable"
      work_order_status:
        | "pending"
        | "assigned"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "on_hold"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      date_status: ["0", "1", "2"],
      equipment_status: [
        "operational",
        "needs_repair",
        "under_maintenance",
        "out_of_service",
        "decommissioned",
      ],
      maintenance_type: [
        "preventive",
        "corrective",
        "emergency",
        "calibration",
        "inspection",
      ],
      priority_level: ["low", "medium", "high", "critical"],
      procedure_category: [
        "Surgery",
        "Radiology",
        "Lab",
        "Medication",
        "Consultation",
        "Other",
      ],
      warranty_status: ["active", "expired", "not_applicable"],
      work_order_status: [
        "pending",
        "assigned",
        "in_progress",
        "completed",
        "cancelled",
        "on_hold",
      ],
    },
  },
} as const
