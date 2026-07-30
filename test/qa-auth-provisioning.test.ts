import { describe, expect, it } from 'vitest';

import { buildQaProvisioningPlan } from '../scripts/provision-qa-auth-users.js';

describe('buildQaProvisioningPlan', () => {
  // Catches a regression that links the QA fixtures to a seeded Auth ID rather
  // than to the supported Admin API user ID supplied by the provisioner.
  it('links claimed E.164 directory entries to the supplied Admin Auth user IDs', () => {
    const plan = buildQaProvisioningPlan({
      studentUserId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
      teacherUserId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
      existingDirectoryClaims: [],
    });

    expect(plan.users).toEqual([
      expect.objectContaining({
        userId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
        phoneE164: '+917755090948',
        directoryClaim: 'claim',
      }),
      expect.objectContaining({
        userId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
        phoneE164: '+919000000001',
        directoryClaim: 'claim',
      }),
    ]);
  });

  // Catches a regression that creates a claimed directory record without a
  // verified Admin Auth user ID to own it.
  it('refuses to build claimed directory fixtures without both Admin Auth user IDs', () => {
    expect(() => buildQaProvisioningPlan({
      studentUserId: '',
      teacherUserId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
      existingDirectoryClaims: [],
    })).toThrow('Admin Auth user ID');
  });

  // Catches a regression that reclaims or overwrites a directory entry already
  // matched to the same supported Admin Auth user.
  it('does not reclaim a directory entry already matched to the same user', () => {
    const plan = buildQaProvisioningPlan({
      studentUserId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
      teacherUserId: '2a760c18-1f2e-4374-b4d8-01fc789ae95d',
      existingDirectoryClaims: [
        {
          phoneE164: '+917755090948',
          claimedByUserId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
        },
      ],
    });

    expect(plan.users[0]).toEqual(expect.objectContaining({
      directoryClaim: 'already-claimed',
      userId: '1f2d0c30-7b18-4d46-9f23-5a6f0bc15a0e',
    }));
  });
});
