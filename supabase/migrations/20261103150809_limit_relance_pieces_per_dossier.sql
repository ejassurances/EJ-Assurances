CREATE OR REPLACE FUNCTION public.guard_relance_pieces_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dossier_id text;
  v_count integer;
BEGIN
  IF NEW.template <> 'pieces-manquantes' OR NEW.idempotency_key IS NULL THEN
    RETURN NEW;
  END IF;

  v_dossier_id := substring(
    NEW.idempotency_key
    FROM '^relance-pieces-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  );

  IF v_dossier_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer
    INTO v_count
  FROM public.emails_planifies
  WHERE template = 'pieces-manquantes'
    AND idempotency_key LIKE 'relance-pieces-' || v_dossier_id || '-%';

  IF v_count >= 4 THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_relance_pieces_limit_trigger ON public.emails_planifies;
CREATE TRIGGER guard_relance_pieces_limit_trigger
BEFORE INSERT ON public.emails_planifies
FOR EACH ROW
EXECUTE FUNCTION public.guard_relance_pieces_limit();
