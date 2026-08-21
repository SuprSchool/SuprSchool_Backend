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
  // Submitting with nothing attached — uploading work is optional on graded and
  // non-graded assignments alike. Registered BEFORE the two `/submission/...`
  // routes for readability only; Express matches on the full path, so the
  // bare `/submission` cannot shadow them.
  router.post(
    '/student/assignments/:assignmentId/submission',
    controller.submitWithoutFile,
  );
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
  router.patch(
    '/teacher/submissions/:submissionId',
    requireCapability('gradeSubmission'),
    controller.setSubmissionCompletion,
  );
  // Completion addressed by student, for the roster rows that have no submission
  // row to PATCH. PUT, not PATCH: the body states the whole desired state and
  // the write is idempotent in both directions.
  router.put(
    '/teacher/assignments/:assignmentId/students/:studentId/completion',
    requireCapability('gradeSubmission'),
    controller.setStudentCompletion,
  );
  // Bulk mark-as-done. The unprefixed path is the shipped contract; the
  // `/teacher`-prefixed alias below is the same handler under this router's own
  // naming convention, so a caller that reaches for either finds it.
  router.post(
    '/assignments/:assignmentId/completions/bulk',
    requireCapability('gradeSubmission'),
    controller.bulkSetCompletion,
  );
  router.post(
    '/teacher/assignments/:assignmentId/completions/bulk',
    requireCapability('gradeSubmission'),
    controller.bulkSetCompletion,
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
