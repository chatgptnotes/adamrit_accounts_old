
export interface HopeRMO {
  id: string;
  name: string;
  specialty?: string;
  department?: string;
  contact_info?: string;
  tpa_rate?: number;
  non_nabh_rate?: number;
  nabh_rate?: number;
  private_rate?: number;
  daily_remuneration?: number;
  ledger_account_id?: string | null;
  is_active?: boolean;
  created_at: string;
  updated_at: string;
}
