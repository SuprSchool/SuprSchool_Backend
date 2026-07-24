import { Router, type Request, type Response } from 'express';

import type { HealthResponse } from '../types/api.js';

export const healthRouter = Router();

healthRouter.get('/', (_request: Request, response: Response): void => {
  const body: HealthResponse = { status: 'ok' };
  response.status(200).json(body);
});
