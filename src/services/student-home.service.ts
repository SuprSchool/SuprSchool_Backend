import type { StudentHomeRepository } from '../db/repositories/student-home.repository.js';
import { AppError } from '../lib/errors.js';
import type {
  StudentHomeBirthdaysResponse,
  StudentHomeBirthday,
  StudentHomeCalendarDayResponse,
  StudentHomeCalendarResponse,
  StudentHomeIdentity,
  StudentHomeResponse,
} from '../types/student-home.js';

export interface StudentHomeAvatarUrlSigner {
  createSignedDownloadUrl(bucket: string, objectPath: string): Promise<string>;
}

export interface StudentHomeServiceDependencies {
  avatarUrlSigner: StudentHomeAvatarUrlSigner;
  clock?: () => Date;
  repository: StudentHomeRepository;
}

/** Horizon applied when the caller does not pass `?window=`. */
export const defaultBirthdayWindowDays = 30;

export interface StudentHomeService {
  getHome(studentId: string): Promise<StudentHomeResponse>;
  getCalendar(identity: StudentHomeIdentity, month: string): Promise<StudentHomeCalendarResponse>;
  getCalendarDay(identity: StudentHomeIdentity, date: string): Promise<StudentHomeCalendarDayResponse>;
  getBirthdays(schoolId: string, windowDays?: number): Promise<StudentHomeBirthdaysResponse>;
}

function requireStudentContext<T>(value: T | null): T {
  if (!value) {
    throw new AppError(
      'UNAUTHORIZED',
      401,
      'An active student class membership is required',
    );
  }
  return value;
}

function monthBounds(month: string): { startDate: string; endDate: string } {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/**
 * Generic over the row type so the upcoming list keeps its `date`/`inDays`
 * through avatar signing; typed as StudentHomeBirthday[] it silently widened
 * them away.
 */
async function resolveBirthdayAvatars<T extends StudentHomeBirthday>(
  birthdays: T[],
  avatarUrlSigner: StudentHomeAvatarUrlSigner,
): Promise<T[]> {
  return Promise.all(birthdays.map(async (birthday) => {
    if (birthday.avatar?.kind !== 'upload') return birthday;
    return {
      ...birthday,
      avatar: {
        kind: 'upload' as const,
        value: await avatarUrlSigner.createSignedDownloadUrl('avatars', birthday.avatar.value),
      },
    };
  }));
}

export function createStudentHomeService(
  { avatarUrlSigner, clock = () => new Date(), repository }: StudentHomeServiceDependencies,
): StudentHomeService {
  return {
    async getHome(studentId): Promise<StudentHomeResponse> {
      return requireStudentContext(await repository.getForStudent(studentId, clock()));
    },
    async getCalendar(identity, month): Promise<StudentHomeCalendarResponse> {
      const bounds = monthBounds(month);
      const events = requireStudentContext(await repository.getCalendarForStudent(
        identity,
        bounds.startDate,
        bounds.endDate,
      ));
      return { events };
    },
    async getCalendarDay(identity, date): Promise<StudentHomeCalendarDayResponse> {
      const items = requireStudentContext(await repository.getCalendarDayForStudent(identity, date));
      return { items };
    },
    async getBirthdays(schoolId, windowDays = defaultBirthdayWindowDays): Promise<StudentHomeBirthdaysResponse> {
      // One clock read for both lists: two reads could straddle midnight and
      // produce a student who is neither today's nor tomorrow's.
      const now = clock();
      const [birthdays, upcoming] = await Promise.all([
        repository.getBirthdaysForSchool(schoolId, now),
        repository.getUpcomingBirthdaysForSchool(schoolId, now, windowDays),
      ]);
      return {
        birthdays: await resolveBirthdayAvatars(birthdays, avatarUrlSigner),
        upcoming: await resolveBirthdayAvatars(upcoming, avatarUrlSigner),
        windowDays,
      };
    },
  };
}
