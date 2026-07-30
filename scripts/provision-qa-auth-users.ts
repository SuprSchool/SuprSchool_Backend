import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { inArray, sql } from 'drizzle-orm';

import { createDatabase, type Database } from '../src/db/client.js';
import { classAnnouncements } from '../src/db/schema/announcements.js';
import { assignments, assignmentRubrics } from '../src/db/schema/assignments.js';
import { attendanceRecords, attendanceSessions } from '../src/db/schema/attendance.js';
import { chatMessages, chatReadCursors, chatRooms } from '../src/db/schema/chat.js';
import { classDiaryEntries } from '../src/db/schema/diary.js';
import { eventAudiences, eventManagers, eventRegistrations, events } from '../src/db/schema/events.js';
import { classExams, examGroups, examResults, examRubrics, examSubmissions } from '../src/db/schema/exams.js';
import { pointLedgerEntries } from '../src/db/schema/points.js';
import {
  academicYears,
  classes,
  classMembers,
  classSubjects,
  schoolDirectoryEntries,
  schoolDirectoryTeacherAssignments,
  schools,
  subjects,
  userProfiles,
  userRoles,
  profileInterests,
} from '../src/db/schema/core.js';

const QA_SCHOOL_ID = '20000000-0000-4000-8000-000000000001';
const QA_ACADEMIC_YEAR_ID = '30000000-0000-4000-8000-000000000001';
const QA_CLASS_ID = '40000000-0000-4000-8000-000000000001';
const QA_STUDENT_DIRECTORY_ID = '60000000-0000-4000-8000-000000000001';
const QA_TEACHER_DIRECTORY_ID = '60000000-0000-4000-8000-000000000002';
const QA_SUBJECTS = [
  ['50000000-0000-4000-8000-000000000001', 'ENG', 'English'],
  ['50000000-0000-4000-8000-000000000002', 'HIS', 'History'],
  ['50000000-0000-4000-8000-000000000003', 'MAT', 'Mathematics'],
  ['50000000-0000-4000-8000-000000000004', 'PHY', 'Physics'],
  ['50000000-0000-4000-8000-000000000005', 'CSE', 'Computer Science'],
] as const;

export interface ExistingDirectoryClaim {
  phoneE164: string;
  claimedByUserId: string | null;
}

export interface QaProvisioningPlanInput {
  studentUserId: string;
  teacherUserId: string;
  existingDirectoryClaims: readonly ExistingDirectoryClaim[];
}

export interface QaProvisioningUser {
  userId: string;
  role: 'student' | 'teacher';
  phoneE164: string;
  displayName: string;
  directoryClaim: 'claim' | 'already-claimed';
}

export interface QaProvisioningPlan {
  users: readonly QaProvisioningUser[];
}

export function assertQaProvisioningSafety(input: {
  NODE_ENV: string | undefined;
  QA_PROVISION_CONFIRM: string | undefined;
  QA_PROVISION_ALLOW_PRODUCTION: string | undefined;
}): void {
  if (input.QA_PROVISION_CONFIRM !== '1') {
    throw new Error('QA provisioning requires QA_PROVISION_CONFIRM=1');
  }
  if (input.NODE_ENV === 'production' && input.QA_PROVISION_ALLOW_PRODUCTION !== '1') {
    throw new Error('QA provisioning in production requires QA_PROVISION_ALLOW_PRODUCTION=1');
  }
}

export function buildQaProvisioningPlan(input: QaProvisioningPlanInput): QaProvisioningPlan {
  if (!input.studentUserId || !input.teacherUserId) {
    throw new Error('An Admin Auth user ID is required for each QA fixture');
  }

  const users = [
    { userId: input.studentUserId, role: 'student' as const, phoneE164: '+917755090948', displayName: 'QA Student' },
    { userId: input.teacherUserId, role: 'teacher' as const, phoneE164: '+919000000001', displayName: 'Mr. Alok' },
  ];

  return {
    users: users.map((user) => {
      const existing = input.existingDirectoryClaims.find((claim) => claim.phoneE164 === user.phoneE164);
      if (existing?.claimedByUserId && existing.claimedByUserId !== user.userId) {
        throw new Error('QA directory phone is already claimed by another user');
      }
      return { ...user, directoryClaim: existing?.claimedByUserId === user.userId ? 'already-claimed' : 'claim' };
    }),
  };
}

