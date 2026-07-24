import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationMiddleware } from '../src/middleware/authenticate.js';
import {
  createSchoolRouter,
  createStudentCommunityProfileRouter,
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
      events: [],
      gallery: identity.schoolId === schoolId
        ? [{ altText: 'Science fair', id: 'gallery-1', url: 'https://storage.example/school-1?token=caller-school' }]
        : [{ altText: 'Other school gallery', id: 'gallery-2', url: 'https://storage.example/school-2?token=other-school' }],
      id: identity.schoolId,
      name: identity.schoolId === schoolId ? 'Supr School' : 'Other School',
      rating: 'A+',
      rules: ['Be kind.'],
      rulesIntro: 'School expectations',
      studentCount: 12,
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

  return { app, service };
}

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
});
