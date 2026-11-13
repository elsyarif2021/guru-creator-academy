-- Run only as the database owner in a trusted SQL session.
-- All fixtures and writes are rolled back, including auth.users.
begin;
do $$
declare
  manager uuid := gen_random_uuid();
  learner uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  free_course uuid := gen_random_uuid();
  paid_course uuid := gen_random_uuid();
  lesson uuid := gen_random_uuid();
begin
  perform set_config('test.manager', manager::text, true);
  perform set_config('test.learner', learner::text, true);
  perform set_config('test.stranger', stranger::text, true);
  perform set_config('test.free_course', free_course::text, true);
  perform set_config('test.paid_course', paid_course::text, true);
  perform set_config('test.lesson', lesson::text, true);
  insert into auth.users (id, email, aud, role) values
    (manager, manager::text || '@example.invalid', 'authenticated', 'authenticated'),
    (learner, learner::text || '@example.invalid', 'authenticated', 'authenticated'),
    (stranger, stranger::text || '@example.invalid', 'authenticated', 'authenticated');
  -- The test has no dependency on whether the two administrator slots are filled.
  -- Fixtures are never committed; use the existing admin's identity if present.
  if exists (select 1 from public.academy_admins) then
    select user_id into manager from public.academy_admins limit 1;
    perform set_config('test.manager', manager::text, true);
  else
    insert into public.academy_admins(user_id,role) values(manager,'super_admin');
  end if;
  insert into public.academy_courses(id,title,premium,created_by) values
    (free_course,'RLS test free',false,manager), (paid_course,'RLS test paid',true,manager);
  insert into public.academy_lessons(id,course_id,title,youtube_id,position)
    values(lesson,free_course,'RLS test lesson','dQw4w9WgXcQ',0);
  insert into public.academy_enrollments(course_id,user_id,status) values
    (free_course,learner,'approved'), (free_course,stranger,'pending');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('test.learner'),'role','authenticated')::text,true);
do $$
begin
  if exists (select 1 from public.academy_admins) then raise exception 'Participant can read administrator identities'; end if;
  begin
    perform public.academy_save_course(null, '{}', '[]');
    raise exception 'Participant can use admin course editor';
  exception when insufficient_privilege then null; end;
  if not exists (select 1 from public.academy_lessons where id=current_setting('test.lesson')::uuid) then raise exception 'Approved learner cannot read lesson'; end if;
  if exists (select 1 from public.academy_enrollments where user_id=current_setting('test.stranger')::uuid) then raise exception 'Participant can read another enrollment'; end if;
  insert into public.academy_progress(user_id,lesson_id) values(current_setting('test.learner')::uuid,current_setting('test.lesson')::uuid);
  begin
    insert into public.academy_progress(user_id,lesson_id) values(current_setting('test.stranger')::uuid,current_setting('test.lesson')::uuid);
    raise exception 'Participant can spoof another user progress';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.academy_enrollments(user_id,course_id,status) values(current_setting('test.learner')::uuid,current_setting('test.paid_course')::uuid,'approved');
    raise exception 'Participant can self-approve premium enrollment';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.academy_admins(user_id,role) values(current_setting('test.learner')::uuid,'admin');
    raise exception 'Participant can grant administrator role';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('test.stranger'),'role','authenticated')::text,true);
do $$
begin
  if exists(select 1 from public.academy_lessons where id=current_setting('test.lesson')::uuid) then raise exception 'Pending participant can read protected lesson'; end if;
  if exists(select 1 from public.academy_progress where user_id=current_setting('test.learner')::uuid) then raise exception 'Participant can read another user progress'; end if;
  update public.academy_enrollments set status='approved' where user_id=current_setting('test.stranger')::uuid;
  if found then raise exception 'Participant can approve own enrollment'; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('test.manager'),'role','authenticated')::text,true);
do $$
begin
  if not exists(select 1 from public.academy_admins where user_id=current_setting('test.manager')::uuid) then raise exception 'Administrator cannot read own role'; end if;
  perform public.academy_save_course(
    current_setting('test.free_course')::uuid,
    '{"title":"Updated course","description":"","category":"Pendidikan","level":"Pemula","premium":false}',
    '[{"title":"Replacement lesson","youtube_id":"dQw4w9WgXcQ"}]'
  );
  if not exists(select 1 from public.academy_lessons where id=current_setting('test.lesson')::uuid and archived) then
    raise exception 'Removed lesson was not archived';
  end if;
  if not exists(select 1 from public.academy_activity where item_id=current_setting('test.lesson')::uuid and kind='Pelajaran selesai') then
    raise exception 'Editing a course removed its activity history';
  end if;
  update public.academy_enrollments set status='approved' where user_id=current_setting('test.stranger')::uuid;
  if not found then raise exception 'Administrator cannot approve pending enrollment'; end if;
end $$;
reset role;
rollback;
select 'PASS: database RLS assertions completed; all fixture writes rolled back' as result;
