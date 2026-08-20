import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/lib/errors.js';
import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import {
  createSchoolRouter,
  createStudentCommunityProfileRouter,
  createStudentDirectoryRouter,
  createTeacherCommunityProfileRouter,
} from '../src/routes/community-profile.routes.js';
import type { CommunityProfileService } from '../src/services/community-profile.service.js';

const schoolId = '00000000-0000-4000-8000-000000000001';
const otherSchoolId = '00000000-0000-4000-8000-000000000002';
const studentId = '00000000-0000-4000-8000-000000000101';
const teacherId = '00000000-0000-4000-8000-000000000102';

function createService(): CommunityProfileService {
  return {
    getCurrentSchool: vi.fn(async (identity) => ({
      address: '12 Learning Lane',
      description: ['A tenant-safe school description.'],
      events: [{
        additionalCategoryCount: 2,
        category: 'Curricular Competition',
        date: '2026-08-14T09:00:00.000000Z',
        id: 'event-1',
        imageUrl: 'https://storage.example/academic-files/event-1?token=caller-school',
        isEligible: false,
        registeredCount: 50,
        title: 'Drama Club Fest',
      }],
      gallery: identity.schoolId === schoolId
        ? [{ altText: 'Science fair', id: 'gallery-1', url: 'https://storage.example/school-1?token=caller-school' }]
        : [{ altText: 'Other school gallery', id: 'gallery-2', url: 'https://storage.example/school-2?token=other-school' }],
      id: identity.schoolId,
      name: identity.schoolId === schoolId ? 'Supr School' : 'Other School',
      phone: '+911234567890',
      rating: 'A+',
      rules: ['Be kind.'],
      rulesIntro: 'School expectations',
      studentCount: 12,
      supportEmail: 'help@school.example',
      teacherCount: 2,
    })),
    getStudentOverview: vi.fn(async (identity) => ({
      announcementCount: 3,
      classSection: 'Class 10-A',
      id: identity.userId,
      rollNumber: '14',
      schoolName: 'Supr School',
      stats: {
        attendance: '94%',
        avgScore: '91%',
        classRank: '#2',
        eventsParticipated: 1,
        points: 25,
        streakDays: 4,
      },
    })),
    getStudentDirectoryProfile: vi.fn(async (identity, targetId) => {
      // Stands in for the real read: the subject only resolves inside the
      // caller's school, and anywhere else is indistinguishable from absent.
      if (identity.schoolId !== schoolId) {
        throw new AppError('NOT_FOUND', 404, 'Student not found');
      }
      return {
        avatar: { kind: 'preset' as const, value: 'avatar-1' },
        classSection: 'Class 9th - B',
        id: targetId,
        interests: ['Coding' as const, 'Reading' as const],
        name: 'John Smith',
        rollNumber: '23',
        schoolName: 'Riverside International School',
        stats: { classRank: '#5', eventsParticipated: 4, points: 850, streakDays: 12 },
      };
    }),
    getTeacherOverview: vi.fn(async (identity) => ({
      announcementCount: 2,
      classTeacher: 'Class 10-A',
      engages: 'Class 9-B',
      id: identity.userId,
      schoolName: 'Supr School',
      stats: {
        diaryEntries: 5,
        eventsConducted: 1,
        testsConducted: 2,
        totalAssignments: 3,
      },
    })),
  };
}

function createTestApp() {
  const service = createService();
  const authenticate: AuthenticationMiddleware = async (
    incoming: Request,
    _response: Response,
    next: NextFunction,
  ) => {
    const token = incoming.header('authorization');
    if (token === 'Bearer teacher') {
      incoming.auth = { role: 'teacher', schoolId, userId: teacherId };
    } else if (token === 'Bearer other-school') {
      incoming.auth = { role: 'teacher', schoolId: otherSchoolId, userId: teacherId };
    } else {
      incoming.auth = { role: 'student', schoolId, userId: studentId };
    }
    next();
  };
  const app = express();
  app.use('/v1/student/profile', createStudentCommunityProfileRouter(service, authenticate));
  app.use('/v1/teacher/profile', createTeacherCommunityProfileRouter(service, authenticate));
  app.use('/v1/schools', createSchoolRouter(service, authenticate));
  app.use('/v1/students', createStudentDirectoryRouter(service, authenticate));
  // Without it a rejected param reaches Express's default handler as a 500.
  app.use(errorHandler);

  return { app, service };
}

