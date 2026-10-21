-- Förklaringsfilmer som video: lagring och logg för renderingen (GitHub Actions via edge function).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('films', 'films', true, 20971520, array['video/mp4','text/vtt','audio/mpeg','audio/wav','audio/x-wav','image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.film_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  quiz_id uuid,
  concept_id text,
  level text not null default 'info',
  msg text not null
);
alter table public.film_log enable row level security;
-- Inga policys: bara servern (service role) läser och skriver.
revoke all on public.film_log from anon, authenticated;
