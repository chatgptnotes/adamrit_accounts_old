-- Abuzar's User row exists only as the raw login username "abuzarqureshi1983"
-- (no proper full_name), so the Billing Executive dropdown on the Advance
-- Payment dialog filters him out as a junk/username entry. Set a proper
-- display name on the existing row — no new user is inserted.

UPDATE public."User"
SET full_name = 'Abuzar'
WHERE lower(split_part(email, '@', 1)) = 'abuzarqureshi1983'
  AND (full_name IS NULL OR trim(full_name) = '' OR full_name ~ '[0-9._]');
