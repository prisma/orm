import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { runInScratch } from '@repo/tsdown/shell-testkit';
import { expect } from 'vitest';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const adapter = '@prisma/orm-better-auth';
export const facade = '@prisma/orm-sqlite';
export const cliEngine = '@prisma/cli-engine';

export const corePsl = readFileSync(
  join(repoRoot, 'examples/better-auth/prisma/contract.prisma'),
  'utf8',
);

export const twoFactorMissing = `Your Prisma contract is missing models or fields that Better Auth needs.

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

export const twoFactorModel = twoFactorMissing.slice(
  twoFactorMissing.indexOf('model TwoFactor'),
  twoFactorMissing.indexOf('\n\nThen run'),
);

const userLastField = '  accounts      Account[]\n';

/** `corePsl`, or a part of it holding the User model, with the fields the two-factor plugin adds to User. */
export function withTwoFactorFields(psl: string): string {
  const completed = psl.replace(
    userLastField,
    `${userLastField}  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]\n`,
  );
  expect(completed).not.toBe(psl);
  return completed;
}

export function twoFactorAdded(path: string): string {
  return `Changes to ${path}: 2 fields added to User, model TwoFactor added. After the file is written, run \`prisma contract emit\` and update your database.`;
}

export const notChanged = '`auth generate` did not change your contract, because';

function prismaConfig(contract: string): string {
  return `import { definePrismaConfig } from '${cliEngine}';
import { defineConfig } from '${facade}/config';

export default definePrismaConfig({ orm: defineConfig({ contract: '${contract}' }) });
`;
}

type AuthPlugin = 'twoFactor' | 'admin';

function authConfig(plugin: AuthPlugin): string {
  return `import { prismaAdapter } from '${adapter}';
import { betterAuth } from 'better-auth';
import { ${plugin} } from 'better-auth/plugins';
import { db } from './db';

export const auth = betterAuth({
  database: prismaAdapter(db),
  emailAndPassword: { enabled: true },
  plugins: [${plugin}()],
});
`;
}

const sqliteClient = `import sqlite from '${facade}/runtime';
import { contractFromJson } from '${facade}/static';
import contractJson from '../../prisma/contract.json' with { type: 'json' };

export const db = sqlite({ contract: contractFromJson(contractJson), path: './auth.db' });
`;

interface AuthRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runAuth(
  cwd: string,
  scratch: string,
  args: readonly string[],
  input?: string,
): AuthRun {
  const run = spawnSync(join(scratch, 'node_modules/.bin/auth'), [...args], {
    cwd,
    encoding: 'utf-8',
    input,
    timeout: timeouts.coldTransformImport,
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_TELEMETRY: '0',
      NO_COLOR: '1',
    },
  });
  if (run.signal !== null) {
    throw new Error(
      `auth ${args.join(' ')} was stopped by ${run.signal} before it finished, after at most ${timeouts.coldTransformImport} ms. Standard error:\n${run.stderr}`,
    );
  }
  if (run.error !== undefined) throw run.error;
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** Every file under `dir` outside `node_modules`, by relative path, with its content. */
export function projectFiles(dir: string): Record<string, string> {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.split(/[\\/]/).includes('node_modules'))
    .sort();
  return Object.fromEntries(
    files.map((path) => [path.slice(dir.length + 1), readFileSync(path, 'utf8')]),
  );
}

/** What Better Auth 1.7.6 to 1.7.21 logged at startup for a contract the adapter's check rejects. */
const falseConnectionAdvice = [
  'Could not validate the database schema',
  'Check your database connection',
];

/** The line `auth generate` prints when it starts its spinner. Its first character is a spinner frame, which depends on whether the system supports Unicode. */
const spinnerStart = /^\S+ preparing schema\.\.\.\n/;

/** Everything the command printed on standard error, but the spinner's first line. */
export function printedMessage(run: AuthRun): string {
  for (const advice of falseConnectionAdvice) expect(run.stderr).not.toContain(advice);
  return run.stderr.replace(spinnerStart, '').trim();
}

/** Non-empty lines of what the command printed on standard output. */
export function printedLines(run: AuthRun): string[] {
  return run.stdout.split('\n').filter((line) => line !== '');
}

interface AuthProjectOptions {
  /** The contract source files, by path inside the project. */
  readonly sources?: Readonly<Record<string, string>>;
  /** The contract input `prisma.config.ts` names, or `null` for a project without one. */
  readonly configContract?: string | null;
  /** What `contract.json` is emitted from, relative to the scratch folder; the project's own `prisma/contract.prisma` when not given. */
  readonly emitFrom?: string;
  readonly plugin?: AuthPlugin;
}

/** A project in the scratch folder with a Better Auth configuration over the SQLite client, and a way to emit its `prisma/contract.json`. */
export function authProject(
  scratch: string,
  name: string,
  {
    sources = { 'prisma/contract.prisma': corePsl },
    configContract = './prisma/contract.prisma',
    emitFrom = `./${name}/prisma/contract.prisma`,
    plugin = 'twoFactor',
  }: AuthProjectOptions = {},
) {
  const projectDir = join(scratch, name);
  const files: Record<string, string> = {
    ...sources,
    'src/lib/auth.ts': authConfig(plugin),
    'src/lib/db.ts': sqliteClient,
    ...(configContract === null ? {} : { 'prisma.config.ts': prismaConfig(configContract) }),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(projectDir, path)), { recursive: true });
    writeFileSync(join(projectDir, path), text);
  }
  const emit = `
    import { writeFileSync } from 'node:fs';
    import { defineConfig } from '${facade}/config';
    import { createSqliteControlClient } from '${facade}/control';

    const { contract: contractConfig } = defineConfig({ contract: '${emitFrom}' });
    const emitted = await createSqliteControlClient().emit({ contractConfig });
    if (!emitted.ok) throw new Error(JSON.stringify(emitted.failure));
    writeFileSync('./${name}/prisma/contract.json', emitted.value.contractJson);
    console.log('emitted');
  `;
  return {
    projectDir,
    emit: () => expect(runInScratch(scratch, emit)).toContain('emitted'),
  };
}
