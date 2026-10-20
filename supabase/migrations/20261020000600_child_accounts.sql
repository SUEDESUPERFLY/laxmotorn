-- Barnkonton: barnet loggar in själv men ser bara sina godkända läxor och sina egna framsteg.
-- Föräldrar (owner/parent) har full åtkomst som tidigare.

alter table public.household_members drop constraint household_members_role_check;
alter table public.household_members add constraint household_members_role_check check (role in ('owner','parent','child'));
alter table public.household_members add column child_id uuid references public.children(id) on delete cascade;
alter table public.household_members add constraint household_members_child_ck check ((role = 'child') = (child_id is not null));
create index household_members_child_idx on public.household_members(child_id);

-- Användarnamn för barnens inloggning. Skrivs bara av serverfunktionen.
create table public.kid_logins (
  username text primary key check (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  child_id uuid not null unique references public.children(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index kid_logins_household_idx on public.kid_logins(household_id);
alter table public.kid_logins enable row level security;

create or replace function private.is_parent(hh uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
                 where m.household_id = hh and m.user_id = (select auth.uid()) and m.role in ('owner','parent'));
$$;
create or replace function private.is_my_child(kid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
                 where m.child_id = kid and m.user_id = (select auth.uid()) and m.role = 'child');
$$;
revoke all on function private.is_parent(uuid) from public, anon;
revoke all on function private.is_my_child(uuid) from public, anon;
grant execute on function private.is_parent(uuid) to authenticated;
grant execute on function private.is_my_child(uuid) to authenticated;

-- Förhör: föräldrar allt; barn läser bara godkända för sig själva eller för alla.
alter policy "members manage quizzes" on public.quizzes
  using (private.is_parent(household_id))
  with check (private.is_parent(household_id) and private.quiz_child_ok(household_id, child_id));
create policy "child reads own ready quizzes" on public.quizzes for select to authenticated
  using (status = 'ready' and private.is_member(household_id)
         and (child_id is null or private.is_my_child(child_id)));

-- Barn: föräldrar allt; barnet läser och uppdaterar bara sig självt (bara stats, se trigger).
alter policy "members manage children" on public.children
  using (private.is_parent(household_id)) with check (private.is_parent(household_id));
create policy "child reads self" on public.children for select to authenticated using (private.is_my_child(id));
create policy "child updates self" on public.children for update to authenticated
  using (private.is_my_child(id)) with check (private.is_my_child(id));

create or replace function private.child_update_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.is_parent(old.household_id) then return new; end if;
  if new.name is distinct from old.name or new.grade is distinct from old.grade
     or new.class_codes is distinct from old.class_codes or new.languages is distinct from old.languages
     or new.household_id is distinct from old.household_id then
    raise exception 'barn får bara uppdatera sina egna poäng';
  end if;
  return new;
end; $$;
create trigger children_child_guard before update on public.children
  for each row execute function private.child_update_guard();

-- Framsteg: föräldrar för alla barn i familjen; barnet bara sina egna.
alter policy "members manage progress" on public.progress
  using (exists (select 1 from public.children c where c.id = child_id and private.is_parent(c.household_id)))
  with check (exists (select 1 from public.children c join public.quizzes q on q.household_id = c.household_id
                      where c.id = child_id and q.id = quiz_id and private.is_parent(c.household_id)));
create policy "child manages own progress" on public.progress for all to authenticated
  using (private.is_my_child(child_id)) with check (private.is_my_child(child_id));

-- Familjen: alla medlemmar ser namnet, bara föräldrar ändrar. Nyckeln till Apps Script syns inte via API:t.
alter policy "members rename household" on public.households
  using (private.is_parent(id)) with check (private.is_parent(id));
revoke select, update on public.households from anon, authenticated;
grant select (id, name, created_at) on public.households to authenticated;
grant update (name) on public.households to authenticated;

create or replace function public.get_ingest_token()
returns uuid language sql stable security definer set search_path = '' as $$
  select h.ingest_token from public.households h
  join public.household_members m on m.household_id = h.id
  where m.user_id = (select auth.uid()) and m.role in ('owner','parent') limit 1;
$$;
revoke all on function public.get_ingest_token() from public, anon;
grant execute on function public.get_ingest_token() to authenticated;

-- Mejlloggen och barnens användarnamn: bara föräldrar.
alter policy "members read imports" on public.mail_imports using (private.is_parent(household_id));
create policy "parents read kid logins" on public.kid_logins for select to authenticated using (private.is_parent(household_id));
