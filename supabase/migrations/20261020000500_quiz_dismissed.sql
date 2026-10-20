-- dismissed: en vuxen har avfärdat ett prov från skolmejl. Raden finns kvar så att samma prov inte importeras igen.
alter table public.quizzes drop constraint quizzes_status_check;
alter table public.quizzes add constraint quizzes_status_check check (status in ('pending','draft','ready','dismissed'));
