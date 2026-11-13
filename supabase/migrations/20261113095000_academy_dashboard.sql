begin;

alter table public.academy_lessons add column if not exists archived boolean not null default false;

drop policy if exists academy_lessons_active on public.academy_lessons;
create policy academy_lessons_active on public.academy_lessons as restrictive
for select to authenticated using (
  not archived or exists (select 1 from public.academy_admins where user_id = (select auth.uid()))
);

drop policy if exists academy_progress_admin_read on public.academy_progress;
create policy academy_progress_admin_read on public.academy_progress for select to authenticated
using (exists (select 1 from public.academy_admins where user_id = (select auth.uid())));

create index if not exists academy_enrollments_activity_idx on public.academy_enrollments(created_at desc, id);
create index if not exists academy_progress_activity_idx on public.academy_progress(completed_at desc, user_id, lesson_id);

create or replace function public.academy_save_course(
  course uuid, details jsonb, lessons jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  saved_id uuid;
  item record;
  position_offset integer;
begin
  if not exists (select 1 from public.academy_admins where user_id = auth.uid()) then
    raise insufficient_privilege;
  end if;
  if jsonb_array_length(lessons) = 0 then
    raise exception 'Tambahkan minimal satu pelajaran';
  end if;

  if course is null then
    insert into public.academy_courses(title,description,category,level,premium,created_by)
    values (details->>'title',details->>'description',details->>'category',
      details->>'level',(details->>'premium')::boolean,auth.uid())
    returning id into saved_id;
  else
    update public.academy_courses set title=details->>'title', description=details->>'description',
      category=details->>'category', level=details->>'level', premium=(details->>'premium')::boolean,
      updated_at=now() where id=course returning id into strict saved_id;
  end if;

  -- Vacate the active positions before applying the new order. Keep archived IDs for progress.
  select greatest(coalesce(max(position),0),jsonb_array_length(lessons))+1
    into position_offset from public.academy_lessons where course_id=saved_id;
  update public.academy_lessons set position=position+position_offset, archived=true
    where course_id=saved_id and not archived;

  for item in select value, ordinality::integer-1 as position
    from jsonb_array_elements(lessons) with ordinality
  loop
    if nullif(item.value->>'id','') is null then
      insert into public.academy_lessons(course_id,title,youtube_id,position)
      values(saved_id,item.value->>'title',item.value->>'youtube_id',item.position);
    else
      update public.academy_lessons set title=item.value->>'title', youtube_id=item.value->>'youtube_id',
        position=item.position, archived=false
        where course_id=saved_id and id=(item.value->>'id')::uuid and archived;
      if not found then raise exception 'Pelajaran tidak tersedia atau duplikat'; end if;
    end if;
  end loop;
  return saved_id;
end $$;

revoke all on function public.academy_save_course(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.academy_save_course(uuid,jsonb,jsonb) to authenticated;

create or replace view public.academy_activity with (security_invoker=true) as
select 'Pendaftaran'::text as kind, e.created_at as occurred_at, e.user_id, e.course_id,
  e.id as item_id, e.status as detail
from public.academy_enrollments e
union all
select 'Pelajaran selesai', p.completed_at, p.user_id, l.course_id, p.lesson_id, l.title
from public.academy_progress p join public.academy_lessons l on l.id=p.lesson_id;

revoke all on public.academy_activity from public, anon, authenticated;
grant select on public.academy_activity to authenticated;
commit;
