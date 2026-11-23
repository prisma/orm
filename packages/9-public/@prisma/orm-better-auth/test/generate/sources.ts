import type { BetterAuthOptions } from '@better-auth/core';
import { expect } from 'vitest';
import type { ContractComparison } from '../../src/contract/compare';
import { contractMessage } from '../../src/contract/message';
import { editContractSource } from '../../src/generate/edit-contract-source';
import type { ContractFixture } from '../helpers/contract-fixture';
import { emitContractFiles, type PslFile, type TargetName } from '../helpers/databases';
import { type AdapterOptionsForComparison, compare } from '../helpers/printed-psl';

/** The README's four models and an application model, written the way people write PSL: comments, an accent, misaligned fields and uneven blank lines. */
export const appPsl = `// use prisma-8

// The application's own comment, with an accent: é.
model User {
  id            String    @id
  name          String
  email         String    @unique   // trailing comment
  emailVerified Boolean
  image    String?
  createdAt     DateTime
  updatedAt     DateTime
  sessions      Session[]


  accounts      Account[]
  posts   Post[] // the application's relation

  @@map("user")
}

/// A doc comment on the application's model.
model Post {
  id       String @id
  title    String
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime
  updatedAt DateTime
  ipAddress String?
  userAgent String?

  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime
  updatedAt             DateTime

  @@index([userId])
  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime
  updatedAt  DateTime

  @@index([identifier])
  @@map("verification")
}
`;

export const contractPath = 'prisma/contract.prisma';

export const twoFactorModel = `model TwoFactor {
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
}`;

/** `text` with `added` inserted after the first occurrence of `after`, failing when `after` is not in `text`. */
export function insertAfter(text: string, after: string, added: string): string {
  const at = text.indexOf(after);
  if (at === -1) throw new Error(`The text has no ${JSON.stringify(after)}`);
  const end = at + after.length;
  return `${text.slice(0, end)}${added}${text.slice(end)}`;
}

export const userLastField = "  posts   Post[] // the application's relation";

export const afterEdit =
  'After the file is written, run `prisma contract emit` and update your database.';

/** `appPsl` as `auth generate` edits it for the two-factor plugin. */
export const twoFactorCode = `${insertAfter(appPsl, userLastField, '\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]')}\n${twoFactorModel}\n`;

export function twoFactorSummary(path: string): string {
  return `Changes to ${path}: 2 fields added to User, model TwoFactor added. ${afterEdit}`;
}

export interface EditRun {
  /** The edit, with the edited file named by its path. */
  readonly edit: { readonly path: string; readonly code: string; readonly summary: string };
  /** What the comparison finds after the edited files are emitted. */
  readonly problemsAfter: ContractComparison['problems'];
}

/** Emits the files, edits them for the configuration, then emits the edited files and compares again. */
export async function editAndEmit(
  fixture: ContractFixture,
  target: TargetName,
  files: readonly PslFile[],
  options: BetterAuthOptions,
  adapterOptions: AdapterOptionsForComparison = {},
): Promise<EditRun> {
  const before = await emitContractFiles(target, files, fixture.workDir);
  const { file, code, summary } = editContractSource(
    files,
    compare(before.contract, options, adapterOptions),
  );
  const editedFiles = files.map((candidate) =>
    candidate === file ? { path: file.path, text: code } : candidate,
  );
  const after = await emitContractFiles(target, editedFiles, fixture.workDir);
  return {
    edit: { path: file.path, code, summary },
    problemsAfter: compare(after.contract, options, adapterOptions).problems,
  };
}

/** The error `auth generate` throws when it writes nothing: today's message, then the reason when there is one. */
export function refusal(comparison: ContractComparison, reason?: string) {
  const message = contractMessage(comparison);
  if (message === undefined) throw new Error('The comparison found nothing missing');
  return expect.objectContaining({
    name: 'BetterAuthError',
    code: 'SCHEMA_MISMATCH',
    message: reason === undefined ? message : `${message}\n\n${reason}`,
  });
}
