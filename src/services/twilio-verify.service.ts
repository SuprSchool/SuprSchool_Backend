import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export type OtpPurpose = 'signup' | 'password_reset';

export interface OtpChallengeInput {
  phone: string;
  purpose: OtpPurpose;
}

export interface OtpCheckInput extends OtpChallengeInput {
  code: string;
}

export interface OtpVerifier {
  start(input: OtpChallengeInput): Promise<void>;
  check(input: OtpCheckInput): Promise<{ approved: boolean }>;
}

/**
 * Local-only verifier. It intentionally has no network side effects and must
 * be selected explicitly by dependency wiring outside production.
 */
export function createDevelopmentOtpVerifier(
  options: { code?: string } = {},
): OtpVerifier {
  const code = options.code ?? '000000';
  const challenges = new Set<string>();
  const key = ({ phone, purpose }: OtpChallengeInput) => `${purpose}:${phone}`;

  return {
    async start(input) {
      challenges.add(key(input));
    },
    async check(input) {
      const challengeKey = key(input);
      const approved = challenges.has(challengeKey) && input.code === code;
      if (approved) {
        challenges.delete(challengeKey);
      }
      return { approved };
    },
  };
}

export interface TwilioVerifyOptions {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  fetch?: typeof fetch;
}

/** Minimal Twilio Verify REST adapter; credentials never leave server-side wiring. */
export function createTwilioVerifyAdapter(options: TwilioVerifyOptions): OtpVerifier {
  const request = options.fetch ?? fetch;
  const endpoint = `https://verify.twilio.com/v2/Services/${encodeURIComponent(options.serviceSid)}`;
  const authorization = `Basic ${Buffer.from(`${options.accountSid}:${options.authToken}`).toString('base64')}`;

  async function post(path: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await request(`${endpoint}/${path}`, {
      body: new URLSearchParams(fields),
      headers: {
        authorization,
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const body = await response.clone().json().catch(() => undefined) as { code?: unknown } | undefined;
      const twilioErrorCode = typeof body?.code === 'number' ? body.code : undefined;
      logger.warn(
        {
          operation: path === 'Verifications' ? 'start' : 'check',
          ...(twilioErrorCode === undefined ? {} : { twilioErrorCode }),
          twilioStatus: response.status,
        },
        'Twilio Verify request failed',
      );
      throw new AppError('INTERNAL_ERROR', 503, 'Verification service is temporarily unavailable');
    }
    return response.json() as Promise<Record<string, unknown>>;
  }

  return {
    async start({ phone }) {
      await post('Verifications', { Channel: 'sms', To: phone });
    },
    async check({ phone, code }) {
      const result = await post('VerificationCheck', { Code: code, To: phone });
      return { approved: result.status === 'approved' };
    },
  };
}
