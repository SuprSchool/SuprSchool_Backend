import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const chatRlsTestDatabaseUrl = process.env.CHAT_RLS_TEST_DATABASE_URL;
const runLiveDatabaseTest = chatRlsTestDatabaseUrl === undefined ? it.skip : it;

function assertSafeTestTarget(databaseUrl: string): void {
  const host = new URL(databaseUrl).hostname;
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
  const remoteIsExplicitlyAllowed = process.env.CHAT_RLS_ALLOW_REMOTE === '1';

  if (!isLocal && !remoteIsExplicitlyAllowed) {
    throw new Error(
      'Refusing to seed a remote database. Set CHAT_RLS_ALLOW_REMOTE=1 only for an approved disposable target.',
    );
  }
}

describe('Phase 4 chat database authorization', () => {
  runLiveDatabaseTest(
    'invokes can_access_chat_topic for class and subject student and teacher access',
    async () => {
      if (chatRlsTestDatabaseUrl === undefined) {
        throw new Error('CHAT_RLS_TEST_DATABASE_URL is required for live chat RLS verification.');
      }

      assertSafeTestTarget(chatRlsTestDatabaseUrl);
      const sql = postgres(chatRlsTestDatabaseUrl, { max: 1, prepare: false });
      const fixture = {
        academicYearId: randomUUID(),
        classAId: randomUUID(),
        classARoomId: randomUUID(),
        classBId: randomUUID(),
        mathRoomId: randomUUID(),
        mathSubjectId: randomUUID(),
        schoolId: randomUUID(),
        scienceRoomId: randomUUID(),
        scienceSubjectId: randomUUID(),
        studentFromAnotherClassId: randomUUID(),
        studentId: randomUUID(),
        teacherFromAnotherClassId: randomUUID(),
        teacherId: randomUUID(),
      };
      let transactionStarted = false;

      const topicFor = (roomId: string) => `chat:${fixture.schoolId}:${roomId}`;
      const canAccess = async (userId: string, topic: string): Promise<boolean> => {
        await sql.unsafe('set local role authenticated');
        await sql`select set_config('request.jwt.claim.role', 'authenticated', true)`;
        await sql`select set_config('request.jwt.claim.sub', ${userId}, true)`;
        const rows = await sql<{ allowed: boolean }[]>`
          select public.can_access_chat_topic(${topic}) as allowed
        `;

        return rows[0]?.allowed ?? false;
      };

      try {
        const applied = await sql<{ version: string }[]>`
          select version
          from supabase_migrations.schema_migrations
          where version = '20260716080000'
        `;
        if (applied.length !== 1) {
          throw new Error(
            'Chat migration 20260716080000 must be applied before live RLS verification.',
          );
        }

        await sql.unsafe('begin');
        transactionStarted = true;

        await sql`
          insert into public.schools (id, name, school_code)
          values (${fixture.schoolId}, 'Chat RLS Test School', ${`CHAT-${fixture.schoolId}`})
        `;
        await sql`
          insert into public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
          values (${fixture.academicYearId}, ${fixture.schoolId}, 'Chat RLS Year', '2026-06-01', '2027-05-31', true)
        `;
        await sql`
          insert into public.classes (id, school_id, academic_year_id, grade, section, display_name)
          values
            (${fixture.classAId}, ${fixture.schoolId}, ${fixture.academicYearId}, '10', 'A', '10-A'),
            (${fixture.classBId}, ${fixture.schoolId}, ${fixture.academicYearId}, '10', 'B', '10-B')
        `;
        await sql`
          insert into public.subjects (id, school_id, code, name)
          values
            (${fixture.mathSubjectId}, ${fixture.schoolId}, 'MATH', 'Mathematics'),
            (${fixture.scienceSubjectId}, ${fixture.schoolId}, 'SCI', 'Science')
        `;
        await sql`
          insert into auth.users (
            id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at
          )
          values
            (${fixture.studentId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`student-${fixture.studentId}@example.invalid`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
            (${fixture.studentFromAnotherClassId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`student-b-${fixture.studentFromAnotherClassId}@example.invalid`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
            (${fixture.teacherId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`teacher-${fixture.teacherId}@example.invalid`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
            (${fixture.teacherFromAnotherClassId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`teacher-b-${fixture.teacherFromAnotherClassId}@example.invalid`}, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
        `;
        await sql`
          insert into public.user_profiles (id, school_id, display_name, phone_e164)
          values
            (${fixture.studentId}, ${fixture.schoolId}, 'Student A', '+15550000001'),
            (${fixture.studentFromAnotherClassId}, ${fixture.schoolId}, 'Student B', '+15550000002'),
            (${fixture.teacherId}, ${fixture.schoolId}, 'Teacher A', '+15550000003'),
            (${fixture.teacherFromAnotherClassId}, ${fixture.schoolId}, 'Teacher B', '+15550000004')
        `;
        await sql`
          insert into public.user_roles (user_id, school_id, role, is_active)
          values
            (${fixture.studentId}, ${fixture.schoolId}, 'student', true),
            (${fixture.studentFromAnotherClassId}, ${fixture.schoolId}, 'student', true),
            (${fixture.teacherId}, ${fixture.schoolId}, 'teacher', true),
            (${fixture.teacherFromAnotherClassId}, ${fixture.schoolId}, 'teacher', true)
        `;
        await sql`
          insert into public.class_members (school_id, class_id, student_id, academic_year_id, is_active)
          values
            (${fixture.schoolId}, ${fixture.classAId}, ${fixture.studentId}, ${fixture.academicYearId}, true),
            (${fixture.schoolId}, ${fixture.classBId}, ${fixture.studentFromAnotherClassId}, ${fixture.academicYearId}, true)
        `;
        await sql`
          insert into public.class_subjects (school_id, class_id, subject_id, teacher_id)
          values
            (${fixture.schoolId}, ${fixture.classAId}, ${fixture.mathSubjectId}, ${fixture.teacherId}),
            (${fixture.schoolId}, ${fixture.classAId}, ${fixture.scienceSubjectId}, null),
            (${fixture.schoolId}, ${fixture.classBId}, ${fixture.mathSubjectId}, ${fixture.teacherFromAnotherClassId})
        `;
        await sql`
          insert into public.chat_rooms (id, school_id, class_id, subject_id, kind)
          values
            (${fixture.classARoomId}, ${fixture.schoolId}, ${fixture.classAId}, null, 'class'),
            (${fixture.mathRoomId}, ${fixture.schoolId}, ${fixture.classAId}, ${fixture.mathSubjectId}, 'subject'),
            (${fixture.scienceRoomId}, ${fixture.schoolId}, ${fixture.classAId}, ${fixture.scienceSubjectId}, 'subject')
        `;

        await expect(canAccess(fixture.studentId, topicFor(fixture.classARoomId))).resolves.toBe(true);
        await expect(canAccess(fixture.studentId, topicFor(fixture.mathRoomId))).resolves.toBe(true);
        await expect(canAccess(fixture.studentFromAnotherClassId, topicFor(fixture.classARoomId))).resolves.toBe(false);
        await expect(canAccess(fixture.studentFromAnotherClassId, topicFor(fixture.mathRoomId))).resolves.toBe(false);

        await expect(canAccess(fixture.teacherId, topicFor(fixture.classARoomId))).resolves.toBe(true);
        await expect(canAccess(fixture.teacherId, topicFor(fixture.mathRoomId))).resolves.toBe(true);
        await expect(canAccess(fixture.teacherId, topicFor(fixture.scienceRoomId))).resolves.toBe(false);
        await expect(canAccess(fixture.teacherFromAnotherClassId, topicFor(fixture.classARoomId))).resolves.toBe(false);
        await expect(
          canAccess(fixture.studentId, `CHAT:${fixture.schoolId}:${fixture.classARoomId}`),
        ).resolves.toBe(false);
      } finally {
        if (transactionStarted) {
          await sql.unsafe('rollback');
        }
        await sql.end({ timeout: 5 });
      }
    },
  );
});


