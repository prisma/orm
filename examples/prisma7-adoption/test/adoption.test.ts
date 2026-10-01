/**
 * The adoption story, start to finish, on a fresh database: Prisma 7 applies
 * its first migration, Prisma 8 reads the schema, signs and verifies with
 * zero findings, Prisma 7 seeds, Prisma 8 reads the rows; then Prisma 7
 * applies its second migration and Prisma 8 refreshes and re-signs. It runs
 * in a scratch copy of this example (inside it, so node_modules resolve) with
 * the schema and migrations rolled back to the first version.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const EXAMPLE_ROOT = join(__dirname, '..');
const BIN = join(EXAMPLE_ROOT, 'node_modules/.bin');
const FINAL_SCHEMA = readFileSync(join(EXAMPLE_ROOT, 'prisma/schema.prisma'), 'utf-8');
const SECOND_MIGRATION = '20260914000100_add_post_view_count';

// The dev database runs inside this process, so the commands must be spawned
// asynchronously: a blocking spawn would starve it and every command would
// report the database as unreachable.
function run(
  cwd: string,
  databaseUrl: string,
  bin: string,
  args: readonly string[],
): Promise<string> {
  const command = [bin, ...args].join(' ');
  return new Promise((resolve, reject) => {
    const child = spawn(join(BIN, bin), args, {
      cwd,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new Error(`${command} did not start: ${error.message}`));
    });
    child.on('close', (status, signal) => {
      if (status === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} exited with ${status ?? signal}\n${output}`));
      }
    });
  });
}

async function verifyHasNoFindings(cwd: string, databaseUrl: string): Promise<void> {
  const output = await run(cwd, databaseUrl, 'prisma', ['db', 'verify', '--json']);
  const terminal = output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((event) => event.kind === 'result');
  expect(terminal.envelope).toMatchObject({ ok: true, diagnostics: [] });
  expect(terminal.envelope.result.schema).toMatchObject({ warnings: [] });
}

function createStoryCopy(): string {
  const dir = mkdtempSync(join(EXAMPLE_ROOT, '.story-'));
  for (const entry of ['prisma', 'scripts', 'src', 'prisma.config.ts', 'prisma7.config.ts']) {
    cpSync(join(EXAMPLE_ROOT, entry), join(dir, entry), { recursive: true });
  }
  writeFileSync(
    join(dir, 'prisma/schema.prisma'),
    FINAL_SCHEMA.split('\n')
      .filter((line) => !line.includes('viewCount'))
      .join('\n'),
  );
  rmSync(join(dir, 'prisma/migrations', SECOND_MIGRATION), { recursive: true });
  return dir;
}

function readContract(dir: string): string {
  return readFileSync(join(dir, 'generated/prisma8/contract.json'), 'utf-8');
}

describe('adopting Prisma 8 beside Prisma 7', () => {
  it(
    'migrates on Prisma 7, signs and verifies on Prisma 8, and repeats after the next migration',
    async () => {
      const dir = createStoryCopy();
      try {
        await withDevDatabase(async ({ connectionString }) => {
          writeFileSync(join(dir, '.env'), `DATABASE_URL=${connectionString}\n`);
          const v7 = (...args: string[]) =>
            run(dir, connectionString, 'prisma7', [...args, '--config', 'prisma7.config.ts']);
          const v8 = (...args: string[]) => run(dir, connectionString, 'prisma', args);
          const tsx = (script: string) => run(dir, connectionString, 'tsx', [script]);

          expect(await v7('migrate', 'deploy')).toContain('20260914000000_init');
          await v8('contract', 'emit');
          expect(readContract(dir)).not.toContain('viewCount');
          await v8('db', 'sign');
          await verifyHasNoFindings(dir, connectionString);

          await v7('generate');
          expect(await tsx('scripts/seed.ts')).toContain(
            'Seeded through Prisma 7: 2 users, 2 posts.',
          );
          const prisma8Read = await tsx('src/main.ts');
          expect(prisma8Read).toContain('Alice (ADMIN) via Prisma 8');
          expect(prisma8Read).toContain('- Adopting Prisma 8 next to Prisma 7 [orm, typescript]');
          expect(prisma8Read).toMatch(/Created post \d+ through Prisma 8, tagged orm/);
          const advanced = /updatedAt advanced: (\S+) -> (\S+)/.exec(prisma8Read);
          expect(advanced, prisma8Read).not.toBeNull();
          const [, before, after] = advanced ?? [];
          expect(new Date(`${after}Z`).getTime()).toBeGreaterThan(new Date(`${before}Z`).getTime());
          expect(await tsx('src/v7-read.ts')).toContain('Written through Prisma 8');

          writeFileSync(join(dir, 'prisma/schema.prisma'), FINAL_SCHEMA);
          cpSync(
            join(EXAMPLE_ROOT, 'prisma/migrations', SECOND_MIGRATION),
            join(dir, 'prisma/migrations', SECOND_MIGRATION),
            { recursive: true },
          );
          expect(await v7('migrate', 'deploy')).toContain(SECOND_MIGRATION);
          await v8('contract', 'emit');
          expect(JSON.parse(readContract(dir))).toEqual(JSON.parse(readContract(EXAMPLE_ROOT)));
          await v8('db', 'sign');
          await verifyHasNoFindings(dir, connectionString);
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    timeouts.spinUpPpgDev * 4,
  );
});
