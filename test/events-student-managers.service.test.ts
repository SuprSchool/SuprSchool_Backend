import { describe, expect, it, vi } from 'vitest';

import type { EventsRepository } from '../src/db/repositories/events.repository.js';
import { createEventsService } from '../src/services/events.service.js';

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('student event managing-team hydration', () => {
  it('returns only the managing team authorized by the student repository read', async () => {
    const managingTeam = [{
      contact: 'coordinator@school.example',
      displayName: 'Alex Teacher',
      memberType: 'teacher' as const,
      role: 'Coordinator',
      userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    }];
    const repository = {
      getStudentEvent: vi.fn().mockResolvedValue({
        activityKind: 'event',
        audienceType: 'school',
        category: 'Workshop',
        createdAt: '2026-08-01T10:00:00.000000Z',
        description: 'Description',
        eligibilityCriteria: null,
        eligibilityRules: { targetClassIds: [] },
        endsAt: null,
        genderEligibility: 'mixed',
        id: eventId,
        lifecycle: 'published',
        participationMode: null,
        registration: null,
        registrationDeadlineAt: '2026-08-19T10:00:00.000000Z',
        rulesAndRegulations: null,
        startsAt: '2026-08-20T10:00:00.000000Z',
        targetClassIds: [],
        title: 'Science fair',
        venue: 'Main Hall',
      }),
      listStudentManagingTeam: vi.fn().mockResolvedValue(managingTeam),
      listStudentResources: vi.fn().mockResolvedValue([]),
    } as unknown as EventsRepository;
    const files = {
      createReadUrl: vi.fn(),
      createUpload: vi.fn(),
      deleteObject: vi.fn(),
      finalizeUpload: vi.fn(),
      prepareUpload: vi.fn(),
    };
    const service = createEventsService({ avatarUrlSigner: { createSignedDownloadUrl: vi.fn() }, files, repository });

    await expect(service.getStudentEvent({ schoolId, userId: studentId }, eventId))
      .resolves.toMatchObject({ managingTeam });
    expect(repository.listStudentManagingTeam).toHaveBeenCalledWith(
      { schoolId, userId: studentId },
      eventId,
    );
  });
});
