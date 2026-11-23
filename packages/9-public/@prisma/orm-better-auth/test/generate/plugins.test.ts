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
        summary: `Adding 4 fields to User and 1 field to Session to ${contractPath}. ${afterEdit}`,
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
        summary: `Adding 2 fields to User, 1 field to Session and the models Organization, Member and Invitation to ${contractPath}. ${afterEdit}`,
      },
      problemsAfter: [],
    });
  });
});
