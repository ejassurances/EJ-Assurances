-- Restrict the remuneration recalculation RPC to authenticated application users.
-- Trigger functions are not intended to be callable as PostgREST RPCs; trigger execution
-- does not depend on callers having EXECUTE privileges.
REVOKE ALL ON FUNCTION public.recalculer_remuneration_contrat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculer_remuneration_contrat(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.historiser_remuneration_previsionnelle() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_remuneration_bareme() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_remuneration_contrat() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_relance_pieces_limit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_crm_email_hourly_limit() FROM PUBLIC, anon, authenticated, service_role;
