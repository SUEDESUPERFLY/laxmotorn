-- Familjemål: ett gemensamt XP-mål för alla barn i familjen, med en verklig belöning.
-- Föräldern sätter målet; barnen ser en gemensam mätare. XP räknas från när målet sattes:
-- för varje barn sparas dess XP i det ögonblicket (base), och mätaren är summan av allt som
-- barnen har tjänat sedan dess. XP som barnet handlar för i profilbutiken räknas fortfarande
-- (stats.xp är all intjänad XP; köp sparas separat i stats.spent).
--
-- goal = {"target": 5000, "reward": "Välja fredagsfilm", "set_at": "...", "base": {"<child_id>": 1234, ...}}
alter table public.households add column if not exists goal jsonb;

-- Kolumnen läses och skrivs bara via funktionerna nedan (households har kolumnvisa rättigheter).
revoke select (goal), update (goal) on public.households from anon, authenticated;

-- Målet och hur långt familjen har kommit. Föräldrar ser också vad varje barn har bidragit med.
create or replace function public.family_goal()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  hh uuid;
  g jsonb;
  parent boolean;
  earned numeric := 0;
  kids jsonb := '[]'::jsonb;
  c record;
  e numeric;
begin
  select m.household_id into hh from public.household_members m
   where m.user_id = (select auth.uid()) order by m.created_at limit 1;
  if hh is null then return null; end if;
  select h.goal into g from public.households h where h.id = hh;
  if g is null or coalesce((g->>'target')::numeric, 0) <= 0 then return null; end if;
  parent := private.is_parent(hh);
  for c in select ch.id, ch.name, coalesce((ch.stats->>'xp')::numeric, 0) as xp, ch.created_at
             from public.children ch where ch.household_id = hh order by ch.created_at loop
    -- Barn som har lagts till efter att målet sattes räknas från 0.
    e := greatest(0, c.xp - coalesce((g->'base'->>c.id::text)::numeric, 0));
    earned := earned + e;
    if parent then kids := kids || jsonb_build_object('id', c.id, 'name', c.name, 'earned', round(e)); end if;
  end loop;
  return jsonb_build_object(
    'target', (g->>'target')::int,
    'reward', g->>'reward',
    'set_at', g->>'set_at',
    'earned', round(earned),
    'done', earned >= (g->>'target')::numeric,
    'kids', case when parent then kids else null end);
end; $$;

-- Föräldern sätter ett nytt mål (mätaren börjar om från 0) eller tar bort det (p_target null eller 0).
create or replace function public.set_family_goal(p_target int, p_reward text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  hh uuid;
  base jsonb;
  r text := btrim(coalesce(p_reward, ''));
begin
  select m.household_id into hh from public.household_members m
   where m.user_id = (select auth.uid()) and m.role in ('owner', 'parent') order by m.created_at limit 1;
  if hh is null then raise exception 'bara föräldrar kan sätta familjemålet'; end if;
  if p_target is null or p_target <= 0 then
    update public.households set goal = null where id = hh;
    return null;
  end if;
  if p_target < 100 or p_target > 1000000 then raise exception 'målet ska vara mellan 100 och 1 000 000 XP'; end if;
  if char_length(r) < 1 or char_length(r) > 80 then raise exception 'skriv en belöning (högst 80 tecken)'; end if;
  select coalesce(jsonb_object_agg(ch.id::text, coalesce((ch.stats->>'xp')::numeric, 0)), '{}'::jsonb) into base
    from public.children ch where ch.household_id = hh;
  update public.households
     set goal = jsonb_build_object('target', p_target, 'reward', r, 'set_at', now(), 'base', base)
   where id = hh;
  return public.family_goal();
end; $$;

revoke all on function public.family_goal() from public, anon;
revoke all on function public.set_family_goal(int, text) from public, anon;
grant execute on function public.family_goal() to authenticated;
grant execute on function public.set_family_goal(int, text) to authenticated;
