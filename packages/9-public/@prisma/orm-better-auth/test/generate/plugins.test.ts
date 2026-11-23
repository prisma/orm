import type { BetterAuthPlugin } from '@better-auth/core';
import { admin, organization, twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { useContractFixture } from '../helpers/contract-fixture';
import { targets } from '../helpers/databases';
import {
  afterEdit,
  appPsl,
  contractPath,
  editAndEmit,
  insertAfter,
  twoFactorCode,
  twoFactorSummary,
  userLastField,
} from './sources';

const fixture = useContractFixture();
const files = [{ path: contractPath, text: appPsl }];
const sessionLastField =
  '  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)';

describe.each(targets)('auth generate adds what a plugin needs to the contract on %s', (target) => {
  it('two-factor: two fields at the end of User and a new model at the end of the file', async () => {
    expect(await editAndEmit(fixture(), target, files, { plugins: [twoFactor()] })).toEqual({
      edit: { path: contractPath, code: twoFactorCode, summary: twoFactorSummary(contractPath) },
      problemsAfter: [],
    });
  });

  it('admin: fields at the end of User and of Session', async () => {
    const withUserFields = insertAfter(
      appPsl,
      userLastField,
      '\n  role       String?\n  banned     Boolean?\n  banReason  String?\n  banExpires DateTime?',
    );
    expect(await editAndEmit(fixture(), target, files, { plugins: [admin()] })).toEqual({
      edit: {
        path: contractPath,
        code: insertAfter(withUserFields, sessionLastField, '\n  impersonatedBy String?'),
        summary: `Changes to ${contractPath}: 4 fields added to User, 1 field added to Session. ${afterEdit}`,
      },
      problemsAfter: [],
    });
  });

  it('organization: fields on User and Session, and three new models', async () => {
    const withUserFields = insertAfter(
      appPsl,
      userLastField,
      '\n  members     Member[]\n  invitations Invitation[]',
    );
    const withSessionField = insertAfter(
      withUserFields,
      sessionLastField,
      '\n  activeOrganizationId String?',
    );
    expect(await editAndEmit(fixture(), target, files, { plugins: [organization()] })).toEqual({
      edit: {
        path: contractPath,
        code: `${withSessionField}
model Organization {
  id          String       @id
  name        String
  slug        String       @unique
  logo        String?
  createdAt   DateTime
  metadata    String?
  members     Member[]
  invitations Invitation[]

  @@map("organization")
}

model Member {
  id             String       @id
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  role           String
  createdAt      DateTime

  @@index([organizationId])
  @@index([userId])
  @@map("member")
}

model Invitation {
  id             String       @id
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  email          String
  role           String?
  status         String
  expiresAt      DateTime
  createdAt      DateTime
  inviterId      String
  inviter        User         @relation(fields: [inviterId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([email])
  @@map("invitation")
}
`,
        summary: `Changes to ${contractPath}: 2 fields added to User, 1 field added to Session, models Organization, Member and Invitation added. ${afterEdit}`,
      },
      problemsAfter: [],
    });
  });

  it('prints after the summary a foreign-key action it had to change', async () => {
    const grants: BetterAuthPlugin = {
      id: 'grants',
      schema: {
        grant: {
          fields: {
            ownerId: {
              type: 'string',
              required: true,
              references: { model: 'user', field: 'id', onDelete: 'set null' },
            },
          },
        },
      },
    };
    expect(await editAndEmit(fixture(), target, files, { plugins: [grants] })).toEqual({
      edit: {
        path: contractPath,
        code: `${insertAfter(appPsl, userLastField, '\n  grants Grant[]')}
model Grant {
  id      String @id
  ownerId String
  owner   User   @relation(fields: [ownerId], references: [id], onDelete: NoAction)

  @@map("grant")
}
`,
        summary: `Changes to ${contractPath}: 1 field added to User, model Grant added. ${afterEdit}\nNote: Grant.ownerId: Better Auth asks for onDelete set null, which needs an optional field; NoAction is printed instead`,
      },
      problemsAfter: [],
    });
  });
});
