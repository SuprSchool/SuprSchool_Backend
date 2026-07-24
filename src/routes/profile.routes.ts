import { Router } from 'express';

import { createProfileController } from '../controllers/profile.controller.js';
import type { AuthenticationMiddleware } from '../middleware/authenticate.js';
import type { AvatarService } from '../services/avatar.service.js';
import type { ProfileService } from '../services/profile.service.js';

export function createProfileRouter(
  service: ProfileService,
  authenticate: AuthenticationMiddleware,
  avatarService?: AvatarService,
): Router {
  const router = Router();
  const controller = createProfileController(service, avatarService);

  router.get('/', authenticate, controller.getProfile);
  router.put('/interests', authenticate, controller.replaceInterests);
  router.post('/avatar/preset', authenticate, controller.setPresetAvatar);
  if (avatarService !== undefined) {
    router.post('/avatar/upload-sessions', authenticate, controller.createAvatarUploadSession);
    router.post('/avatar/upload-sessions/:sessionId/confirm', authenticate, controller.confirmAvatarUpload);
  }

  return router;
}
