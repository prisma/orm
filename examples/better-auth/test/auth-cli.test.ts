import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyProject, type ProjectCopy, run } from './project';

const missing = `Your Prisma contract is missing models or fields that Better Auth needs.

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

Then run \`prisma contract emit\` and update your database.`;

/** The message, printed on its own after whatever the CLI logs while it loads the configuration. */
function printedMessage(output: string): string {
  expect(output).not.toContain('Error running Better Auth CLI');
  return output.slice(output.indexOf('Your Prisma contract')).trim();
}

const twoFactorAuth = `import { prismaAdapter } from '@prisma/better-auth-adapter';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { db } from './db';

export const auth = betterAuth({
  database: prismaAdapter(db),
  emailAndPassword: { enabled: true },
  plugins: [twoFactor()],
});
`;

describe('auth generate and auth check with the two-factor plugin', () => {
  let project: ProjectCopy;

  beforeAll(async () => {
    project = await copyProject();
    await writeFile(join(project.dir, 'src/lib/auth.ts'), twoFactorAuth);
  });

  afterAll(() => project?.remove());

  it('print what the contract lacks and exit 1, writing nothing', async () => {
    const contract = await readFile(join(project.dir, 'prisma/contract.prisma'), 'utf8');

    const generated = await run(project, 'auth', ['generate', '--yes']);
    expect(generated).toMatchObject({ exitCode: 1 });
    expect(printedMessage(generated.stderr)).toBe(missing);

    const checked = await run(project, 'auth', ['check']);
    expect(checked).toMatchObject({ exitCode: 1 });
    expect(printedMessage(checked.stderr)).toBe(missing);

    expect(await readFile(join(project.dir, 'prisma/contract.prisma'), 'utf8')).toBe(contract);
  });

  it('pass once the printed models and fields are in the contract', async () => {
    const contractPath = join(project.dir, 'prisma/contract.prisma');
    const contract = await readFile(contractPath, 'utf8');
    const printed = missing.slice(
      missing.indexOf('model TwoFactor'),
      missing.indexOf('\n\nThen run'),
    );
    await writeFile(
      contractPath,
      `${contract.replace(
        '  accounts      Account[]\n',
        '  accounts      Account[]\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]\n',
      )}\n${printed}\n`,
    );
    expect((await run(project, 'prisma', ['contract', 'emit'])).exitCode).toBe(0);

    const generated = await run(project, 'auth', ['generate', '--yes']);
    expect(generated).toMatchObject({ exitCode: 0 });
    expect(generated.stdout).toContain('Your schema is already up to date.');

    const checked = await run(project, 'auth', ['check']);
    expect(checked).toMatchObject({ exitCode: 0 });
    expect(checked.stdout).toContain('Schema check passed against adapter "prisma-8".');
  });
});
