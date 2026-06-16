-- ============================================================
-- Tally Integration - Complete Database Migration
-- ============================================================
-- Combined from:
--   1. src/lib/tally-migration.sql (core tables)
--   2. supabase/migrations/20260301_tally_bank_statements_gst.sql (bank + GST)
-- ============================================================

-- Tally Integration Configuration
CREATE TABLE IF NOT EXISTS tally_config (
  id UUD DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  server_url TEXT NOT NULL DEFAULT 'http://localhost:9000',
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  sync_interval_minutes INT DEFAULT 30,
  auto_sync_enabled BOOLEAN DEFAULT false,
  hospital_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tally Ledgers (synced from Tally)
CREATE TABLE IF NOT EXISTS tally_ledgers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tally_guid TEXT UNIQUE,
  name TEXT NOT NULL,
  parent_group TEXT,
  opening_balance DECIMAL(15,2) DEFAULT 0,
  closing_balance DECIMAL(15,2) DEFAULT 0,
  address TEXT,
  phone TEXT,
  email TEXT,
  gst_number TEXT,
  pan_number TEXT,
  ledger_type TEXT,
  is_mapped BOOLEAN DEFAULT false,
  adamrit_entity_id TEXT,
  adamrit_entity_type TEXT,
  last_synced_at TIMESTAMPTZ,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tally Account Groups
CREATE TABLE IF NOT EXISTS tally_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent_group TEXT,
  is_revenue BOOLEAN DEFAULT false,
  is_deemed_positive BOOLEAN DEFAULT true,
  nature_of_group TEXT,
  raw_data JSONB,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tally Vouchers (transactions synced both ways)
CREATE TABLE IF NOT EXISTS tally_vouchers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tally_guid TEXT UNIQUE,
  voucher_number TEXT,
  voucher_type TEXT NOT NULL,
  date DATE NOT NULL,
  party_ledger TEXT,
  amount DECIMAL(15,2) NOT NULL,
  narration TEXT,
  is_cancelled BOOLEAN DEFAULT false,
  sync_direction TEXT DEFAULT 'from_tally',
  sync_status TEXT DEFAULT 'synced',
  adamrit_bill_id TEXT,
  adamrit_payment_id TEXT,
  ledger_entries JSONB,
  raw_data JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ
);

-- Tally Cost Centers
CREATE TABLE IF NOT EXISTS tally_cost_centres (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent TEXT,
  category TEXT,
  adamrit_department_id TEXT,
  raw_data JSONB,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tally Stock Items (pharmacy/consumables)
CREATE TABLE IF NOT EXISTS tally_stock_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tally_guid TEXT UNIQUE,
  name TEXT NOT NULL,
  stock_group TEXT,
  unit TEXT,
  opening_balance DECIMAL(15,3) DEFAULT 0,
  closing_balance DECIMAL(15,3) DEFAULT 0,
  opening_value DECIMAL(15,2) DEFAULT 0,
  closing_value DECIMAL(15,2) DEFAULT 0,
  rate DECIMAL(15,2) DEFAULT 0,
  gst_rate DECIMAL(5,2) DEFAULT 0,
  hsn_code TEXT,
  raw_data JSONB,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync Logs
CREATE TABLE IF NOT EXISTS tally_sync_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  records_synced INT DEFAULT 0,
  records_failed INT DEFAULT 0,
  error_details JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT
);

-- Tally Financial Reports (cached)
CREATE TABLE IF NOT EXISTS tally_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_type TEXT NOT NULL,
  report_date DATE,
  period_from DATE,
  period_to DATE,
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bank Statements table for reconciliation
CREATE TABLE IF NOT EXISTS tally_bank_statements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_ledger TEXT NOT NULL,
  date DATE NOT NULL,
  description TEXT,
  reference TEXT,
  deposit DECIMAL(15,2) DEFAULT 0,
  withdrawal DECIMAL(15,2) DEFAULT 0,
  balance DECIMAL(15,2),
  matched_voucher_id UUID REFERENCES tally_vouchers(id),
  match_status TEXT DEFAULT 'unmatched', -- matched, unmatched
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- GST Data table for cached GST reports
CREATE TABLE IF NOT EXISTS tally_gst_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_type TEXT NOT NULL, -- gstr1, gstr3b, gst_ledger
  period_from DATE,
  period_to DATE,
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ledger Mapping (Adamrit entities → Tally ledgers for auto-push)
CREATE TABLE IF NOT EXISTS tally_ledger_mapping (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  adamrit_entity_type TEXT NOT NULL,   -- department, payment_mode, service_category, pharmacy
  adamrit_entity_name TEXT NOT NULL,   -- e.g., "ICU", "Cash", "Consultation", "Paracetamol"
  tally_ledger_name TEXT NOT NULL,     -- e.g., "Hospital Income - ICU", "Cash", "Consultation Fees"
  tally_group TEXT,                     -- e.g., "Direct Incomes", "Bank Accounts"
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(adamrit_entity_type, adamrit_entity_name)
);

