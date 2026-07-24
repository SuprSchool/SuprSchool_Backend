import { Router } from 'express';

import { createExamsController } from '../controllers/exams.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import { requireCapability } from '../middleware/authorize.js';
import type { ExamsService } from '../services/exams.service.js';

export function createExamsRouter(
  service: ExamsService,
  authenticate: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createExamsController(service);

  router.use(authenticate);

  router.get('/student/exams/groups', controller.listGroupsForStudent);
  router.get('/student/exams/groups/:groupId', controller.getGroupForStudent);
  router.get('/student/exams/groups/:groupId/leaderboard', controller.getLeaderboard);
  router.get('/student/exam-assessments/:assessmentId', controller.getAssessmentForStudent);

  router.get(
    '/teacher/classes/:classId/exam-groups',
    requireCapability('createAssignment'),
    controller.listGroupsForTeacher,
  );
  router.post(
    '/teacher/classes/:classId/exam-groups',
    requireCapability('createAssignment'),
    controller.createGroup,
  );
  router.patch('/teacher/exam-groups/:groupId', requireCapability('createAssignment'), controller.updateGroup);
  router.delete('/teacher/exam-groups/:groupId', requireCapability('createAssignment'), controller.deleteGroup);
  router.get(
    '/teacher/exam-groups/:groupId/assessments',
    requireCapability('createAssignment'),
    controller.listAssessmentsForTeacher,
  );
  router.post(
    '/teacher/exam-groups/:groupId/assessments',
    requireCapability('createAssignment'),
    controller.createAssessment,
  );
  router.get(
    '/teacher/exam-assessments/:assessmentId',
    requireCapability('createAssignment'),
    controller.getAssessmentForTeacher,
  );
  router.patch(
    '/teacher/exam-assessments/:assessmentId',
    requireCapability('createAssignment'),
    controller.updateAssessment,
  );
  router.delete(
    '/teacher/exam-assessments/:assessmentId',
    requireCapability('createAssignment'),
    controller.deleteAssessment,
  );
  router.get(
    '/teacher/exam-assessments/:assessmentId/submissions',
    requireCapability('gradeSubmission'),
    controller.listSubmissions,
  );
  router.put(
    '/teacher/exam-assessments/:assessmentId/submissions/:studentId',
    requireCapability('gradeSubmission'),
    controller.markSubmission,
  );
  router.get(
    '/teacher/exam-assessments/:assessmentId/results',
    requireCapability('gradeSubmission'),
    controller.listResults,
  );
  router.put(
    '/teacher/exam-assessments/:assessmentId/results/:studentId',
    requireCapability('gradeSubmission'),
    controller.upsertResult,
  );
  router.post(
    '/teacher/exam-assessments/:assessmentId/reminder/student/:studentId',
    requireCapability('createAssignment'),
    controller.remindStudent,
  );
  router.post(
    '/teacher/exam-assessments/:assessmentId/reminder/all',
    requireCapability('createAssignment'),
    controller.remindAll,
  );
  router.post(
    '/teacher/exam-assessments/:assessmentId/publish',
    requireCapability('createAssignment'),
    controller.publishAssessment,
  );
  router.post(
    '/teacher/exam-assessments/:assessmentId/results/publish',
    requireCapability('publishResults'),
    controller.publishResults,
  );
  router.post(
    '/teacher/exam-assessments/:assessmentId/resources/upload-sessions',
    requireCapability('createAssignment'),
    controller.createResourceUploadSession,
  );
  router.post(
    '/teacher/exam-assessments/:assessmentId/resources/confirm',
    requireCapability('createAssignment'),
    controller.confirmResource,
  );

  return router;
}
