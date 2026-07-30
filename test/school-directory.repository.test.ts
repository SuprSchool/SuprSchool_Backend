import { describe, expect, it } from 'vitest';

import { mapSignupProfileRows } from '../src/db/repositories/school-directory.repository.js';

describe('mapSignupProfileRows', () => {
  // Catches duplicate joined assignment rows leaking into the teacher signup preview.
  it('deduplicates teacher classes and subjects from joined directory assignments', () => {
    const rows = [
      {
        displayName: 'Meera Kapoor', employeeCode: 'T-042', phoneE164: '+919876543211',
        role: 'teacher', rollNumber: null, schoolName: 'Supr School', studentClassName: null,
        studentGrade: null, studentSection: null, subjectName: 'Physics', teacherClassName: 'Class 10-A',
      },
      {
        displayName: 'Meera Kapoor', employeeCode: 'T-042', phoneE164: '+919876543211',
        role: 'teacher', rollNumber: null, schoolName: 'Supr School', studentClassName: null,
        studentGrade: null, studentSection: null, subjectName: 'Physics', teacherClassName: 'Class 10-A',
      },
      {
        displayName: 'Meera Kapoor', employeeCode: 'T-042', phoneE164: '+919876543211',
        role: 'teacher', rollNumber: null, schoolName: 'Supr School', studentClassName: null,
        studentGrade: null, studentSection: null, subjectName: 'Chemistry', teacherClassName: 'Class 9-B',
      },
    ];

    expect(mapSignupProfileRows(rows)).toEqual({
      classTeacher: 'Class 10-A, Class 9-B',
      displayName: 'Meera Kapoor',
      employeeCode: 'T-042',
      phoneE164: '+919876543211',
      role: 'teacher',
      schoolName: 'Supr School',
      subjects: ['Physics', 'Chemistry'],
    });
  });
});