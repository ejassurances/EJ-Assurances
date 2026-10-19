-- Keep the scheduled CRM entry point private to the database scheduler.
-- Supabase default privileges had granted EXECUTE directly to API roles, so
-- revoking only from PUBLIC was not sufficient.
REVOKE ALL ON FUNCTION public.invoke_crm_public_job(text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoke_crm_public_job(text, jsonb, integer)
  TO postgres;
