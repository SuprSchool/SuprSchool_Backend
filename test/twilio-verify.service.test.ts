import { describe, expect, it, vi } from 'vitest';

import { logger } from '../src/lib/logger.js';
import { createTwilioVerifyAdapter } from '../src/services/twilio-verify.service.js';

describe('Twilio Verify adapter', () => {
  it('logs only safe provider diagnostics when starting an OTP fails', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const verifier = createTwilioVerifyAdapter({
      accountSid: 'AC_test',
      authToken: 'test-token',
      serviceSid: 'VA_test',
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 20404 }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })),
    });

    await expect(verifier.start({ phone: '+919876543210', purpose: 'password_reset' }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 503 });

    expect(warn).toHaveBeenCalledWith(
      { operation: 'start', twilioErrorCode: 20404, twilioStatus: 404 },
      'Twilio Verify request failed',
    );
  });
});
