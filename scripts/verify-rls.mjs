/* global URL, console, process */

import { pathToFileURL } from 'node:url';

/**
 * Exercises deployed RLS/grant boundaries. All fixtures are rolled back.
 * Use a local Supabase instance or an explicitly approved disposable project.
 */
export const migrations = [
  '20260713010000', '20260713020000', '20260713030000', '20260713050000',
  '20260716010000', '20260716020000', '20260716030000', '20260716040000', '20260716050000', '20260716060000',
  '20260716070000', '20260716105000', '20260722200000',
];
const ids = {
  schoolA: '10000000-0000-4000-8000-000000000001', schoolB: '10000000-0000-4000-8000-000000000002',
  userA: '20000000-0000-4000-8000-000000000001', userB: '20000000-0000-4000-8000-000000000002',
  eventA: '30000000-0000-4000-8000-000000000001', eventB: '30000000-0000-4000-8000-000000000002',
  sessionA: '40000000-0000-4000-8000-000000000001', sessionB: '40000000-0000-4000-8000-000000000002',
  yearA: '50000000-0000-4000-8000-000000000001', yearB: '50000000-0000-4000-8000-000000000002',
  classA: '51000000-0000-4000-8000-000000000001', classB: '51000000-0000-4000-8000-000000000002',
  subjectA: '52000000-0000-4000-8000-000000000001', subjectB: '52000000-0000-4000-8000-000000000002',
  announcementA: '53000000-0000-4000-8000-000000000001', announcementB: '53000000-0000-4000-8000-000000000002',
  assignmentA: '54000000-0000-4000-8000-000000000001', assignmentB: '54000000-0000-4000-8000-000000000002',
  groupA: '55000000-0000-4000-8000-000000000001', groupB: '55000000-0000-4000-8000-000000000002',
  assessmentA: '56000000-0000-4000-8000-000000000001', assessmentB: '56000000-0000-4000-8000-000000000002',
  submissionA: '56500000-0000-4000-8000-000000000001', submissionB: '56500000-0000-4000-8000-000000000002',
  resultA: '57000000-0000-4000-8000-000000000001', resultB: '57000000-0000-4000-8000-000000000002',
  outboxA: '58000000-0000-4000-8000-000000000001', outboxB: '58000000-0000-4000-8000-000000000002',
};

export function missingRequiredMigrations(applied) {
  const appliedVersions = new Set(applied.map((row) => typeof row === 'string' ? row : row.version));
  return migrations.filter((version) => !appliedVersions.has(version));
}

function usage() {
  console.log(`Usage: DATABASE_URL=... npm run verify:rls

Local Supabase is allowed by default. For an empty disposable hosted project:
  RLS_VERIFY_ALLOW_REMOTE_EMPTY=1 DATABASE_URL=... npm run verify:rls`);
}

function assertSafeTarget(url) {
  const host = new URL(url).hostname;
  const isExplicitlyApproved = process.env.RLS_VERIFY_ALLOW_REMOTE_EMPTY === '1'
    || process.argv.includes('--allow-remote-empty');
  if (['localhost', '127.0.0.1', '::1'].includes(host) || isExplicitlyApproved) return;
  throw new Error('Refusing to seed a non-local database. Use an isolated target and set RLS_VERIFY_ALLOW_REMOTE_EMPTY=1 or pass --allow-remote-empty.');
}

function isDenied(error) {
  return error?.code === '42501' || /permission denied|row-level security/i.test(error?.message ?? '');
}

async function expectDenied(sql, label, operation) {
  await sql.unsafe('savepoint rls_denial_check');
  try {
    await operation();
  } catch (error) {
    if (isDenied(error)) {
      await sql.unsafe('rollback to savepoint rls_denial_check');
      return;
    }
    throw new Error(`${label} failed unexpectedly: ${error.message}`, { cause: error });
  }
  await sql.unsafe('release savepoint rls_denial_check');
  throw new Error(`${label} unexpectedly succeeded for authenticated`);
}

async function expectNoReadAccess(sql, label, operation) {
  await sql.unsafe('savepoint rls_read_check');
  try {
    const rows = await operation();
    if (rows.length === 0) {
      await sql.unsafe('release savepoint rls_read_check');
      return;
    }
  } catch (error) {
    if (isDenied(error)) {
      await sql.unsafe('rollback to savepoint rls_read_check');
      return;
    }
    throw new Error(`${label} failed unexpectedly: ${error.message}`, { cause: error });
  }
  throw new Error(`${label} unexpectedly returned a cross-tenant row`);
}

