import { describe, expect, it } from 'vitest';

import { assertQaProvisioningSafety } from '../scripts/provision-qa-auth-users.js';

describe('assertQaProvisioningSafety', () => {
  // Catches removing the explicit operator confirmation that prevents an
  // accidental command invocation from creating QA Auth accounts.
  it('requires explicit operator confirmation', () => {
    expect(() => assertQaProvisioningSafety({
      NODE_ENV: 'development',
      QA_PROVISION_CONFIRM: undefined,
      QA_PROVISION_ALLOW_PRODUCTION: undefined,
    })).toThrow('QA_PROVISION_CONFIRM=1');
  });

  // Catches allowing the QA provisioner to target production with only the
  // ordinary confirmation gate.
  it('requires a second confirmation in production', () => {
    expect(() => assertQaProvisioningSafety({
      NODE_ENV: 'production',
      QA_PROVISION_CONFIRM: '1',
      QA_PROVISION_ALLOW_PRODUCTION: undefined,
    })).toThrow('QA_PROVISION_ALLOW_PRODUCTION=1');
  });

  it('allows an explicitly confirmed non-production run', () => {
    expect(() => assertQaProvisioningSafety({
      NODE_ENV: 'test',
      QA_PROVISION_CONFIRM: '1',
      QA_PROVISION_ALLOW_PRODUCTION: undefined,
    })).not.toThrow();
  });
});
