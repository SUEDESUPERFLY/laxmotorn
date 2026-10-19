-- Läxmotorn: grundschema.
-- Ett hushåll har vuxna medlemmar (inloggade) och barn (profiler utan egen inloggning).
-- Förhör tillhör hushållet; framsteg och XP tillhör barnet.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Familjen',
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'parent' check (role in ('owner','parent')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members(user_id);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  grade smallint not null default 4 check (grade between 1 and 9),
  -- XP, dagar i rad, märken, fixade missar, repetitioner (motsvarar laxmotorn:xp)
  stats jsonb not null default '{"xp":0,"days":[],"badges":[],"fixed":0,"reviews":0}'::jsonb,
  created_at timestamptz not null default now()
);
create index children_household_idx on public.children(household_id);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  subject text not null default 'annat' check (subject in ('no','so','sv','ma','en','annat')),
  summary text,
  grade smallint check (grade between 1 and 9),
  test_date date,
  -- stationer, förklara-kort, länkar, anteckningar och begrepp (concepts) för förklaringsklipp
  content jsonb not null,
  schema_version smallint not null default 2,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index quizzes_household_idx on public.quizzes(household_id, created_at desc);
create index quizzes_created_by_idx on public.quizzes(created_by);

-- Framsteg per barn och förhör (motsvarar laxmotorn:p:<id>: lådor, medaljer, delmål …)
create table public.progress (
  child_id uuid not null references public.children(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (child_id, quiz_id)
);
create index progress_quiz_idx on public.progress(quiz_id);

-- Hjälpfunktion för RLS: är den inloggade användaren medlem i hushållet?
create or replace function public.is_member(hh uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hh and m.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_member(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;

-- Skapa ett hushåll och bli ägare (första inloggningen)
create or replace function public.create_household(hh_name text default 'Familjen')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare new_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  insert into public.households(name) values (coalesce(nullif(trim(hh_name),''),'Familjen')) returning id into new_id;
  insert into public.household_members(household_id, user_id, role) values (new_id, (select auth.uid()), 'owner');
  return new_id;
end;
$$;
revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.children enable row level security;
alter table public.quizzes enable row level security;
alter table public.progress enable row level security;

create policy "members read household" on public.households
  for select to authenticated using (public.is_member(id));
create policy "members rename household" on public.households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy "members read members" on public.household_members
  for select to authenticated using (public.is_member(household_id));

create policy "members manage children" on public.children
  for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy "members manage quizzes" on public.quizzes
  for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy "members manage progress" on public.progress
  for all to authenticated
  using (exists (select 1 from public.children c where c.id = child_id and public.is_member(c.household_id)))
  with check (
    exists (select 1 from public.children c join public.quizzes q on q.household_id = c.household_id
            where c.id = child_id and q.id = quiz_id and public.is_member(c.household_id))
  );

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger progress_touch before update on public.progress
  for each row execute function public.touch_updated_at();