async function seed(sql) {
  await sql`insert into public.schools (id, name, school_code) values
    (${ids.schoolA}, 'RLS verifier A', 'RLS-A-VERIFY'), (${ids.schoolB}, 'RLS verifier B', 'RLS-B-VERIFY')`;
  await sql`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
    (${ids.userA}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    (${ids.userB}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())`;
  await sql`insert into public.user_profiles (id, school_id, display_name, phone_e164) values
    (${ids.userA}, ${ids.schoolA}, 'RLS A', '+15550000001'), (${ids.userB}, ${ids.schoolB}, 'RLS B', '+15550000002')`;
  await sql`insert into public.academic_years (id, school_id, name, starts_on, ends_on, is_current) values
    (${ids.yearA}, ${ids.schoolA}, 'RLS year', '2026-01-01', '2026-12-31', true),
    (${ids.yearB}, ${ids.schoolB}, 'RLS year', '2026-01-01', '2026-12-31', true)`;
  await sql`insert into public.classes (id, school_id, academic_year_id, grade, section, display_name) values
    (${ids.classA}, ${ids.schoolA}, ${ids.yearA}, '8', 'A', '8 A'),
    (${ids.classB}, ${ids.schoolB}, ${ids.yearB}, '8', 'A', '8 A')`;
  await sql`insert into public.subjects (id, school_id, code, name) values
    (${ids.subjectA}, ${ids.schoolA}, 'RLS', 'RLS subject'),
    (${ids.subjectB}, ${ids.schoolB}, 'RLS', 'RLS subject')`;
  await sql`insert into public.class_members (school_id, class_id, student_id, academic_year_id, is_active) values
    (${ids.schoolA}, ${ids.classA}, ${ids.userA}, ${ids.yearA}, true),
    (${ids.schoolB}, ${ids.classB}, ${ids.userB}, ${ids.yearB}, true)`;
  await sql`insert into public.class_subjects (school_id, class_id, subject_id, teacher_id) values
    (${ids.schoolA}, ${ids.classA}, ${ids.subjectA}, ${ids.userA}),
    (${ids.schoolB}, ${ids.classB}, ${ids.subjectB}, ${ids.userB})`;
  await sql`insert into public.class_announcements (id, school_id, class_id, category, title, body, is_published, published_at, teacher_id, subject_id) values
    (${ids.announcementA}, ${ids.schoolA}, ${ids.classA}, 'Class', 'A', 'A', true, now(), ${ids.userA}, ${ids.subjectA}),
    (${ids.announcementB}, ${ids.schoolB}, ${ids.classB}, 'Class', 'B', 'B', true, now(), ${ids.userB}, ${ids.subjectB})`;
  await sql`insert into public.announcement_resources (school_id, announcement_id, upload_session_id, object_path, display_name, resource_type) values
    (${ids.schoolA}, ${ids.announcementA}, ${ids.sessionA}, ${`${ids.schoolA}/announcement.pdf`}, 'announcement.pdf', 'pdf'),
    (${ids.schoolB}, ${ids.announcementB}, ${ids.sessionB}, ${`${ids.schoolB}/announcement.pdf`}, 'announcement.pdf', 'pdf')`;
  await sql`insert into public.assignments (id, school_id, class_id, subject_id, teacher_id, title, instructions, due_at, is_graded, grading_type, max_marks) values
    (${ids.assignmentA}, ${ids.schoolA}, ${ids.classA}, ${ids.subjectA}, ${ids.userA}, 'A', 'A', now() + interval '1 day', true, 'Numeric', 100),
    (${ids.assignmentB}, ${ids.schoolB}, ${ids.classB}, ${ids.subjectB}, ${ids.userB}, 'B', 'B', now() + interval '1 day', true, 'Numeric', 100)`;
  await sql`insert into public.assignment_rubrics (assignment_id, position, topic, marks) values
    (${ids.assignmentA}, 1, 'A', 100), (${ids.assignmentB}, 1, 'B', 100)`;
  await sql`insert into public.assignment_resources (school_id, assignment_id, upload_session_id, object_path, display_name) values
    (${ids.schoolA}, ${ids.assignmentA}, '60000000-0000-4000-8000-000000000001', ${`${ids.schoolA}/assignment.pdf`}, 'assignment.pdf'),
    (${ids.schoolB}, ${ids.assignmentB}, '60000000-0000-4000-8000-000000000002', ${`${ids.schoolB}/assignment.pdf`}, 'assignment.pdf')`;
  await sql`insert into public.assignment_submissions (school_id, assignment_id, student_id) values
    (${ids.schoolA}, ${ids.assignmentA}, ${ids.userA}), (${ids.schoolB}, ${ids.assignmentB}, ${ids.userB})`;
  await sql`insert into public.exam_groups (id, school_id, class_id, creator_teacher_id, title, starts_on, ends_on) values
    (${ids.groupA}, ${ids.schoolA}, ${ids.classA}, ${ids.userA}, 'A', '2026-06-01', '2026-06-30'),
    (${ids.groupB}, ${ids.schoolB}, ${ids.classB}, ${ids.userB}, 'B', '2026-06-01', '2026-06-30')`;
  await sql`insert into public.class_exams (id, school_id, class_id, subject_id, title, scheduled_on, is_published, published_at, exam_group_id, teacher_id, starts_at, ends_at, max_marks) values
    (${ids.assessmentA}, ${ids.schoolA}, ${ids.classA}, ${ids.subjectA}, 'A', '2026-06-10', true, now(), ${ids.groupA}, ${ids.userA}, '09:00', '10:00', 100),
    (${ids.assessmentB}, ${ids.schoolB}, ${ids.classB}, ${ids.subjectB}, 'B', '2026-06-10', true, now(), ${ids.groupB}, ${ids.userB}, '09:00', '10:00', 100)`;
  await sql`insert into public.exam_rubrics (assessment_id, position, section_title, marks, description) values
    (${ids.assessmentA}, 1, 'A', 100, 'A'), (${ids.assessmentB}, 1, 'B', 100, 'B')`;
  await sql`insert into public.exam_submissions (id, school_id, assessment_id, student_id, recorded_by_teacher_id, submitted_at) values
    (${ids.submissionA}, ${ids.schoolA}, ${ids.assessmentA}, ${ids.userA}, ${ids.userA}, now()),
    (${ids.submissionB}, ${ids.schoolB}, ${ids.assessmentB}, ${ids.userB}, ${ids.userB}, now())`;
  await sql`insert into public.exam_results (id, school_id, assessment_id, student_id, entered_by_teacher_id, marks) values
    (${ids.resultA}, ${ids.schoolA}, ${ids.assessmentA}, ${ids.userA}, ${ids.userA}, 90),
    (${ids.resultB}, ${ids.schoolB}, ${ids.assessmentB}, ${ids.userB}, ${ids.userB}, 90)`;
  await sql`insert into public.exam_result_revisions (result_id, school_id, assessment_id, student_id, entered_by_teacher_id, marks) values
    (${ids.resultA}, ${ids.schoolA}, ${ids.assessmentA}, ${ids.userA}, ${ids.userA}, 90),
    (${ids.resultB}, ${ids.schoolB}, ${ids.assessmentB}, ${ids.userB}, ${ids.userB}, 90)`;
  await sql`insert into public.exam_resources (school_id, assessment_id, upload_session_id, object_path, display_name) values
    (${ids.schoolA}, ${ids.assessmentA}, '61000000-0000-4000-8000-000000000001', ${`${ids.schoolA}/exam.pdf`}, 'exam.pdf'),
    (${ids.schoolB}, ${ids.assessmentB}, '61000000-0000-4000-8000-000000000002', ${`${ids.schoolB}/exam.pdf`}, 'exam.pdf')`;
  await sql`insert into public.academic_outbox_events (id, school_id, event_type, aggregate_type, aggregate_id, payload) values
    (${ids.outboxA}, ${ids.schoolA}, 'announcement.published', 'announcement', ${ids.announcementA}, '{}'),
    (${ids.outboxB}, ${ids.schoolB}, 'announcement.published', 'announcement', ${ids.announcementB}, '{}')`;
  await sql`insert into public.api_idempotency_keys (school_id, user_id, idempotency_key, request_hash) values
    (${ids.schoolA}, ${ids.userA}, 'rls-a', repeat('a', 64)), (${ids.schoolB}, ${ids.userB}, 'rls-b', repeat('b', 64))`;
  await sql`insert into public.upload_sessions (id, school_id, user_id, bucket, parent_type, parent_id, object_path, content_type, size_bytes, expires_at) values
    (${ids.sessionA}, ${ids.schoolA}, ${ids.userA}, 'assignments', 'assignment', 'rls-a', ${`${ids.schoolA}/rls-a.pdf`}, 'application/pdf', 1, now() + interval '10 minutes'),
    (${ids.sessionB}, ${ids.schoolB}, ${ids.userB}, 'assignments', 'assignment', 'rls-b', ${`${ids.schoolB}/rls-b.pdf`}, 'application/pdf', 1, now() + interval '10 minutes')`;
  await sql`insert into public.processed_queue_events (event_id, event_type, school_id, outcome) values
    (${ids.eventA}, 'rls.verify', ${ids.schoolA}, 'succeeded'), (${ids.eventB}, 'rls.verify', ${ids.schoolB}, 'succeeded')`;
  await sql`insert into public.queue_dead_letters (queue_name, original_message_id, event_id, school_id, envelope, error_category, error_detail) values
    ('storage_cleanup', 1001, ${ids.eventA}, ${ids.schoolA}, '{"fixture":"a"}', 'verification', 'fixture'),
    ('storage_cleanup', 1002, ${ids.eventB}, ${ids.schoolB}, '{"fixture":"b"}', 'verification', 'fixture')`;
  await sql`insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('assignments', ${`${ids.schoolA}/rls-a.pdf`}, ${ids.userA}, '{"size":1,"mimetype":"application/pdf"}'),
    ('assignments', ${`${ids.schoolB}/rls-b.pdf`}, ${ids.userB}, '{"size":1,"mimetype":"application/pdf"}'),
    ('academic-files', ${`${ids.schoolA}/academic.pdf`}, ${ids.userA}, '{"size":1,"mimetype":"application/pdf"}'),
    ('academic-files', ${`${ids.schoolB}/academic.pdf`}, ${ids.userB}, '{"size":1,"mimetype":"application/pdf"}')`;
}