describe("Phase 4 community school-profile migration", () => {
  it("uses a safe active-role/current-school helper for every community RLS policy", async () => {
    const migration = await readFile(
      new URL("../supabase/migrations/20260716090000_community_school_profile.sql", import.meta.url),
      "utf8",
    );
    const policySection = migration.slice(
      migration.indexOf('create policy "school members read their school profile"'),
    );

    expect(migration).toContain("create table public.school_profiles");
    expect(migration).toContain("create table public.school_gallery_items");
    expect(migration).toMatch(
      /create function public\.has_active_role_in_current_school\(target_school_id text\)[\s\S]*?security definer[\s\S]*?set search_path = ''[\s\S]*?active_role\.is_active = true/,
    );
    expect(migration).toContain(
      'revoke all on function public.has_active_role_in_current_school(text) from public;',
    );
    expect(migration).toContain(
      'grant execute on function public.has_active_role_in_current_school(text) to authenticated;',
    );
    expect(migration).toContain(`create policy "school members read their school profile"`);
    expect(migration).toContain(`create policy "school members read their published gallery"`);
    expect(migration).toContain(`create policy "school members read published school gallery objects"`);
    expect(policySection.match(/public\.has_active_role_in_current_school/g)).toHaveLength(3);
    expect(policySection).not.toMatch(/from public\.user_profiles/i);
    expect(migration).not.toMatch(/school_(profiles|gallery_items) for (insert|update|delete)/i);
  });

  it("keeps gallery signing queries bounded and teacher announcements within current classes", async () => {
    const repository = await readFile(
      new URL("../src/db/repositories/community-profile.repository.ts", import.meta.url),
      "utf8",
    );

    expect(repository).toContain('CURRENT_SCHOOL_GALLERY_PAGE_SIZE');
    expect(repository).toContain(
      '.orderBy(asc(schoolGalleryItems.sortOrder), asc(schoolGalleryItems.id))',
    );
    expect(repository).toContain('.limit(CURRENT_SCHOOL_GALLERY_PAGE_SIZE)');
    expect(repository).toMatch(
      /from public\.class_subjects as assignment[\s\S]*?join public\.classes as assigned_class[\s\S]*?join public\.academic_years as academic_year[\s\S]*?academic_year\.is_current = true/,
    );
  });
});

