-- Event-trigger functions are invoked by PostgreSQL's DDL event trigger only.
-- They must not be exposed as application RPCs.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
