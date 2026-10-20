-- Mejlimport från Unikum, förhör per barn och godkännande.

-- Vilka Unikum-grupper barnet tillhör (prefix i ämnesraden, t.ex. 'RG14A', 'RG14/').
alter table public.children add column class_codes text[] not null default '{}';

-- Hemlig nyckel som Apps Script använder för att skicka mejl till familjen.
alter table public.households add column ingest_token uuid not null default gen_random_uuid();
create unique index households_ingest_token_idx on public.households(ingest_token);

-- Förhör: vilket barn (null = alla), status och ursprung.
--   pending: från mejl, väntar på underlag eller förslag
--   draft:   förslag klart, väntar på vuxens godkännande
--   ready:   godkänt, syns för barnet
alter table public.quizzes
  add column child_id uuid references public.children(id) on delete cascade,
  add column status text not null default 'ready' check (status in ('pending','draft','ready')),
  add column source jsonb,
  add column dedupe_key text;
create index quizzes_child_idx on public.quizzes(child_id);
create unique index quizzes_dedupe_idx on public.quizzes(household_id, dedupe_key) where dedupe_key is not null;
-- Ett väntande förhör från mejl kan sakna stationer.
alter table public.quizzes alter column content set default '{}'::jsonb;

-- Barnet måste tillhöra samma familj som förhöret.
create or replace function private.quiz_child_ok(hh uuid, kid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select kid is null or exists (select 1 from public.children c where c.id = kid and c.household_id = hh);
$$;
revoke all on function private.quiz_child_ok(uuid, uuid) from public, anon;
grant execute on function private.quiz_child_ok(uuid, uuid) to authenticated;

alter policy "members manage quizzes" on public.quizzes
  using (private.is_member(household_id))
  with check (private.is_member(household_id) and private.quiz_child_ok(household_id, child_id));

-- Logg över behandlade mejl (dubblettskydd). Skrivs bara av serverfunktionen.
create table public.mail_imports (
  household_id uuid not null references public.households(id) on delete cascade,
  message_id text not null,
  received_at timestamptz,
  subject text,
  child_id uuid references public.children(id) on delete set null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (household_id, message_id)
);
create index mail_imports_child_idx on public.mail_imports(child_id);
alter table public.mail_imports enable row level security;
create policy "members read imports" on public.mail_imports
  for select to authenticated using (private.is_member(household_id));