-- ============================================================
-- Enable Row Level Security
-- ============================================================
ALTER TABLE tally_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_cost_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_gst_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_ledger_mapping ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS Policies - Allow authenticated access
-- ============================================================
CREATE POLICY "Allow all for authenticated" ON tally_config FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON tally_ledgers FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON tally_groups FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON tally_vouchers FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON tally_cost_centres FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON tally_stock_items FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON tally_sync_log FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON tally_reports FOR ALL USING (true);
CREATE POLICY "Allow all on tally_bank_statements" ON tally_bank_statements FOR ALL USING (true);
CREATE POLICY "Allow all on tally_gst_data" ON tally_gst_data FOR ALL USING (true);
CREATE POLICY "Allow all on tally_ledger_mapping" ON tally_ledger_mapping FOR ALL USING (true);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_tally_ledgers_name ON tally_ledgers(name);
CREATE INDEX idx_tally_ledgers_type ON tally_ledgers(ledger_type);
CREATE INDEX idx_tally_vouchers_date ON tally_vouchers(date);
CREATE INDEX idx_tally_vouchers_type ON tally_vouchers(voucher_type);
CREATE INDEX idx_tally_vouchers_sync ON tally_vouchers(sync_status);
CREATE INDEX idx_tally_sync_log_type ON tally_sync_log(sync_type, status);
CREATE INDEX idx_bank_stmt_date ON tally_bank_statements(date);
CREATE INDEX idx_bank_stmt_bank ON tally_bank_statements(bank_ledger);
CREATE INDEX idx_ledger_mapping_type ON tally_ledger_mapping(adamrit_entity_type);

-- ============================================================
-- Seed Default Ledger Mappings
-- ============================================================
INSERT INTO tally_ledger_mapping (adamrit_entity_type, adamrit_entity_name, tally_ledger_name, tally_group) VALUES
-- Payment modes
('payment_mode', 'Cash', 'Cash', 'Cash-in-Hand'),
('payment_mode', 'CASH', 'Cash', 'Cash-in-Hand'),
('payment_mode', 'Card', 'HDFC Bank', 'Bank Accounts'),
('payment_mode', 'CARD', 'HDFC Bank', 'Bank Accounts'),
('payment_mode', 'UPI', 'HDFC Bank', 'Bank Accounts'),
('payment_mode', 'NEFT', 'HDFC Bank', 'Bank Accounts'),
('payment_mode', 'RTGS', 'HDFC Bank', 'Bank Accounts'),
('payment_mode', 'DD', 'HDFC Bank', 'Bank Accounts'),
('payment_mode', 'CHEQUE', 'HDFC Bank', 'Bank Accounts'),
('payment_mode', 'ONLINE', 'HDFC Bank', 'Bank Accounts'),
('payment_mode', 'Bank Transfer', 'HDFC Bank', 'Bank Accounts'),
('payment_mode', 'Insurance', 'Insurance Receivables', 'Sundry Debtors'),
('payment_mode', 'ESIC', 'ESIC Receivables', 'Sundry Debtors'),
('payment_mode', 'CGHS', 'CGHS Receivables', 'Sundry Debtors'),
('payment_mode', 'CREDIT', 'Credit', 'Sundry Debtors'),
-- Service categories
('service_category', 'Hospital Income', 'Hospital Income', 'Direct Incomes'),
('service_category', 'Consultation Fees', 'Consultation Fees', 'Direct Incomes'),
('service_category', 'Room Charges', 'Room Charges', 'Direct Incomes'),
('service_category', 'OT Charges', 'OT Charges', 'Direct Incomes'),
('service_category', 'Pathology', 'Pathology Income', 'Direct Incomes'),
('service_category', 'Radiology', 'Radiology Income', 'Direct Incomes'),
-- Pharmacy
('pharmacy', 'Pharmacy Sales', 'Pharmacy Sales', 'Sales Accounts'),
-- Departments
('department', 'ICU', 'Hospital Income - ICU', 'Direct Incomes'),
('department', 'General Ward', 'Hospital Income - General Ward', 'Direct Incomes'),
('department', 'OPD', 'Hospital Income - OPD', 'Direct Incomes')
ON CONFLICT (adamrit_entity_type, adamrit_entity_name) DO NOTHING;
