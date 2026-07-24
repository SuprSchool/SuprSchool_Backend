import { Router } from 'express';

import { createAssignmentsController } from '../controllers/assignments.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import { requireCapability } from '../middleware/authorize.js';
import type { AssignmentsService } from '../services/assignments.service.js';

export function createAssignmentsRouter(
  service: AssignmentsService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createAssignmentsController(service);

  router.use(authenticate);

  router.get('/student/assignments', controller.listForStudent);
  router.get('/student/assignments/:assignmentId', controller.getForStudent);
  router.post(
    '/student/assignments/:assignmentId/submission/upload-sessions',
    controller.createSubmissionUploadSession,
  );
  router.post(
    '/student/assignments/:assignmentId/submission/confirm',
    controller.confirmSubmission,
  );

  router.get(
    '/teacher/classes/:classId/assignments',
    requireCapability('createAssignment'),
    controller.listForTeacher,
  );
  router.post(
    '/teacher/classes/:classId/assignments',
    requireCapability('createAssignment'),
    controller.create,
  );
  router.get(
    '/teacher/assignments/:assignmentId',
    requireCapability('createAssignment'),
    controller.getForTeacher,
  );
  router.patch(
    '/teacher/assignments/:assignmentId',
    requireCapability('createAssignment'),
    controller.update,
  );
  router.delete(
    '/teacher/assignments/:assignmentId',
    requireCapability('createAssignment'),
    controller.delete,
  );
  router.get(
    '/teacher/assignments/:assignmentId/submissions',
    requireCapability('gradeSubmission'),
    controller.listSubmissions,
  );
  router.put(
    '/teacher/submissions/:submissionId/grade',
    requireCapability('gradeSubmission'),
    controller.grade,
  );
  router.post(
    '/teacher/assignments/:assignmentId/reminder/student/:studentId',
    requireCapability('createAssignment'),
    controller.remindStudent,
  );
  router.post(
    '/teacher/assignments/:assignmentId/reminder/all',
    requireCapability('createAssignment'),
    controller.remindAll,
  );
  router.post(
    '/teacher/assignments/:assignmentId/resources/upload-sessions',
    requireCapability('createAssignment'),
    controller.createResourceUploadSession,
  );
  router.post(
    '/teacher/assignments/:assignmentId/resources/confirm',
    requireCapability('createAssignment'),
    controller.confirmResource,
  );
  router.delete(
    '/teacher/assignments/:assignmentId/resources/:resourceId',
    requireCapability('createAssignment'),
    controller.deleteResource,
  );

  return router;
}
