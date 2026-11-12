import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function requiredText(value, field, maximum) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > maximum || value.includes('\0')) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function sourceId(value, field) {
  return requiredText(value, field, 200);
}

function stableUuid(kind, ...parts) {
  const bytes = createHash('sha256').update(JSON.stringify(['guru-creator-academy', kind, ...parts]))
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function emailAddress(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) &&
    !value.includes('\0') && value.length <= 320 ? value.trim().toLowerCase() : null;
}

function normalizeArchive(archive, ownerEmail) {
  if (archive?.schemaVersion !== 1 || !Array.isArray(archive.courses) || !Array.isArray(archive.enrollments)) {
    throw new Error('Expected an Academy migration export with schemaVersion 1');
  }

  const courseIndex = new Map();
  const lessons = [];
  const courses = archive.courses.map((course, index) => {
    const field = `courses[${index}]`;
    const legacyId = sourceId(course.id, `${field}.id`);
    if (courseIndex.has(legacyId)) throw new Error(`Duplicate ${field}.id`);
    if (!Array.isArray(course.lessons) || !course.lessons.length || typeof course.premium !== 'boolean') {
      throw new Error(`Invalid lessons or premium value in ${field}`);
    }
    const id = stableUuid('course', legacyId);
    const lessonIndex = new Map();
    courseIndex.set(legacyId, { id, lessonIndex });
    course.lessons.forEach((lesson, position) => {
      const lessonField = `${field}.lessons[${position}]`;
      const legacyLessonId = sourceId(lesson.id, `${lessonField}.id`);
      if (lessonIndex.has(legacyLessonId)) throw new Error(`Duplicate ${lessonField}.id`);
      if (typeof lesson.youtubeId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(lesson.youtubeId)) {
        throw new Error(`Invalid YouTube ID in ${lessonField}`);
      }
      const lessonId = stableUuid('lesson', legacyId, legacyLessonId);
      lessonIndex.set(legacyLessonId, lessonId);
      lessons.push({ id: lessonId, course_id: id, title: requiredText(lesson.title, `${lessonField}.title`, 160),
        youtube_id: lesson.youtubeId, position });
    });
    const createdAt = Date.parse(course.createdAt);
    if (!Number.isFinite(createdAt)) throw new Error(`Invalid ${field}.createdAt`);
    const description = course.description ?? '';
    if (typeof description !== 'string' || description.includes('\0')) throw new Error(`Invalid ${field}.description`);
    return { id, title: requiredText(course.title, `${field}.title`, 160), description,
      category: requiredText(course.category, `${field}.category`, 200), level: requiredText(course.level, `${field}.level`, 200),
      premium: course.premium, created_at: new Date(createdAt).toISOString() };
  });

  let staleProgress = 0;
  const enrollmentKeys = new Set();
  const enrollments = archive.enrollments.map((record, index) => {
    const field = `enrollments[${index}]`;
    const course = courseIndex.get(record.courseId);
    if (!course || !['pending', 'approved', 'rejected'].includes(record.status) || !Array.isArray(record.completed)) {
      throw new Error(`Invalid ${field}`);
    }
    const email = emailAddress(record.studentEmail);
    const identity = email ?? sourceId(record.userId, `${field}.userId`);
    const key = JSON.stringify([course.id, identity]);
    if (enrollmentKeys.has(key)) throw new Error(`Duplicate enrollment in ${field}`);
    enrollmentKeys.add(key);
    const completed = [];
    for (const legacyId of new Set(record.completed)) {
      const id = course.lessonIndex.get(legacyId);
      if (id) completed.push(id);
      else staleProgress++;
    }
    return { course_id: course.id, email, status: record.status, completed };
  });
  return { owner_email: ownerEmail, courses, lessons, enrollments, stale_progress: staleProgress };
}

export function prepareImport(archive, ownerEmail) {
  const verifiedOwnerEmail = emailAddress(ownerEmail);
  if (!verifiedOwnerEmail) throw new Error('Enter the email of a verified Supabase Academy administrator');
  const payload = Buffer.from(JSON.stringify(normalizeArchive(archive, verifiedOwnerEmail))).toString('base64');
  return `begin;

create temporary table academy_import_payload on commit drop as
select convert_from(decode('${payload}', 'base64'), 'UTF8')::jsonb as data;

create temporary table academy_import_owner on commit drop as
select u.id from auth.users u
join public.academy_admins a on a.user_id = u.id
where lower(u.email) = (select data->>'owner_email' from academy_import_payload)
  and u.email_confirmed_at is not null and not u.is_anonymous;

do $$
begin
  if (select count(*) from academy_import_owner) <> 1 then
    raise exception 'The import owner must match one verified Academy administrator';
  end if;
end
$$;

insert into public.academy_courses(id, title, description, category, level, premium, created_at, created_by)
select c.id, c.title, c.description, c.category, c.level, c.premium, c.created_at, o.id
from academy_import_payload p
cross join lateral jsonb_to_recordset(p.data->'courses') c(
  id uuid, title text, description text, category text, level text, premium boolean, created_at timestamptz
)
cross join academy_import_owner o
on conflict (id) do nothing;

insert into public.academy_lessons(id, course_id, title, youtube_id, position)
select l.id, l.course_id, l.title, l.youtube_id, l.position
from academy_import_payload p
cross join lateral jsonb_to_recordset(p.data->'lessons') l(
  id uuid, course_id uuid, title text, youtube_id text, position integer
)
on conflict (id) do nothing;

create temporary table academy_import_enrollments on commit drop as
select e.*, identity.user_id
from academy_import_payload p
cross join lateral jsonb_to_recordset(p.data->'enrollments') e(course_id uuid, email text, status text, completed uuid[])
left join lateral (
  select (array_agg(u.id))[1] as user_id
  from auth.users u
  where lower(u.email) = e.email and u.email_confirmed_at is not null and not u.is_anonymous
  having count(*) = 1
) identity on true;

insert into public.academy_enrollments(course_id, user_id, status)
select course_id, user_id, status from academy_import_enrollments where user_id is not null
on conflict (course_id, user_id) do nothing;

insert into public.academy_progress(user_id, lesson_id)
select i.user_id, lesson.id
from academy_import_enrollments i
join public.academy_enrollments e on e.course_id = i.course_id and e.user_id = i.user_id
join public.academy_lessons lesson on lesson.course_id = i.course_id and lesson.id = any(i.completed)
where i.status = 'approved' and e.status = 'approved'
on conflict (user_id, lesson_id) do nothing;

select jsonb_array_length(data->'courses') as archived_courses,
       jsonb_array_length(data->'lessons') as archived_lessons,
       (select count(*) from academy_import_enrollments where user_id is not null) as matched_enrollments,
       (select count(*) from academy_import_enrollments where user_id is null) as unmatched_enrollments,
       (data->>'stale_progress')::integer as removed_lesson_references
from academy_import_payload;

commit;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ownerEmail] = process.argv.slice(2);
  try {
    if (!file || !ownerEmail) throw new Error('Usage: node scripts/prepare-appdeploy-import.mjs archive.json administrator@example.org');
    process.stdout.write(prepareImport(JSON.parse(await readFile(file, 'utf8')), ownerEmail));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