const subjectId = '00000000-0000-4000-8000-000000000202';

describe('community profile REST API', () => {
  it('returns a student overview for the token owner without interests or avatar', async () => {
    const { app, service } = createTestApp();

    const response = await request(app).get('/v1/student/profile/overview').expect(200);

    expect(response.body).toMatchObject({ id: studentId, classSection: 'Class 10-A' });
    expect(response.body).not.toHaveProperty('interests');
    expect(response.body).not.toHaveProperty('avatar');
    expect(response.body).not.toHaveProperty('avatarUri');
    expect(service.getStudentOverview).toHaveBeenCalledWith({
      role: 'student', schoolId, userId: studentId,
    });
  });

  it('returns a teacher overview only for the authenticated teacher', async () => {
    const { app, service } = createTestApp();

    await request(app).get('/v1/teacher/profile/overview').set('authorization', 'Bearer teacher').expect(200, {
      announcementCount: 2,
      classTeacher: 'Class 10-A',
      engages: 'Class 9-B',
      id: teacherId,
      schoolName: 'Supr School',
      stats: {
        diaryEntries: 5,
        eventsConducted: 1,
        testsConducted: 2,
        totalAssignments: 3,
      },
    });
    expect(service.getTeacherOverview).toHaveBeenCalledWith({
      role: 'teacher', schoolId, userId: teacherId,
    });
    await request(app).get('/v1/teacher/profile/overview').expect(403);
  });

  it('returns gallery URLs only for the caller school', async () => {
    const { app, service } = createTestApp();

    const response = await request(app)
      .get('/v1/schools/current')
      .set('authorization', 'Bearer teacher')
      .expect(200);

    expect(response.body.gallery).toEqual([
      expect.objectContaining({ url: expect.stringContaining('token=caller-school') }),
    ]);
    expect(response.body.gallery).not.toContainEqual(
      expect.objectContaining({ url: expect.stringContaining('other-school') }),
    );
    expect(service.getCurrentSchool).toHaveBeenCalledWith({
      role: 'teacher', schoolId, userId: teacherId,
    });
  });

  it('returns school contact fields', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/v1/schools/current').expect(200);

    expect(response.body.phone).toBe('+911234567890');
    expect(response.body.supportEmail).toBe('help@school.example');
  });

  // 648:10485. Reached from a teacher's participant and submission cards and
  // from a student's event leaderboard, so both roles must get through.
  it('returns another student\'s profile to a teacher and to a student alike', async () => {
    const { app, service } = createTestApp();

    const asTeacher = await request(app)
      .get(`/v1/students/${subjectId}/profile`)
      .set('authorization', 'Bearer teacher')
      .expect(200);
    const asStudent = await request(app)
      .get(`/v1/students/${subjectId}/profile`)
      .expect(200);

    expect(asTeacher.body).toEqual(asStudent.body);
    expect(asTeacher.body).toEqual({
      avatar: { kind: 'preset', value: 'avatar-1' },
      classSection: 'Class 9th - B',
      id: subjectId,
      interests: ['Coding', 'Reading'],
      name: 'John Smith',
      rollNumber: '23',
      schoolName: 'Riverside International School',
      stats: { classRank: '#5', eventsParticipated: 4, points: 850, streakDays: 12 },
    });
    expect(service.getStudentDirectoryProfile).toHaveBeenCalledWith(
      { role: 'teacher', schoolId, userId: teacherId },
      subjectId,
    );
  });

  it('is a 404 for a caller from another school', async () => {
    const { app } = createTestApp();

    await request(app)
      .get(`/v1/students/${subjectId}/profile`)
      .set('authorization', 'Bearer other-school')
      .expect(404);
  });

  it('rejects a non-uuid subject and any extra query input', async () => {
    const { app, service } = createTestApp();

    await request(app).get('/v1/students/not-a-uuid/profile').expect(400);
    await request(app)
      .get(`/v1/students/${subjectId}/profile`)
      .query({ schoolId: otherSchoolId })
      .expect(400);
    expect(service.getStudentDirectoryProfile).not.toHaveBeenCalled();
  });

  it('returns the event card fields the school Events tab draws', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/v1/schools/current').expect(200);

    expect(response.body.events[0]).toMatchObject({
      additionalCategoryCount: 2,
      imageUrl: 'https://storage.example/academic-files/event-1?token=caller-school',
      isEligible: false,
      registeredCount: 50,
    });
  });
});
