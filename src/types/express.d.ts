import type { AuthenticatedRequestIdentity } from '../middleware/authenticate.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedRequestIdentity;
    }
  }
}

export {};
