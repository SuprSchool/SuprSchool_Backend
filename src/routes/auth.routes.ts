import { Router } from 'express';

import { createAuthController } from '../controllers/auth.controller.js';
import { createSignupStartLimiter } from '../middleware/auth-rate-limit.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { AuthService } from '../services/auth.service.js';

export function createAuthRouter(
  authService: AuthService,
  authenticate?: AuthenticationMiddleware,
): Router {
  const router = Router();
  const controller = createAuthController(authService);

  router.post('/signup/start', createSignupStartLimiter(), controller.startSignup);
  router.post('/signup/verify', controller.verifySignup);
  router.post('/signup/profile', controller.getVerifiedSignupProfile);
  router.post('/signup/complete', controller.completeSignup);
  router.post('/login', controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.post('/contact-admin', controller.submitContactAdmin);
  router.post('/password/reset/start', controller.startPasswordReset);
  router.post('/password/reset/verify', controller.verifyPasswordReset);
  router.post('/password/reset/complete', controller.completePasswordReset);

  if (authenticate) {
    router.get('/me', authenticate, controller.getMe);
  }

  return router;
}
