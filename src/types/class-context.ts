export interface ClassContextClass {
  displayName: string;
  grade: string;
  id: string;
  section: string;
}

export interface ClassContextStudent {
  avatarPath: string | null;
  displayName: string;
  id: string;
  rollNumber: string | null;
}

export interface ClassContextTeacher {
  displayName: string;
  id: string;
  subjectId: string;
  subjectName: string;
}

export interface StudentClassContextResponse {
  class: ClassContextClass;
  students: ClassContextStudent[];
  teachers: ClassContextTeacher[];
  totalStudents: number;
}

export interface StudentClassSubject {
  code: string;
  id: string;
  name: string;
  teacher: Pick<ClassContextTeacher, 'displayName' | 'id'> | null;
}

export interface StudentSubjectsResponse {
  class: ClassContextClass;
  subjects: StudentClassSubject[];
}

export interface TeacherClassSubjectContextResponse {
  class: ClassContextClass;
  studentCount: number;
  subject: {
    code: string;
    id: string;
    name: string;
  };
}

export interface TeacherClassSubjectParams {
  classId: string;
  subjectId: string;
}
