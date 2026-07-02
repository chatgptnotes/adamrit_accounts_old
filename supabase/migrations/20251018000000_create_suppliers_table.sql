-- Create suppliers table
-- Table to store pharmacy supplier information

CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    supplier_name VARCHAR(255) NOT NULL,
    supplier_code VARCHAR(50) NOT NULL UNIQUE,
    supplier_type VARCHAR(50),
    phone VARCHAR(50),
    credit_limit DECIMAL(10, 2),
    email VARCHAR(255),
    pin VARCHAR(20),
    dl_no VARCHAR(100),
    account_group VARCHAR(100),
    cst VARCHAR(100),
    s_tax_no VARCHAR(100),
    address TEXT,
    credit_day INTEGER,
    bank_or_branch VARCHAR(255),
    mobile VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster search
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(supplier_name);
CREATE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(supplier_code);

-- Add comment
COMMENT ON TABLE suppliers IS 'Master table for pharmacy suppliers';

-- Insert sample data based on the screenshot
INSERT INTO suppliers (supplier_name, supplier_code, supplier_type, phone, dl_no, cst, s_tax_no, credit_limit, credit_day) VALUES
('A.R MEDICAL & SURGICALS', 'PHDQ7J3YH', 'Distributor', '9923272868 9371987473', '20B-MH-NAG-68619,21B-MH-NAG-68620', '27011458794P', '27011458794C', 100000, 30),
('ABHAYANKAR AUSHADI VYAVASAI.', 'ABH001', 'Wholesaler', '', 'B 10315', '', '440002/S/1654', 50000, 15),
('ADARSH SALES WHOLESALE DEALER IN MEDICINES', 'PHDSYR19C', 'Wholesaler', '0712-2768330,2764330', '20B-10394 21B-3274', '', '', 75000, 20),
('ADVANTAGE SURGICALS CO.', 'ASC002', 'Distributor', '9422122658', '', '', '', 60000, 25),
('AGRAWAL AGENCIES', 'PHF24LH69', 'Distributor', '07122763246,2766886', '20-136/09,21-136/09', '', '', 80000, 30),
('ajay medical stors', 'PH1XYUE2S', 'Retailer', '2634310', '20/nag/1203/2002 21/nag/1203/2002', '', '', 40000, 15),
('AJIT PHARMATICS', 'PH4Y3PFSQ', 'Distributor', '9028058600,8087087360', '20/MH/NAG/136/2009 21/MH/NAG/136/2009', '', '', 90000, 30)
ON CONFLICT (supplier_code) DO NOTHING;
