-- Secure runtime secret lookup for server-side scheduled job authentication.
-- The secret value is stored in Supabase Vault, never in source control.

CREATE OR REPLACE FUNCTION public.get_private_runtime_secret(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_private_runtime_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_private_runtime_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_private_runtime_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_runtime_secret(text) TO service_role;
