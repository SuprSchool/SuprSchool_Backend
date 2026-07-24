import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const appRoleValues = [
  'student',
  'teacher',
  'school-admin',
  'super-admin',
] as const;

export const schoolDirectoryEntryStatusValues = [
  'unclaimed',
  'claimed',
  'disabled',
] as const;

export const appRole = pgEnum('app_role', appRoleValues);
export const schoolDirectoryEntryStatus = pgEnum(
  'school_directory_entry_status',
  schoolDirectoryEntryStatusValues,
);

export const avatarKindValues = ['preset', 'upload'] as const;
export const avatarKind = pgEnum('avatar_kind', avatarKindValues);

export const schools = pgTable(
  'schools',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    schoolCode: text('school_code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex('schools_school_code_unique').on(table.schoolCode)],
);

export const academicYears = pgTable(
  'academic_years',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    isCurrent: boolean('is_current').default(false).notNull(),
  },
  (table) => [
    uniqueIndex('academic_years_school_name_unique').on(
      table.schoolId,
      table.name,
    ),
  ],
);

export const classes = pgTable(
  'classes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    grade: text('grade').notNull(),
    section: text('section').notNull(),
    displayName: text('display_name').notNull(),
  },
  (table) => [
    uniqueIndex('classes_school_year_grade_section_unique').on(
      table.schoolId,
      table.academicYearId,
      table.grade,
      table.section,
    ),
  ],
);

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
  },
  (table) => [
    uniqueIndex('subjects_school_code_unique').on(table.schoolId, table.code),
  ],
);

export const schoolDirectoryEntries = pgTable(
  'school_directory_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    phoneE164: text('phone_e164').notNull(),
    role: appRole('role').notNull(),
    displayName: text('display_name').notNull(),
    rollNumber: text('roll_number'),
    employeeCode: text('employee_code'),
    studentClassId: uuid('student_class_id').references(() => classes.id),
    status: schoolDirectoryEntryStatus('status').default('unclaimed').notNull(),
    claimedByUserId: uuid('claimed_by_user_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('school_directory_entries_phone_e164_unique').on(table.phoneE164),
    index('school_directory_entries_eligible_lookup').on(
      table.phoneE164,
      table.role,
      table.status,
    ),
  ],
);

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: uuid('id').primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    avatarPath: text('avatar_path'),
    avatarKind: avatarKind('avatar_kind'),
    avatarValue: text('avatar_value'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('user_profiles_school_id_index').on(table.schoolId)],
);

export const profileInterests = pgTable(
  'profile_interests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    interest: text('interest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.interest] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    role: appRole('role').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => [
    uniqueIndex('user_roles_user_school_role_unique').on(
      table.userId,
      table.schoolId,
      table.role,
    ),
    index('user_roles_user_active_index').on(table.userId, table.isActive),
  ],
);

export const contactAdminRequests = pgTable(
  'contact_admin_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    message: text('message').notNull(),
    requestedRole: appRole('requested_role'),
    status: text('status').default('open').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [index('contact_admin_requests_phone_created_index').on(table.phoneE164, table.createdAt)],
);

export const signupChallenges = pgTable(
  'auth_signup_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    userId: uuid('user_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('auth_signup_challenges_phone_unique').on(table.phoneE164)],
);

export const passwordResetChallenges = pgTable(
  'auth_password_reset_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    userId: uuid('user_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('auth_password_reset_challenges_phone_unique').on(table.phoneE164)],
);

export const classMembers = pgTable(
  'class_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    rollNumber: text('roll_number'),
    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => [
    uniqueIndex('class_members_student_year_unique').on(
      table.studentId,
      table.academicYearId,
    ),
    index('class_members_class_active_index').on(table.classId, table.isActive),
  ],
);

export const schoolDirectoryTeacherAssignments = pgTable(
  'school_directory_teacher_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolDirectoryEntryId: uuid('school_directory_entry_id')
      .notNull()
      .references(() => schoolDirectoryEntries.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (table) => [
    unique('school_directory_teacher_assignments_unique').on(
      table.schoolDirectoryEntryId,
      table.classId,
      table.subjectId,
    ),
  ],
);

export const classSubjects = pgTable(
  'class_subjects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    teacherId: uuid('teacher_id').references(() => userProfiles.id),
  },
  (table) => [
    uniqueIndex('class_subjects_class_subject_unique').on(
      table.classId,
      table.subjectId,
    ),
    index('class_subjects_teacher_index').on(table.teacherId),
  ],
);

export const schoolsRelations = relations(schools, ({ many }) => ({
  academicYears: many(academicYears),
  classes: many(classes),
  schoolDirectoryEntries: many(schoolDirectoryEntries),
  profiles: many(userProfiles),
  subjects: many(subjects),
}));

export const userProfilesRelations = relations(userProfiles, ({ many }) => ({
  interests: many(profileInterests),
}));

export const classesRelations = relations(classes, ({ one, many }) => ({
  school: one(schools, {
    fields: [classes.schoolId],
    references: [schools.id],
  }),
  academicYear: one(academicYears, {
    fields: [classes.academicYearId],
    references: [academicYears.id],
  }),
  members: many(classMembers),
  subjects: many(classSubjects),
}));

export const coreSchema = {
  academicYears,
  appRole,
  avatarKind,
  classes,
  classMembers,
  classSubjects,
  schoolDirectoryEntries,
  schoolDirectoryEntryStatus,
  schoolDirectoryTeacherAssignments,
  schools,
  subjects,
  userProfiles,
  profileInterests,
  userRoles,
};
