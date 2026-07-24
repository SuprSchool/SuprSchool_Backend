export interface TeacherClassAssignment {
  classId: string;
  classSubjectId: string;
  className: string;
  grade: string;
  section: string;
  subjectCode: string;
  subjectId: string;
  subjectName: string;
}

export interface TeacherClassAssignmentsResponse {
  assignments: TeacherClassAssignment[];
}

export interface EnrolledStudent {
  displayName: string;
  rollNumber: string | null;
  studentId: string;
}

export interface TeacherClassStudentsResponse {
  classId: string;
  subjectId: string;
  students: EnrolledStudent[];
}

export interface TeacherClassSubjectParams {
  classId: string;
  subjectId: string;
}
