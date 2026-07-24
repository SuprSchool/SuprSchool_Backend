import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().optional(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().min(1).optional(),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
}).superRefine((environment, context) => {
  if (environment.NODE_ENV === 'production' && !environment.REDIS_URL) {
    context.addIssue({
      code: 'custom',
      message: 'REDIS_URL is required in production',
      path: ['REDIS_URL'],
    });
  }
  if (environment.NODE_ENV === 'production' && (!environment.TWILIO_ACCOUNT_SID || !environment.TWILIO_AUTH_TOKEN || !environment.TWILIO_VERIFY_SERVICE_SID)) {
    context.addIssue({ code: 'custom', message: 'Twilio Verify credentials are required in production', path: ['TWILIO_ACCOUNT_SID'] });
  }
});

export type Env = z.infer<typeof environmentSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return environmentSchema.parse(input);
}
