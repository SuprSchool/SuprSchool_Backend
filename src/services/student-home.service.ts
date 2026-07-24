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

export interface StudentHomeService {
  getHome(studentId: string): Promise<StudentHomeResponse>;
  getCalendar(identity: StudentHomeIdentity, month: string): Promise<StudentHomeCalendarResponse>;
  getCalendarDay(identity: StudentHomeIdentity, date: string): Promise<StudentHomeCalendarDayResponse>;
  getBirthdays(schoolId: string): Promise<StudentHomeBirthdaysResponse>;
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

async function resolveBirthdayAvatars(
  birthdays: StudentHomeBirthday[],
  avatarUrlSigner: StudentHomeAvatarUrlSigner,
): Promise<StudentHomeBirthday[]> {
  return Promise.all(birthdays.map(async (birthday) => {
    if (birthday.avatar?.kind !== 'upload') return birthday;
    return {
      ...birthday,
      avatar: {
        kind: 'upload',
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
    async getBirthdays(schoolId): Promise<StudentHomeBirthdaysResponse> {
      return {
        birthdays: await resolveBirthdayAvatars(
          await repository.getBirthdaysForSchool(schoolId, clock()),
          avatarUrlSigner,
        ),
      };
    },
  };
}
