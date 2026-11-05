CREATE OR REPLACE FUNCTION public.guard_crm_email_hourly_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hour_start timestamptz;
  v_count integer;
BEGIN
  IF NEW.statut <> 'en_attente' OR NEW.envoyer_le IS NULL THEN
    RETURN NEW;
  END IF;

  v_hour_start := date_trunc('hour', NEW.envoyer_le);

  SELECT count(*)::integer
    INTO v_count
  FROM public.emails_planifies
  WHERE statut = 'en_attente'
    AND envoyer_le >= v_hour_start
    AND envoyer_le < v_hour_start + interval '1 hour';

  IF v_count >= 50 THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_crm_email_hourly_limit_trigger ON public.emails_planifies;
CREATE TRIGGER guard_crm_email_hourly_limit_trigger
BEFORE INSERT ON public.emails_planifies
FOR EACH ROW
EXECUTE FUNCTION public.guard_crm_email_hourly_limit();
