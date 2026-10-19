-- is_member behövs bara av RLS: flytta den ur det exponerade API-schemat.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_member(hh uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hh and m.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_member(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;

alter policy "members read household" on public.households using (private.is_member(id));
alter policy "members rename household" on public.households using (private.is_member(id)) with check (private.is_member(id));
alter policy "members read members" on public.household_members using (private.is_member(household_id));
alter policy "members manage children" on public.children using (private.is_member(household_id)) with check (private.is_member(household_id));
alter policy "members manage quizzes" on public.quizzes using (private.is_member(household_id)) with check (private.is_member(household_id));
alter policy "members manage progress" on public.progress
  using (exists (select 1 from public.children c where c.id = child_id and private.is_member(c.household_id)))
  with check (
    exists (select 1 from public.children c join public.quizzes q on q.household_id = c.household_id
            where c.id = child_id and q.id = quiz_id and private.is_member(c.household_id))
  );

-- Den gamla public.is_member används inte längre; stäng den för alla roller.
-- (En drop kräver godkännande som inte gick igenom; tas bort i en senare migrering.)
revoke all on function public.is_member(uuid) from public, anon, authenticated;

-- create_household ska bara kunna anropas av inloggade (avsiktlig advisor-varning kvarstår för authenticated).
revoke execute on function public.create_household(text) from anon;
