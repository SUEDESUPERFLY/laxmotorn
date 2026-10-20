-- Moderna språk som barnet läser (t.ex. {tyska}); prov i andra språk hoppas över vid mejlimport.
alter table public.children add column languages text[] not null default '{}';