async function run() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return usage();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  assertSafeTarget(databaseUrl);
  const { default: postgres } = await import('postgres');
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const applied = await sql`select version from supabase_migrations.schema_migrations where version = any(${migrations})`;
    const missing = missingRequiredMigrations(applied);
    if (missing.length) throw new Error(`Required migrations are not applied: ${missing.join(', ')}`);

    await sql.unsafe('begin');
    try {
      await seed(sql);
      await sql.unsafe('set local role authenticated');
      await sql`select set_config('request.jwt.claim.role', 'authenticated', true)`;
      await sql`select set_config('request.jwt.claim.sub', ${ids.userA}, true)`;
      await expectDenied(sql, 'cross-tenant idempotency key read', () => sql`select * from public.api_idempotency_keys where school_id = ${ids.schoolB}`);
      await expectDenied(sql, 'cross-tenant upload session read', () => sql`select * from public.upload_sessions where school_id = ${ids.schoolB}`);
      const academicSchoolTables = [
        'class_announcements',
        'announcement_resources',
        'assignments',
        'assignment_resources',
        'assignment_submissions',
        'exam_groups',
        'class_exams',
        'exam_submissions',
        'exam_results',
        'exam_result_revisions',
        'exam_resources',
        'academic_outbox_events',
      ];
      for (const table of academicSchoolTables) {
        await expectNoReadAccess(sql, `cross-tenant ${table} read`, () => sql.unsafe(
          `select * from public.${table} where school_id = '${ids.schoolB}'`,
        ));
      }
      await expectNoReadAccess(sql, 'cross-tenant assignment rubric read', () => sql.unsafe(
        `select rubric.* from public.assignment_rubrics rubric
         join public.assignments assignment on assignment.id = rubric.assignment_id
         where assignment.school_id = '${ids.schoolB}'`,
      ));
      await expectNoReadAccess(sql, 'cross-tenant exam rubric read', () => sql.unsafe(
        `select rubric.* from public.exam_rubrics rubric
         join public.class_exams exam on exam.id = rubric.assessment_id
         where exam.school_id = '${ids.schoolB}'`,
      ));
      await expectDenied(sql, 'cross-tenant processed event read', () => sql`select * from public.processed_queue_events where school_id = ${ids.schoolB}`);
      await expectDenied(sql, 'cross-tenant dead-letter read', () => sql`select * from public.queue_dead_letters where school_id = ${ids.schoolB}`);
      await expectNoReadAccess(sql, 'cross-tenant storage object read', () => sql`
        select name from storage.objects
        where bucket_id = 'assignments' and name = ${`${ids.schoolB}/rls-b.pdf`}
      `);
      await expectNoReadAccess(sql, 'cross-tenant academic storage object read', () => sql`
        select name from storage.objects
        where bucket_id = 'academic-files' and name = ${`${ids.schoolB}/academic.pdf`}
      `);
      console.log('RLS verification passed: authenticated user A cannot access tenant B platform records or storage object.');
    } finally {
      await sql.unsafe('rollback');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => { console.error("RLS verification failed: " + error.message); process.exitCode = 1; });
}
