export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface DiaryCursor {
  id: string;
  occurredOn: string;
}

export interface CursorPageInput {
  cursor?: DiaryCursor | undefined;
  limit: number;
}

export interface CreateDiaryInput {
  classSubjectId: string;
  description: string;
  keyPoints: string[];
  occurredOn: string;
  periodLabel: string;
  title: string;
}

export interface UpdateDiaryInput {
  description?: string | undefined;
  keyPoints?: string[] | undefined;
  occurredOn?: string | undefined;
  periodLabel?: string | undefined;
  title?: string | undefined;
}

export interface TeacherDiaryDto {
  classId: string;
  classSubjectId: string;
  description: string;
  id: string;
  keyPoints: string[];
  occurredOn: string;
  periodLabel: string;
  teacherId: string;
  title: string;
  updatedAt: string;
}

export interface DiaryRecord extends TeacherDiaryDto {
  revision: number;
  schoolId: string;
}

export interface StudentDiaryDto extends TeacherDiaryDto {
  teacherName: string;
}

export function encodeDiaryCursor(cursor: DiaryCursor): string {
  return Buffer.from(JSON.stringify({ ...cursor, v: 1 }), 'utf8').toString('base64url');
}
