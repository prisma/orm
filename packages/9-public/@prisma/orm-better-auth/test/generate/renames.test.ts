import type { BetterAuthOptions } from '@better-auth/core';
import { twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { useContractFixture } from '../helpers/contract-fixture';
import { targets } from '../helpers/databases';
import { pslForConfiguration } from '../helpers/printed-psl';
import { afterEdit, contractPath, editAndEmit, insertAfter } from './sources';

const fixture = useContractFixture();

describe.each(targets)('auth generate with renamed models and fields on %s', (target) => {
  it('finds the models usePlural names', async () => {
    const text = pslForConfiguration(fixture().emptyContract(target), {}, { usePlural: true });
    const code = `${insertAfter(text, '  accountss     Accounts[]', '\n  twoFactorEnabled Boolean?\n  twoFactorss      TwoFactors[]')}
model TwoFactors {
  id                      String    @id
  secret                  String
  backupCodes             String
  userId                  String
  user                    Users     @relation(fields: [userId], references: [id], onDelete: Cascade)
  verified                Boolean?
  failedVerificationCount Int?
  lockedUntil             DateTime?

  @@index([secret])
  @@index([userId])
  @@map("twoFactors")
}
`;
    expect(
      await editAndEmit(
        fixture(),
        target,
        [{ path: contractPath, text }],
        { plugins: [twoFactor()] },
        { usePlural: true },
      ),
    ).toEqual({
      edit: {
        path: contractPath,
        code,
        summary: `Changes to ${contractPath}: 2 fields added to Users, model TwoFactors added. ${afterEdit}`,
      },
      problemsAfter: [],
    });
  });

  it("finds the model and fields Better Auth's modelName and fields options rename", async () => {
    const renamed: BetterAuthOptions = {
      user: { modelName: 'person', fields: { name: 'fullName' } },
    };
    const text = pslForConfiguration(fixture().emptyContract(target), renamed);
    const code = `${insertAfter(text, '  accounts      Account[]', '\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]')}
model TwoFactor {
  id                      String    @id
  secret                  String
  backupCodes             String
  userId                  String
  user                    Person    @relation(fields: [userId], references: [id], onDelete: Cascade)
  verified                Boolean?
  failedVerificationCount Int?
  lockedUntil             DateTime?

  @@index([secret])
  @@index([userId])
  @@map("twoFactor")
}
`;
    expect(
      await editAndEmit(fixture(), target, [{ path: contractPath, text }], {
        ...renamed,
        plugins: [twoFactor()],
      }),
    ).toEqual({
      edit: {
        path: contractPath,
        code,
        summary: `Changes to ${contractPath}: 2 fields added to Person, model TwoFactor added. ${afterEdit}`,
      },
      problemsAfter: [],
    });
  });
});
