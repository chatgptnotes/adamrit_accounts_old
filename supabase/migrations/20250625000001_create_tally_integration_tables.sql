-- Create Tally configuration table
CREATE TABLE IF NOT EXISTS tally_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  tally_server_url TEXT NOT NULL,
  tally_port INTEGER NOT NULL DEFAULT 9000,
  company_guid TEXT,
  sync_enabled BOOLEAN DEFAULT false,
  last_sync_time TIMESTAMP WITH TIME ZONE,
  sync_frequency TEXT CHECK (sync_frequency IN ('manual', 'hourly', 'daily', 'realtime')) DEFAULT 'manual',
  mapping_rules JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Tally sync status table
CREATE TABLE IF NOT EXISTS tally_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT CHECK (sync_type IN ('ledgers', 'vouchers', 'masters', 'full')) NOT NULL,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')) NOT NULL,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE,
  records_processed INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  error_message TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add Tally-specific columns to existing tables
ALTER TABLE chart_of_accounts 
ADD COLUMN IF NOT EXISTS tally_guid TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS tally_parent TEXT,
ADD COLUMN IF NOT EXISTS tally_last_sync TIMESTAMP WITH TIME ZONE;

ALTER TABLE vouchers
ADD COLUMN IF NOT EXISTS tally_guid TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS tally_last_sync TIMESTAMP WITH TIME ZONE;

-- Create cost centers table for Tally integration
CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent TEXT,
  category TEXT,
  tally_guid TEXT UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create voucher cost center allocations table
CREATE TABLE IF NOT EXISTS voucher_cost_center_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_entry_id UUID REFERENCES voucher_entries(id) ON DELETE CASCADE,
  cost_center_id UUID REFERENCES cost_centers(id),
  amount DECIMAL(12, 2) NOT NULL,
  percentage DECIMAL(5, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create bill allocations table
CREATE TABLE IF NOT EXISTS bill_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_entry_id UUID REFERENCES voucher_entries(id) ON DELETE CASCADE,
  bill_name TEXT NOT NULL,
  bill_type TEXT,
  amount DECIMAL(12, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Tally import log table
CREATE TABLE IF NOT EXISTS tally_import_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type TEXT NOT NULL,
  file_name TEXT,
  records_total INTEGER,
  records_imported INTEGER,
  records_updated INTEGER,
  records_failed INTEGER,
  errors JSONB,
  warnings JSONB,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Tally export log table
CREATE TABLE IF NOT EXISTS tally_export_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_type TEXT NOT NULL,
  format TEXT NOT NULL,
  filters JSONB,
  records_exported INTEGER,
  file_size INTEGER,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tally_sync_status_sync_type ON tally_sync_status(sync_type);
CREATE INDEX IF NOT EXISTS idx_tally_sync_status_status ON tally_sync_status(status);
CREATE INDEX IF NOT EXISTS idx_tally_sync_status_start_time ON tally_sync_status(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_tally_guid ON chart_of_accounts(tally_guid);
CREATE INDEX IF NOT EXISTS idx_vouchers_tally_guid ON vouchers(tally_guid);
CREATE INDEX IF NOT EXISTS idx_cost_centers_tally_guid ON cost_centers(tally_guid);

-- Enable RLS
ALTER TABLE tally_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_cost_center_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_import_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_export_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow authenticated users to view Tally config" ON tally_config
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to manage Tally config" ON tally_config
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to view sync status" ON tally_sync_status
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to create sync status" ON tally_sync_status
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update sync status" ON tally_sync_status
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to manage cost centers" ON cost_centers
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to manage voucher allocations" ON voucher_cost_center_allocations
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to manage bill allocations" ON bill_allocations
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to view import logs" ON tally_import_log
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to create import logs" ON tally_import_log
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to view export logs" ON tally_export_log
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to create export logs" ON tally_export_log
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_tally_config_updated_at BEFORE UPDATE ON tally_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cost_centers_updated_at BEFORE UPDATE ON cost_centers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();