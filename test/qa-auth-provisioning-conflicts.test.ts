import { expect, it } from 'vitest';

import { buildQaProvisioningPlan } from '../scripts/provision-qa-auth-users.js';

// Catches a destructive re-link when a QA phone belongs to a different Auth
// user. The provisioner must stop for an operator instead of taking it over.
it('refuses a directory phone claimed by a different user', () => {
  expect(() => buildQaProvisioningPlan({
    studentUserId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
    teacherUserId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
    existingDirectoryClaims: [
      {
        phoneE164: '+917755090948',
        claimedByUserId: 'deadbeef-7b18-4d46-9f23-5a6f0bc15a0e',
      },
    ],
  })).toThrow('claimed by another user');
});
