import type { BetterAuthOptions } from '@better-auth/core';
import { twoFactor } from 'better-auth/plugins';
import { beforeAll, describe, expect, it } from 'vitest';
import { contractMessage } from '../../src/contract/message';
import type { SqlContract } from '../../src/contract/model-lookup';
import { useContractFixture } from '../helpers/contract-fixture';
import { compare, pslForConfiguration } from '../helpers/printed-psl';

const fixture = useContractFixture();
let emptyContract: SqlContract;
let coreContract: SqlContract;

beforeAll(async () => {
  emptyContract = fixture().emptyContract('sqlite');
  coreContract = await fixture().contractOf('sqlite', pslForConfiguration(emptyContract, {}));
});

const contractOf = (psl: string) => fixture().contractOf('sqlite', psl);

describe('contractMessage', () => {
  it('is undefined when the contract holds everything', () => {
    expect(contractMessage(compare(coreContract, {}))).toBeUndefined();
  });

  it('lists the models and fields to add', () => {
    const message = contractMessage(compare(coreContract, { plugins: [twoFactor()] }));
    expect(message).toBe(`Your Prisma contract is missing models or fields that Better Auth needs.

Add to your contract:

model User {
  twoFactorEnabled Boolean?
  twoFactors       TwoFactor[]
}

model TwoFactor {
  id                      String    @id
  secret                  String
  backupCodes             String
  userId                  String
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  verified                Boolean?
  failedVerificationCount Int?
  lockedUntil             DateTime?

  @@index([secret])
  @@index([userId])
  @@map("twoFactor")
}

Then run \`prisma contract emit\` and update your database.`);
  });

  it('lists fields to change and fields Better Auth does not write, with its own first line', async () => {
    const serial: BetterAuthOptions = { advanced: { database: { generateId: 'serial' } } };
    const psl = pslForConfiguration(emptyContract, serial)
      .replace(/(model User \{\n\s+id\s+)Int\s+@id @default\(autoincrement\(\)\)/, '$1String @id')
      .replace(/emailVerified Boolean/, 'emailVerified String ')
      .replace(/(model Session \{\n)/, '$1  nickname String\n');
    const message = contractMessage(compare(await contractOf(psl), serial));
    expect(message).toBe(`Your Prisma contract does not match what Better Auth needs.

Change in your contract:

  User.id: must be \`id Int @id @default(autoincrement())\`
  User.emailVerified: must be \`Boolean\` (found sqlite/text@1)

Fields Better Auth does not write:

  Session.nickname: make it optional or give it a default

Then run \`prisma contract emit\` and update your database.`);
  });

  it('prints NoAction with a note for referential actions Prisma 8 refuses', () => {
    const options: BetterAuthOptions = {
      plugins: [
        {
          id: 'actions',
          schema: {
            grant: {
              fields: {
                ownerId: {
                  type: 'string',
                  references: { model: 'user', field: 'id', onDelete: 'set null' },
                },
                editorId: {
                  type: 'string',
                  required: false,
                  references: { model: 'user', field: 'id', onDelete: 'set default' },
                },
              },
            },
          },
        },
      ],
    };
    const message = contractMessage(compare(coreContract, options)) ?? '';
    expect(message).toContain('onDelete: NoAction)');
    expect(message).not.toContain('SetNull');
    expect(message).not.toContain('SetDefault');
    expect(message).toContain(`Notes:

  Grant.ownerId: Better Auth asks for onDelete set null, which needs an optional field; NoAction is printed instead
  Grant.editorId: Better Auth asks for onDelete set default, which needs a default; NoAction is printed instead

Then run`);
  });
});

describe('contractMessage on postgres', () => {
  it('lists a model in more than one namespace as a change', async () => {
    const empty = fixture().emptyContract('postgres');
    const authModels = pslForConfiguration(empty, {}, { namespace: 'auth' });
    const contract = await fixture().contractOf(
      'postgres',
      `${authModels}\nmodel User {\n  id String @id\n}\n`,
    );
    expect(
      contractMessage(compare(contract, {})),
    ).toBe(`Your Prisma contract does not match what Better Auth needs.

Change in your contract:

  Model "User" is in more than one namespace of your Prisma contract (auth, public). Set the adapter's "namespace" option.

Then run \`prisma contract emit\` and update your database.`);
  });
});