export interface QaProvisioningExecutor {
  inspectDirectoryClaims(): Promise<readonly ExistingDirectoryClaim[]>;
  inspectAuthUsers(): Promise<{ studentUserId: string | null; teacherUserId: string | null }>;
  ensureAuthUsers(input: { studentUserId: string | null; teacherUserId: string | null }): Promise<{ studentUserId: string; teacherUserId: string }>;
  provisionPublicFixtures(input: { studentUserId: string; teacherUserId: string }): Promise<void>;
}

function assertPreflightDirectoryClaims(claims: readonly ExistingDirectoryClaim[], users: { studentUserId: string | null; teacherUserId: string | null }): void {
  const expectedUserIdByPhone = new Map([
    ['+917755090948', users.studentUserId],
    ['+919000000001', users.teacherUserId],
  ]);
  for (const claim of claims) {
    if (claim.claimedByUserId && expectedUserIdByPhone.get(claim.phoneE164) !== claim.claimedByUserId) {
      throw new Error('QA directory phone is already claimed by another user');
    }
  }
}

export async function executeQaProvisioning(executor: QaProvisioningExecutor): Promise<QaProvisioningPlan> {
  const [existingDirectoryClaims, inspectedAuthUsers] = await Promise.all([
    executor.inspectDirectoryClaims(),
    executor.inspectAuthUsers(),
  ]);
  assertPreflightDirectoryClaims(existingDirectoryClaims, inspectedAuthUsers);
  const userIds = await executor.ensureAuthUsers(inspectedAuthUsers);
  const plan = buildQaProvisioningPlan({ ...userIds, existingDirectoryClaims });
  await executor.provisionPublicFixtures(userIds);
  return plan;
}
export interface QaAdminUser {
  id: string;
  phone?: string | null;
  phone_confirmed_at?: string | null;
}

export interface QaAdminResult {
  data: { user?: QaAdminUser | null; users?: readonly QaAdminUser[] };
  error: { message?: string } | null;
}

export interface QaAdminClient {
  auth: { admin: {
    createUser(input: { phone: string; password: string; phone_confirm: true }): Promise<QaAdminResult>;
    deleteUser(userId: string): Promise<QaAdminResult>;
    getUserById(userId: string): Promise<QaAdminResult>;
    listUsers(input: { page: number; perPage: number }): Promise<QaAdminResult>;
  } };
}

export async function findQaAdminUserByPhone(client: QaAdminClient, phoneE164: string): Promise<QaAdminUser | null> {
  for (let page = 1; ; page += 1) {
    const listed = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (listed.error !== null) throw new Error('Unable to inspect QA Auth users');
    const users = listed.data.users ?? [];
    const existing = users.find((user) => user.phone === phoneE164);
    if (existing) return existing;
    if (users.length < 1000) return null;
  }
}

export async function prepareQaAuthUser(
  client: QaAdminClient,
  fixture: { phoneE164: string },
  expectedUserId: string | null,
): Promise<QaAdminUser | null> {
  const existing = await findQaAdminUserByPhone(client, fixture.phoneE164);
  if ((existing?.id ?? null) !== expectedUserId) {
    throw new Error('QA Auth identity changed since preflight');
  }
  if (existing === null) return null;

  const verified = await client.auth.admin.getUserById(existing.id);
  if (verified.error !== null) throw new Error('Unable to verify existing QA Auth user');
  const user = verified.data.user;
  if (!user || user.phone !== fixture.phoneE164 || !user.phone_confirmed_at) {
    throw new Error('Existing QA user is not a verified Admin Auth identity');
  }
  return user;
}

export interface AppliedQaAuthUser {
  userId: string;
  created: boolean;
}

export async function applyQaAuthUser(
  client: QaAdminClient,
  fixture: { phoneE164: string; password: string },
  preparedUser: QaAdminUser | null,
): Promise<AppliedQaAuthUser> {
  if (preparedUser !== null) return { userId: preparedUser.id, created: false };

  const created = await client.auth.admin.createUser({ phone: fixture.phoneE164, password: fixture.password, phone_confirm: true });
  if (created.error !== null || !created.data.user) throw new Error('Unable to create QA Auth user');
  return { userId: created.data.user.id, created: true };
}

