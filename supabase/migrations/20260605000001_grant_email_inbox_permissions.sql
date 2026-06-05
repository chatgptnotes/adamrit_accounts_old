-- Grant anon and authenticated roles full access to email_inbox
-- Required for the billing panel to insert and update rows via the browser (anon key)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE email_inbox TO anon, authenticated;
