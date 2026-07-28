-- The browser no longer calls this content RPC directly. Protected invoice
-- content must flow through api/invoice-content.ts, which validates the
-- signed Adamrit user session and user-bound grant first.

REVOKE EXECUTE ON FUNCTION public.get_invoice_content(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoice_content(UUID, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