describe('Phase 4 points ledger migration', () => {
  it('defines immutable, idempotent point awards and atomic balance maintenance', async () => {
    const migration = await readFile(
      new URL('../supabase/migrations/20260716100000_points_rankings.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toContain('create table public.point_level_rules');
    expect(migration).toContain('create table public.point_earning_rules');
    expect(migration).toContain('create table public.point_ledger_entries');
    expect(migration).toContain('create table public.point_account_balances');
    expect(migration).toContain('unique (school_id, award_key)');
    expect(migration).toMatch(
      /create function public\.apply_point_ledger_entry_to_balance\(\)[\s\S]*?security definer[\s\S]*?insert into public\.point_account_balances[\s\S]*?current_points = public\.point_account_balances\.current_points \+ excluded\.current_points/,
    );
    expect(migration).toContain('create trigger point_ledger_entries_update_balance');
    expect(migration).toMatch(
      /create function public\.apply_point_ledger_entry_to_balance\(\)[\s\S]*?insert into public\.point_account_balances[\s\S]*?insert into public\.ranking_refresh_requests[\s\S]*?on conflict \(school_id, recipient_user_id\) do update/,
    );
    expect(migration).toContain('create table public.ranking_refresh_requests');
    expect(migration).not.toMatch(/point_ledger_entries for (insert|update|delete)/i);
  });
});


describe('Phase 4 ranking snapshots migration', () => {
  it('uses additive scope versions, a transactional outbox, and immutable snapshots', async () => {
    const migration = await readFile(
      new URL('../supabase/migrations/20260716110000_phase4_ranking_snapshots.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toContain('create table public.ranking_refresh_scopes');
    expect(migration).toContain('dirty_version bigint not null default 1');
    expect(migration).toContain('refreshed_version bigint not null default 0');
    expect(migration).toContain('create table public.ranking_refresh_outbox');
    expect(migration).toContain('unique (scope_id, target_version)');
    expect(migration).toContain('create table public.ranking_snapshots');
    expect(migration).toContain('create table public.ranking_entries');
    expect(migration).toContain('create or replace function public.apply_point_ledger_entry_to_balance()');
    expect(migration).toContain('perform public.queue_ranking_scope_refresh');
    expect(migration).toContain('for subject_scope in');
    expect(migration).toContain('ranking_snapshots_current_index');
  });
});


describe('Phase 4 ranking revision and group invalidation', () => {
  it('uses the latest published result revision and rebuilds old/new class scopes when groups change', async () => {
    const [migration, repository] = await Promise.all([
      readFile(
        new URL('../supabase/migrations/20260716110000_phase4_ranking_snapshots.sql', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/db/repositories/ranking.repository.ts', import.meta.url),
        'utf8',
      ),
    ]);

    expect(repository).toMatch(
      /join public\.exam_groups as exam_group[\s\S]*?exam_group\.deleted_at is null[\s\S]*?left join lateral[\s\S]*?from public\.exam_result_revisions as revision[\s\S]*?revision\.published_at is not null[\s\S]*?order by revision\.published_at desc, revision\.created_at desc, revision\.id desc/,
    );
    expect(repository).toContain('coalesce(revision.marks, result.marks)');
    expect(migration).toContain('exam_result_revisions_queue_ranking_refresh');
    expect(migration).toContain('exam_groups_queue_ranking_refresh');
    expect(migration).toContain('queue_ranking_refresh_for_exam_group_change');
  });
});

describe('Phase 4 chat room provisioning migration', () => {
  it('backfills and idempotently provisions only current-school class and assigned-subject rooms', async () => {
    const migration = await readFile(
      new URL('../supabase/migrations/20260716160000_phase4_chat_avatar_hardening.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toMatch(
      /insert into public\.chat_rooms \(school_id, class_id, subject_id, kind\)[\s\S]*?join public\.academic_years as academic_year[\s\S]*?academic_year\.is_current = true[\s\S]*?on conflict do nothing/,
    );
    expect(migration).toMatch(
      /create (?:or replace )?function public\.provision_current_class_chat_rooms\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/,
    );
    expect(migration).toContain('after insert on public.classes');
    expect(migration).toContain('after insert or update of teacher_id on public.class_subjects');
    expect(migration).toContain('after update of is_current on public.academic_years');
    expect(migration).toMatch(/new\.teacher_id is null[\s\S]*?return new/);
    expect(migration).toContain('class.school_id = new.school_id');
    expect(migration).toContain('subject.school_id = new.school_id');
  });
});
