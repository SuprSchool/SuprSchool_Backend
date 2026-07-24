import { readFile } from 'node:fs/promises';

import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp, type AppDependencies } from '../src/app.js';
import type { ChatService } from '../src/services/chat.service.js';
import type { CommunityProfileService } from '../src/services/community-profile.service.js';
import type { PointsService } from '../src/services/points.service.js';
import type { ProfileService } from '../src/services/profile.service.js';

const schoolId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const teacherId = '33333333-3333-4333-8333-333333333333';

async function authenticate(
  requestValue: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const role = requestValue.header('x-test-role');
  requestValue.auth = {
    role: role === 'teacher' ? 'teacher' : 'student',
    schoolId,
    userId: role === 'teacher' ? teacherId : studentId,
  };
  next();
}

function createDependencies(): AppDependencies {
  const profileService: ProfileService = {
    getProfile: vi.fn().mockResolvedValue({
      avatar: { kind: 'preset', value: 'avatar-student' },
      displayName: 'Student', id: studentId, interests: [], schoolId,
    }),
    replaceInterests: vi.fn(),
    setPresetAvatar: vi.fn(),
  };
  const chatService: ChatService = {
    listMessages: vi.fn(),
    listRooms: vi.fn().mockResolvedValue([]),
    markRead: vi.fn(),
    publishTyping: vi.fn(),
    sendMessage: vi.fn(),
  };
  const communityProfileService: CommunityProfileService = {
    getCurrentSchool: vi.fn().mockResolvedValue({
      address: '', description: [], events: [], gallery: [], id: schoolId,
      name: 'SuprSchool', rating: '—', rules: [], rulesIntro: '', studentCount: 1, teacherCount: 1,
    }),
    getStudentOverview: vi.fn().mockResolvedValue({
      announcementCount: 0, classSection: '10-A', id: studentId, rollNumber: '1', schoolName: 'SuprSchool',
      stats: { attendance: '100%', avgScore: '—', classRank: '—', eventsParticipated: 0, points: 0, streakDays: 0 },
    }),
    getTeacherOverview: vi.fn().mockResolvedValue({
      announcementCount: 0, classTeacher: '10-A', engages: '', id: teacherId, schoolName: 'SuprSchool',
      stats: { diaryEntries: 0, eventsConducted: 0, testsConducted: 0, totalAssignments: 0 },
    }),
  };
  const pointsService = {
    getActivity: vi.fn().mockResolvedValue({ items: [] }),
    getClassRanking: vi.fn().mockResolvedValue({ entries: [], generatedAt: null }),
    getEarningRules: vi.fn().mockResolvedValue([]),
    getLevel: vi.fn().mockResolvedValue({ currentPoints: 0, level: 1, maxPoints: 0, pointsToNext: 0 }),
  } as unknown as PointsService;

  return { authenticate, chatService, communityProfileService, pointsService, profileService } as AppDependencies;
}

describe('Phase 4 runtime integration', () => {
  it('mounts every authenticated Phase 4 route exactly once under /v1', async () => {
    const app = createApp(createDependencies());

    await request(app).get('/v1/profile').expect(200);
    await request(app).get('/v1/chat/rooms').expect(200, { rooms: [] });
    await request(app).get('/v1/student/profile/overview').expect(200);
    await request(app).get('/v1/teacher/profile/overview').set('x-test-role', 'teacher').expect(200);
    await request(app).get('/v1/schools/current').expect(200);
    await request(app).get('/v1/student/points/level').expect(200);
    await request(app).get('/v1/student/class/rankings').query({ scope: 'section' }).expect(200);
  });

  it('registers the durable ranking refresh handler in the queue worker', async () => {
    const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
    expect(worker).toContain('ranking_refresh: createRankingRefreshHandler(');
  });
});
