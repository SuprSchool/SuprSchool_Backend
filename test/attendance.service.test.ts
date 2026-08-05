import { describe, expect, it, vi } from 'vitest';

import type { AttendanceRepository } from '../src/db/repositories/attendance.repository.js';
import { createAttendanceService } from '../src/services/attendance.service.js';

function repository(): AttendanceRepository {
  return {
    getClassHistory: vi.fn(),
    getClassRoster: vi.fn(),
    getStudentSummary: vi.fn(),
    listQualifyingStreakAwards: vi.fn(),
    markBulk: vi.fn(),
  };
}

describe('attendance service roster boundaries', () => {
  it('excludes the signed-in teacher from the mark-attendance roster', async () => {
    const attendanceRepository = repository();
    vi.mocked(attendanceRepository.getClassRoster).mockResolvedValue([
      { id: 'teacher-1', isPresent: true, name: 'Teacher QA', rollNumber: 0, status: 'present' },
      { id: 'student-1', isPresent: false, name: 'Asha', rollNumber: 1, status: null },
    ]);

    const service = createAttendanceService({ repository: attendanceRepository });
    const roster = await service.getClassRoster('teacher-1', 'class-1', '2026-08-05');

    expect(roster).toEqual([
      { id: 'student-1', isPresent: false, name: 'Asha', rollNumber: 1, status: null },
    ]);
  });
});
