import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { ApiErrorResponse } from '../types/api.js';

export type Capability = 'createAnnouncement' | 'createAssignment'
  | 'gradeSubmission' | 'markAttendance' | 'createDiary'
  | 'createRecording' | 'manageEvents' | 'publishResults';

export type ClassMembershipLookup = (
  userId: string,
  classId: string,
  schoolId: string,
) => Promise<boolean>;

export type TeacherAssignmentLookup = (
  teacherId: string,
  classId: string,
  subjectId: string,
  schoolId: string,
) => Promise<boolean>;

const teacherCapabilities = new Set<Capability>([
  'createAnnouncement',
  'createAssignment',
  'gradeSubmission',
  'markAttendance',
  'createDiary',
  'createRecording',
  'manageEvents',
  'publishResults',
]);

export function sendForbidden(response: Response): void {
  const requestId = typeof response.locals.requestId === 'string'
    ? response.locals.requestId
    : 'unknown';
  const body: ApiErrorResponse = {
    error: {
      code: 'FORBIDDEN',
      message: 'You do not have access to this resource',
      requestId,
    },
  };

  response.status(403).json(body);
}

function getParam(request: Request, name: string): string | null {
  const value = request.params[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function requireCapability(capability: Capability): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.auth?.role !== 'teacher' || !teacherCapabilities.has(capability)) {
      sendForbidden(response);
      return;
    }

    next();
  };
}

export function requireClassMembership(
  isMember: ClassMembershipLookup,
): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const classId = getParam(request, 'classId');
    if (!request.auth || !classId || !await isMember(
      request.auth.userId,
      classId,
      request.auth.schoolId,
    )) {
      sendForbidden(response);
      return;
    }

    next();
  };
}

export function requireTeacherAssignment(
  isAssigned: TeacherAssignmentLookup,
): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const classId = getParam(request, 'classId');
    const subjectId = getParam(request, 'subjectId');
    if (
      request.auth?.role !== 'teacher'
      || !classId
      || !subjectId
      || !await isAssigned(request.auth.userId, classId, subjectId, request.auth.schoolId)
    ) {
      sendForbidden(response);
      return;
    }

    next();
  };
}
