-- E-COURSE ACADEMY — Supabase schema, run in the NEW academy project.
-- Never put service_role keys, database passwords or admin passwords in client files.
create extension if not exists pgcrypto;

create table if not exists public.academy_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null unique check (role in ('super_admin','admin')),
  created_at timestamptz not null default now()
);
alter table public.academy_admins enable row level security;
revoke all on public.academy_admins from public, anon, authenticated;
grant select on public.academy_admins to authenticated;
drop policy if exists academy_admins_self on public.academy_admins;
create policy academy_admins_self on public.academy_admins
for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.academy_courses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  category text not null default 'Pendidikan',
  level text not null default 'Pemula',
  premium boolean not null default false,
  published boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.academy_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  youtube_id text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  position integer not null check (position >= 0),
  unique (course_id,position)
);
create table if not exists public.academy_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  unique (course_id,user_id)
);
create table if not exists public.academy_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.academy_lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key(user_id,lesson_id)
);
create index if not exists academy_lessons_course_idx on public.academy_lessons(course_id,position);
create index if not exists academy_enrollments_user_idx on public.academy_enrollments(user_id);
create index if not exists academy_enrollments_pending_idx on public.academy_enrollments(status,course_id);
create index if not exists academy_progress_user_idx on public.academy_progress(user_id);

alter table public.academy_courses enable row level security;
alter table public.academy_lessons enable row level security;
alter table public.academy_enrollments enable row level security;
alter table public.academy_progress enable row level security;

revoke all on public.academy_courses, public.academy_lessons,
  public.academy_enrollments, public.academy_progress from public, anon, authenticated;

grant select on public.academy_courses to anon,authenticated;
grant insert,update,delete on public.academy_courses to authenticated;
grant select on public.academy_lessons to authenticated;
grant insert,update,delete on public.academy_lessons to authenticated;
grant select,insert,update on public.academy_enrollments to authenticated;
grant select,insert on public.academy_progress to authenticated;

drop policy if exists academy_courses_read on public.academy_courses;
create policy academy_courses_read on public.academy_courses for select
to anon,authenticated using (published = true);
drop policy if exists academy_courses_admin_read on public.academy_courses;
create policy academy_courses_admin_read on public.academy_courses for select
to authenticated using (exists
  (select 1 from public.academy_admins a where a.user_id = (select auth.uid())));
drop policy if exists academy_courses_write on public.academy_courses;
create policy academy_courses_write on public.academy_courses for insert to authenticated
with check (created_by = (select auth.uid()) and exists
  (select 1 from public.academy_admins a where a.user_id = (select auth.uid())));
drop policy if exists academy_courses_update on public.academy_courses;
create policy academy_courses_update on public.academy_courses for update to authenticated
using (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid())))
with check (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid())));
drop policy if exists academy_courses_delete on public.academy_courses;
create policy academy_courses_delete on public.academy_courses for delete to authenticated
using (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid())));

drop policy if exists academy_lessons_read on public.academy_lessons;
create policy academy_lessons_read on public.academy_lessons for select to authenticated
using (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid()))
  or exists (select 1 from public.academy_enrollments e
    where e.course_id = academy_lessons.course_id
      and e.user_id = (select auth.uid()) and e.status = 'approved'));
drop policy if exists academy_lessons_insert on public.academy_lessons;
create policy academy_lessons_insert on public.academy_lessons for insert to authenticated
with check (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid())));
drop policy if exists academy_lessons_update on public.academy_lessons;
create policy academy_lessons_update on public.academy_lessons for update to authenticated
using (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid())))
with check (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid())));
drop policy if exists academy_lessons_delete on public.academy_lessons;
create policy academy_lessons_delete on public.academy_lessons for delete to authenticated
using (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid())));

drop policy if exists academy_enrollments_read on public.academy_enrollments;
create policy academy_enrollments_read on public.academy_enrollments for select to authenticated
using (user_id = (select auth.uid()) or exists
  (select 1 from public.academy_admins a where a.user_id = (select auth.uid())));
drop policy if exists academy_enrollments_join on public.academy_enrollments;
create policy academy_enrollments_join on public.academy_enrollments for insert to authenticated
with check (user_id = (select auth.uid()) and exists
  (select 1 from public.academy_courses c
   where c.id = academy_enrollments.course_id and c.published = true
   and academy_enrollments.status = case when c.premium then 'pending' else 'approved' end));
drop policy if exists academy_enrollments_admin_update on public.academy_enrollments;
create policy academy_enrollments_admin_update on public.academy_enrollments for update to authenticated
using (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid())))
with check (exists (select 1 from public.academy_admins a where a.user_id = (select auth.uid())));
-- No delete policy: retain enrollment records for audit.

drop policy if exists academy_progress_self_read on public.academy_progress;
create policy academy_progress_self_read on public.academy_progress for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists academy_progress_self_insert on public.academy_progress;
create policy academy_progress_self_insert on public.academy_progress for insert to authenticated
with check (user_id = (select auth.uid()) and exists
 (select 1 from public.academy_lessons l
  join public.academy_enrollments e on e.course_id = l.course_id
  where l.id = academy_progress.lesson_id and e.user_id = (select auth.uid()) and e.status='approved'));
-- No participant update/delete of progress records.
-- Admin slot provisioning: first create TWO accounts in Supabase Auth,
-- then replace the UUID placeholders and execute these inserts in SQL Editor:
-- insert into public.academy_admins(user_id,role) values
-- ('SUPER_ADMIN_AUTH_UUID','super_admin'), ('SECOND_ADMIN_AUTH_UUID','admin');
-- The UNIQUE(role) constraint prevents a third admin slot; participants cannot write this table.
