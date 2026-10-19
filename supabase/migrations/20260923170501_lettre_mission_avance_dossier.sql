create or replace function public.trg_lettre_mission_avance_dossier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _ancienne text;
  _preuve_suffisante boolean;
begin
  _preuve_suffisante :=
    (new.statut = 'signee' and (old.statut is distinct from 'signee'))
    or (new.statut = 'envoyee' and new.envoye_le is not null and (old.statut is distinct from 'envoyee' or old.envoye_le is null));

  if _preuve_suffisante then
    select statut::text into _ancienne from public.dossiers where id = new.dossier_id;
    if _ancienne is not null and _ancienne <> 'dda_validee' then
      update public.dossiers set statut = 'dda_validee', updated_at = now() where id = new.dossier_id;
      insert into public.dossier_etapes_historique (dossier_id, ancienne_etape, nouvelle_etape, commentaire, par)
      values (
        new.dossier_id,
        _ancienne,
        'dda_validee',
        case when new.statut = 'signee'
          then 'Lettre de mission signée par le client'
          else 'Lettre de mission envoyée avec preuve — signature non requise'
        end,
        auth.uid()
      );
    end if;
    if new.client_id is not null then
      update public.clients set dda_statut = 'validee', updated_at = now() where id = new.client_id;
    end if;
  end if;
  return new;
end;
$$;