export async function ensureQaAuthUser(
  client: QaAdminClient,
  fixture: { phoneE164: string; password: string },
  expectedUserId: string | null,
): Promise<string> {
  const preparedUser = await prepareQaAuthUser(client, fixture, expectedUserId);
  return (await applyQaAuthUser(client, fixture, preparedUser)).userId;
}

export function buildQaUserBoundFixtureRows(input: {
  studentUserId: string;
  teacherUserId: string;
}) {
  return {
    event: { id: '93000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, createdByTeacherId: input.teacherUserId, activityKind: 'competition', category: 'Curricular Competition', participationMode: 'solo', title: 'Drama Club Fest', description: 'A showcase of student talent featuring plays, skits, and improv sessions.', venue: 'Main Auditorium, Building A', eligibilityCriteria: 'Open to Classes 9 and 10.', startsAt: new Date('2026-02-04T09:00:00.000Z'), endsAt: new Date('2026-02-04T11:00:00.000Z'), registrationDeadlineAt: new Date('2026-01-29T00:00:00.000Z'), lifecycle: 'published', resultsPublishedAt: null, resultsRevision: 0 },
    eventAudience: { schoolId: QA_SCHOOL_ID, eventId: '93000000-0000-4000-8000-000000000001', classId: QA_CLASS_ID },
    eventManager: { schoolId: QA_SCHOOL_ID, eventId: '93000000-0000-4000-8000-000000000001', userId: input.teacherUserId, memberType: 'teacher', managerRole: 'Competition Manager' },
    eventRegistration: { id: '94000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, eventId: '93000000-0000-4000-8000-000000000001', studentId: input.studentUserId, participationTag: 'Solo performance' },
    pointLedgerEntries: [
      { id: '95000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, recipientUserId: input.studentUserId, sourceType: 'assignment_submission' as const, sourceId: '85000000-0000-4000-8000-000000000001', ruleCode: 'assignment_submission', awardKey: 'qa-assignment-submission', points: 15, metadata: {}, occurredAt: new Date('2026-01-13T00:00:00.000Z') },
      { id: '95000000-0000-4000-8000-000000000002', schoolId: QA_SCHOOL_ID, recipientUserId: input.studentUserId, sourceType: 'event_registration' as const, sourceId: '94000000-0000-4000-8000-000000000001', ruleCode: 'event_registration', awardKey: 'qa-event-registration', points: 10, metadata: {}, occurredAt: new Date('2026-01-14T00:00:00.000Z') },
    ],
    examGroup: { id: '86000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, creatorTeacherId: input.teacherUserId, title: 'Unit Tests - Term 1', startsOn: '2026-01-20', endsOn: '2026-01-27', state: 'published' as const },
    classExams: [
      { id: '87000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, subjectId: '50000000-0000-4000-8000-000000000003', examGroupId: '86000000-0000-4000-8000-000000000001', teacherId: input.teacherUserId, title: 'Unit Test - Mathematics', scheduledOn: '2026-01-22', startsAt: '09:00', endsAt: '10:00', maxMarks: 50, syllabus: 'Algebra and linear equations', isPublished: true, publishedAt: new Date('2026-01-15T00:00:00.000Z') },
      { id: '87000000-0000-4000-8000-000000000002', schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, subjectId: '50000000-0000-4000-8000-000000000004', examGroupId: '86000000-0000-4000-8000-000000000001', teacherId: input.teacherUserId, title: 'Unit Test - Science', scheduledOn: '2026-01-25', startsAt: '10:00', endsAt: '11:00', maxMarks: 50, syllabus: 'Kinematics and energy', isPublished: true, publishedAt: new Date('2026-01-15T00:00:00.000Z') },
    ],
    examRubrics: [
      { assessmentId: '87000000-0000-4000-8000-000000000001', position: 1, sectionTitle: 'Algebra', marks: 30, description: 'Solve equations accurately.' },
      { assessmentId: '87000000-0000-4000-8000-000000000001', position: 2, sectionTitle: 'Reasoning', marks: 20, description: 'Show clear working.' },
    ],
    examSubmissions: [
      { id: '88000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, assessmentId: '87000000-0000-4000-8000-000000000001', studentId: input.studentUserId, recordedByTeacherId: input.teacherUserId, submittedAt: new Date('2026-01-14T00:00:00.000Z') },
    ],
    examResults: [
      { id: '89000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, assessmentId: '87000000-0000-4000-8000-000000000001', studentId: input.studentUserId, enteredByTeacherId: input.teacherUserId, marks: 42, feedback: 'Strong understanding of the method.', publishedAt: new Date('2026-01-15T00:00:00.000Z') },
    ],
    classChat: {
      room: { id: '90000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, subjectId: null, kind: 'class' as const },
      messages: [
        { id: '91000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, roomId: '90000000-0000-4000-8000-000000000001', senderId: input.teacherUserId, clientMessageId: '92000000-0000-4000-8000-000000000001', body: 'Ask anything and your teacher will answer it ASAP.' },
        { id: '91000000-0000-4000-8000-000000000002', schoolId: QA_SCHOOL_ID, roomId: '90000000-0000-4000-8000-000000000001', senderId: input.studentUserId, clientMessageId: '92000000-0000-4000-8000-000000000002', body: 'Can you explain the variables exercise again?' },
      ],
      readCursor: { schoolId: QA_SCHOOL_ID, roomId: '90000000-0000-4000-8000-000000000001', userId: input.studentUserId, lastReadMessageId: '91000000-0000-4000-8000-000000000002', lastReadAt: new Date('2026-01-15T00:00:00.000Z') },
    },    studentProfile: { id: input.studentUserId, schoolId: QA_SCHOOL_ID, displayName: 'QA Student', phoneE164: '+917755090948', avatarKind: 'preset' as const, avatarValue: 'avatar-1' },
    teacherProfile: { id: input.teacherUserId, schoolId: QA_SCHOOL_ID, displayName: 'Mr. Alok', phoneE164: '+919000000001', avatarKind: 'preset' as const, avatarValue: 'avatar-2' },
    studentDirectory: { id: QA_STUDENT_DIRECTORY_ID, schoolId: QA_SCHOOL_ID, phoneE164: '+917755090948', role: 'student' as const, displayName: 'QA Student', rollNumber: '09B-001', employeeCode: null, studentClassId: QA_CLASS_ID, status: 'claimed' as const, claimedByUserId: input.studentUserId },
    teacherDirectory: { id: QA_TEACHER_DIRECTORY_ID, schoolId: QA_SCHOOL_ID, phoneE164: '+919000000001', role: 'teacher' as const, displayName: 'Mr. Alok', rollNumber: null, employeeCode: 'T-001', studentClassId: null, status: 'claimed' as const, claimedByUserId: input.teacherUserId },
    classMember: { schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, academicYearId: QA_ACADEMIC_YEAR_ID, studentId: input.studentUserId, rollNumber: '09B-001', isActive: true },
    classSubjects: QA_SUBJECTS.map(([subjectId]) => ({ schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, subjectId, teacherId: input.teacherUserId })),
    attendanceSessions: [
      { id: '82000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, attendanceDate: '2026-01-15', markedByTeacherId: input.teacherUserId },
    ],
    attendanceRecords: [
      { sessionId: '82000000-0000-4000-8000-000000000001', studentId: input.studentUserId, status: 'present' as const },
    ],
    diaryEntries: [
      { id: '83000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, classSubjectId: '70000000-0000-4000-8000-000000000001', teacherId: input.teacherUserId, occurredOn: '2026-01-15', periodLabel: '2nd Period', title: 'Chapter 4 - The Lion King', description: 'We covered the key events, characters, and the Circle of Life theme.', keyPoints: ['Introduced Simba and Mufasa', 'Discussed the central theme'] },
      { id: '83000000-0000-4000-8000-000000000002', schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, classSubjectId: '70000000-0000-4000-8000-000000000003', teacherId: input.teacherUserId, occurredOn: '2026-01-14', periodLabel: '4th Period', title: 'Algebra revision', description: 'Revision of variables, expressions, and linear equations.', keyPoints: ['Variables', 'Linear equations'] },
    ],
    assignments: [
      { id: '84000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, subjectId: '50000000-0000-4000-8000-000000000001', teacherId: input.teacherUserId, title: 'Character Sketch Writing', instructions: 'Write a brief character sketch of a protagonist from any chapter discussed in class.', dueAt: new Date('2026-01-29T00:00:00.000Z'), isGraded: true, gradingType: 'Numeric' as const, maxMarks: 35 },
      { id: '84000000-0000-4000-8000-000000000002', schoolId: QA_SCHOOL_ID, classId: QA_CLASS_ID, subjectId: '50000000-0000-4000-8000-000000000003', teacherId: input.teacherUserId, title: 'Algebra Practice', instructions: 'Solve the assigned linear-equation exercises and show all working.', dueAt: new Date('2026-01-22T00:00:00.000Z'), isGraded: true, gradingType: 'Numeric' as const, maxMarks: 25 },
    ],
    assignmentRubrics: [
      { assignmentId: '84000000-0000-4000-8000-000000000001', position: 1, topic: 'Character understanding', marks: 15, moreInfo: 'Explain feelings and development.' },
      { assignmentId: '84000000-0000-4000-8000-000000000001', position: 2, topic: 'Clarity and writing', marks: 20, moreInfo: 'Use clear paragraphs and examples.' },
    ],
    profileInterests: [
      'Reading', 'Music', 'Football', 'Drawing', 'Technology',
    ].map((interest) => ({ userId: input.studentUserId, interest })).concat([
      { userId: input.teacherUserId, interest: 'Literature' },
      { userId: input.teacherUserId, interest: 'Public Speaking' },
    ]),
    announcements: [
      { id: '80000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, audienceType: 'class' as const, classId: QA_CLASS_ID, teacherId: input.teacherUserId, subjectId: '50000000-0000-4000-8000-000000000001', category: 'School' as const, title: 'Winter Break Notice', body: 'The school will remain closed from 24th December to 2nd January. Classes resume on 3rd January.', isPublished: true, publishedAt: new Date('2026-01-01T00:00:00.000Z') },
      { id: '80000000-0000-4000-8000-000000000002', schoolId: QA_SCHOOL_ID, audienceType: 'class' as const, classId: QA_CLASS_ID, teacherId: input.teacherUserId, subjectId: '50000000-0000-4000-8000-000000000003', category: 'Class' as const, title: 'Mathematics Test Rescheduled', body: 'The Mathematics unit test is rescheduled to 19th December.', isPublished: true, publishedAt: new Date('2026-01-01T00:00:00.000Z') },
    ],
    notificationInbox: [
      { id: '81000000-0000-4000-8000-000000000001', schoolId: QA_SCHOOL_ID, userId: input.studentUserId, notificationType: 'announcement', title: 'Winter Break Notice', body: 'The school holiday announcement is available.', data: { announcementId: '80000000-0000-4000-8000-000000000001' } },
      { id: '81000000-0000-4000-8000-000000000002', schoolId: QA_SCHOOL_ID, userId: input.studentUserId, notificationType: 'assignment', title: 'New assignment', body: 'Character Sketch Writing is due soon.', data: {} },
    ],
  };
}

export async function provisionQaPublicFixtures(db: Database, input: {
  studentUserId: string;
  teacherUserId: string;
}): Promise<void> {
  const rows = buildQaUserBoundFixtureRows(input);
  await db.transaction(async (transaction) => {
    await transaction.insert(schools).values({ id: QA_SCHOOL_ID, name: 'Riverside International School', schoolCode: 'RIVERSIDE-QA' }).onConflictDoUpdate({ target: schools.id, set: { name: 'Riverside International School', schoolCode: 'RIVERSIDE-QA' } });
    await transaction.insert(academicYears).values({ id: QA_ACADEMIC_YEAR_ID, schoolId: QA_SCHOOL_ID, name: '2025-2026', startsOn: '2025-04-01', endsOn: '2026-03-31', isCurrent: true }).onConflictDoUpdate({ target: academicYears.id, set: { isCurrent: true } });
    await transaction.insert(classes).values({ id: QA_CLASS_ID, schoolId: QA_SCHOOL_ID, academicYearId: QA_ACADEMIC_YEAR_ID, grade: '9', section: 'B', displayName: 'Class 9 - B' }).onConflictDoUpdate({ target: classes.id, set: { displayName: 'Class 9 - B' } });
    await transaction.insert(subjects).values(QA_SUBJECTS.map(([id, code, name]) => ({ id, schoolId: QA_SCHOOL_ID, code, name }))).onConflictDoUpdate({ target: subjects.id, set: { name: sql`excluded.name` } });
    const claimedDirectoryEntries = await transaction.insert(schoolDirectoryEntries).values([rows.studentDirectory, rows.teacherDirectory]).onConflictDoUpdate({
      target: schoolDirectoryEntries.phoneE164,
      set: {
        schoolId: sql`excluded.school_id`,
        role: sql`excluded.role`,
        displayName: sql`excluded.display_name`,
        rollNumber: sql`excluded.roll_number`,
        employeeCode: sql`excluded.employee_code`,
        studentClassId: sql`excluded.student_class_id`,
        status: 'claimed',
        claimedByUserId: sql`coalesce(${schoolDirectoryEntries.claimedByUserId}, excluded.claimed_by_user_id)`,
        claimedAt: sql`coalesce(${schoolDirectoryEntries.claimedAt}, now())`,
      },
      where: sql`${schoolDirectoryEntries.claimedByUserId} is null or ${schoolDirectoryEntries.claimedByUserId} = excluded.claimed_by_user_id`,
    }).returning({ id: schoolDirectoryEntries.id, phoneE164: schoolDirectoryEntries.phoneE164 });
    if (claimedDirectoryEntries.length !== 2) {
      throw new Error('QA directory phone is already claimed by another user');
    }
    const teacherDirectoryId = claimedDirectoryEntries.find((entry) => entry.phoneE164 === rows.teacherDirectory.phoneE164)?.id;
    if (!teacherDirectoryId) {
      throw new Error('QA directory phone is already claimed by another user');
    }
    await transaction.insert(userProfiles).values([rows.studentProfile, rows.teacherProfile]).onConflictDoUpdate({ target: userProfiles.id, set: { displayName: sql`excluded.display_name`, phoneE164: sql`excluded.phone_e164`, avatarKind: sql`excluded.avatar_kind`, avatarValue: sql`excluded.avatar_value`, updatedAt: sql`now()` } });
    await transaction.insert(userRoles).values([{ userId: input.studentUserId, schoolId: QA_SCHOOL_ID, role: 'student' }, { userId: input.teacherUserId, schoolId: QA_SCHOOL_ID, role: 'teacher' }]).onConflictDoUpdate({ target: [userRoles.userId, userRoles.schoolId, userRoles.role], set: { isActive: true } });
    await transaction.insert(classMembers).values(rows.classMember).onConflictDoUpdate({ target: [classMembers.studentId, classMembers.academicYearId], set: { isActive: true, rollNumber: '09B-001' } });
    await transaction.insert(classSubjects).values(rows.classSubjects).onConflictDoUpdate({ target: [classSubjects.classId, classSubjects.subjectId], set: { teacherId: input.teacherUserId } });
    await transaction.insert(schoolDirectoryTeacherAssignments).values(QA_SUBJECTS.map(([subjectId]) => ({ schoolDirectoryEntryId: teacherDirectoryId, classId: QA_CLASS_ID, subjectId }))).onConflictDoNothing();
    await transaction.insert(profileInterests).values(rows.profileInterests).onConflictDoNothing();
    await transaction.insert(classAnnouncements).values(rows.announcements).onConflictDoUpdate({ target: classAnnouncements.id, set: { title: sql`excluded.title`, body: sql`excluded.body`, isPublished: true, publishedAt: sql`excluded.published_at` } });
    for (const notification of rows.notificationInbox) {
      await transaction.execute(sql`
        insert into public.notification_inbox (id, school_id, user_id, notification_type, title, body, data)
        values (${notification.id}::uuid, ${notification.schoolId}::uuid, ${notification.userId}::uuid, ${notification.notificationType}, ${notification.title}, ${notification.body}, ${JSON.stringify(notification.data)}::jsonb)
        on conflict (id) do update set title = excluded.title, body = excluded.body, data = excluded.data
      `);
    }
    await transaction.insert(attendanceSessions).values(rows.attendanceSessions).onConflictDoUpdate({ target: attendanceSessions.id, set: { markedByTeacherId: sql`excluded.marked_by_teacher_id`, updatedAt: sql`now()` } });
    await transaction.insert(attendanceRecords).values(rows.attendanceRecords).onConflictDoUpdate({ target: [attendanceRecords.sessionId, attendanceRecords.studentId], set: { status: sql`excluded.status`, markedAt: sql`now()` } });
    await transaction.insert(classDiaryEntries).values(rows.diaryEntries).onConflictDoUpdate({ target: classDiaryEntries.id, set: { description: sql`excluded.description`, keyPoints: sql`excluded.key_points`, updatedAt: sql`now()` } });
    await transaction.insert(assignments).values(rows.assignments).onConflictDoUpdate({ target: assignments.id, set: { instructions: sql`excluded.instructions`, dueAt: sql`excluded.due_at`, updatedAt: sql`now()` } });
    await transaction.insert(assignmentRubrics).values(rows.assignmentRubrics).onConflictDoNothing();
    await transaction.insert(examGroups).values(rows.examGroup).onConflictDoUpdate({ target: examGroups.id, set: { title: sql`excluded.title`, startsOn: sql`excluded.starts_on`, endsOn: sql`excluded.ends_on`, state: 'published', updatedAt: sql`now()` } });
    await transaction.insert(classExams).values(rows.classExams).onConflictDoUpdate({ target: classExams.id, set: { title: sql`excluded.title`, scheduledOn: sql`excluded.scheduled_on`, isPublished: true, publishedAt: sql`excluded.published_at`, updatedAt: sql`now()` } });
    await transaction.insert(examRubrics).values(rows.examRubrics).onConflictDoNothing();
    await transaction.insert(examSubmissions).values(rows.examSubmissions).onConflictDoNothing();
    await transaction.insert(examResults).values(rows.examResults).onConflictDoUpdate({ target: [examResults.assessmentId, examResults.studentId], set: { marks: sql`excluded.marks`, feedback: sql`excluded.feedback`, publishedAt: sql`excluded.published_at`, updatedAt: sql`now()` } });
    await transaction.insert(chatRooms).values(rows.classChat.room).onConflictDoNothing();
    await transaction.insert(chatMessages).values(rows.classChat.messages).onConflictDoNothing();
    await transaction.insert(chatReadCursors).values(rows.classChat.readCursor).onConflictDoUpdate({ target: [chatReadCursors.schoolId, chatReadCursors.roomId, chatReadCursors.userId], set: { lastReadMessageId: sql`excluded.last_read_message_id`, lastReadAt: sql`excluded.last_read_at`, updatedAt: sql`now()` } });
    await transaction.insert(events).values(rows.event).onConflictDoUpdate({ target: events.id, set: { title: sql`excluded.title`, lifecycle: sql`excluded.lifecycle`, updatedAt: sql`now()` } });
    await transaction.insert(eventAudiences).values(rows.eventAudience).onConflictDoNothing();
    await transaction.insert(eventManagers).values(rows.eventManager).onConflictDoNothing();
    await transaction.insert(eventRegistrations).values(rows.eventRegistration).onConflictDoUpdate({ target: [eventRegistrations.eventId, eventRegistrations.studentId], set: { participationTag: sql`excluded.participation_tag`, cancelledAt: null, updatedAt: sql`now()` } });
    await transaction.insert(pointLedgerEntries).values(rows.pointLedgerEntries).onConflictDoNothing();
  });
}

function requireRuntimeConfiguration(environment: NodeJS.ProcessEnv): QaProvisioningConfiguration {
  const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'QA_PROVISION_PASSWORD'] as const;
  for (const name of required) {
    if (!environment[name]) throw new Error('QA provisioning configuration is incomplete');
  }
  return {
    databaseUrl: environment.DATABASE_URL!,
    supabaseUrl: environment.SUPABASE_URL!,
    supabaseSecretKey: environment.SUPABASE_SECRET_KEY!,
    password: environment.QA_PROVISION_PASSWORD!,
  };
}

function maskPhone(phoneE164: string): string {
  return `***${phoneE164.slice(-4)}`;
}

export interface QaProvisioningConfiguration {
  databaseUrl: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  password: string;
}

export interface QaProvisioningRuntime {
  environment: NodeJS.ProcessEnv;
  createDatabase(input: { DATABASE_URL: string }): { db: Database; client: { end(input: { timeout: number }): Promise<unknown> } };
  createAdminClient(configuration: QaProvisioningConfiguration): QaAdminClient;
  log(message: string): void;
}

const AUTH_COMPENSATION_FAILURE_LOG =
  '[qa-provision] failure operation=auth_compensation category=delete_failed';

async function compensateCreatedQaAuthUsers(
  client: QaAdminClient,
  createdUserIds: readonly string[],
  log: (message: string) => void,
): Promise<void> {
  for (const userId of [...createdUserIds].reverse()) {
    try {
      const deleted = await client.auth.admin.deleteUser(userId);
      if (deleted.error === null) continue;
    } catch {
      // The original provisioning error remains authoritative.
    }
    try { log(AUTH_COMPENSATION_FAILURE_LOG); } catch { /* Preserve the original error. */ }
  }
}

export async function runQaAuthProvisioning(runtime: QaProvisioningRuntime): Promise<void> {
  assertQaProvisioningSafety({
    NODE_ENV: runtime.environment.NODE_ENV,
    QA_PROVISION_CONFIRM: runtime.environment.QA_PROVISION_CONFIRM,
    QA_PROVISION_ALLOW_PRODUCTION: runtime.environment.QA_PROVISION_ALLOW_PRODUCTION,
  });
  const configuration = requireRuntimeConfiguration(runtime.environment);
  const { db, client: databaseClient } = runtime.createDatabase({ DATABASE_URL: configuration.databaseUrl });
  try {
    const adminClient = runtime.createAdminClient(configuration);
    const createdUserIds: string[] = [];
    let plan: QaProvisioningPlan;
    try {
      plan = await executeQaProvisioning({
        inspectDirectoryClaims: () => db.select({ phoneE164: schoolDirectoryEntries.phoneE164, claimedByUserId: schoolDirectoryEntries.claimedByUserId }).from(schoolDirectoryEntries).where(inArray(schoolDirectoryEntries.phoneE164, ['+917755090948', '+919000000001'])),
        inspectAuthUsers: async () => ({
          studentUserId: (await findQaAdminUserByPhone(adminClient, '+917755090948'))?.id ?? null,
          teacherUserId: (await findQaAdminUserByPhone(adminClient, '+919000000001'))?.id ?? null,
        }),
        ensureAuthUsers: async (preflight) => {
          const [student, teacher] = await Promise.all([
            prepareQaAuthUser(adminClient, { phoneE164: '+917755090948' }, preflight.studentUserId),
            prepareQaAuthUser(adminClient, { phoneE164: '+919000000001' }, preflight.teacherUserId),
          ]);
          const appliedStudent = await applyQaAuthUser(adminClient, { phoneE164: '+917755090948', password: configuration.password }, student);
          if (appliedStudent.created) createdUserIds.push(appliedStudent.userId);
          const appliedTeacher = await applyQaAuthUser(adminClient, { phoneE164: '+919000000001', password: configuration.password }, teacher);
          if (appliedTeacher.created) createdUserIds.push(appliedTeacher.userId);
          return {
            studentUserId: appliedStudent.userId,
            teacherUserId: appliedTeacher.userId,
          };
        },
        provisionPublicFixtures: (userIds) => provisionQaPublicFixtures(db, userIds),
      });
    } catch (error) {
      await compensateCreatedQaAuthUsers(adminClient, createdUserIds, runtime.log);
      throw error;
    }
    for (const user of plan.users) runtime.log(`[qa-provision] success role=${user.role} phone=${maskPhone(user.phoneE164)} category=provisioned`);
  } finally {
    await databaseClient.end({ timeout: 5 });
  }
}

async function run(): Promise<void> {
  await runQaAuthProvisioning({
    environment: process.env,
    createDatabase,
    createAdminClient: (configuration) => createClient(configuration.supabaseUrl, configuration.supabaseSecretKey, { auth: { autoRefreshToken: false, persistSession: false } }),
    log: (message) => console.info(message),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => {
    console.error('[qa-provision] failure category=provisioning_failed');
    process.exitCode = 1;
  });
}
