import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyProject, type ProjectCopy, prisma } from './cli';
import { createTestDatabase, type TestDatabase } from './database';

const serverUrl = process.env['MYSQL_URL'];

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

describe.skipIf(serverUrl === undefined)(
  'the committed migration against an empty MySQL database',
  () => {
    let database: TestDatabase;
    let project: ProjectCopy;
    let projectDir: string;

    beforeAll(async () => {
      database = await createTestDatabase(serverUrl ?? '');
      project = await copyProject();
      projectDir = project.dir;
    });

    afterAll(async () => {
      await database?.drop();
      await project?.remove();
    });

    it('applies with db migrate', async () => {
      const run = await prisma(projectDir, database.url, ['db', 'migrate']);

      expect(run).toMatchObject({
        exitCode: 0,
        result: {
          ok: true,
          migrationsApplied: 1,
          perSpace: [
            {
              spaceId: 'app',
              operations: [
                { label: 'Create table Post' },
                { label: 'Create table User' },
                { label: expect.stringMatching(/^Create index Post_authorId_idx_\w+ on Post$/) },
                { label: 'Add foreign key Post_authorId_fkey on Post' },
              ],
            },
          ],
        },
      });
    });

    it('passes db verify', async () => {
      const run = await prisma(projectDir, database.url, ['db', 'verify']);

      expect(run).toMatchObject({
        exitCode: 0,
        result: {
          ok: true,
          mode: 'full',
          target: { expected: 'mysql' },
          schema: { summary: 'Database schema satisfies contract', warnings: [] },
        },
      });
    });

    it('passes db sign', async () => {
      const run = await prisma(projectDir, database.url, ['db', 'sign']);

      expect(run).toMatchObject({
        exitCode: 0,
        result: { ok: true, summary: 'Database signed' },
      });
    });

    it('plans no new migration from the unchanged contract', async () => {
      const migrationsDir = join(projectDir, 'migrations');
      const before = await listFiles(migrationsDir);

      const run = await prisma(projectDir, database.url, ['migration', 'plan', '--name', 'again']);

      expect(run).toMatchObject({ exitCode: 0, result: { ok: true, noOp: true, operations: [] } });
      expect(await listFiles(migrationsDir)).toEqual(before);
    });
  },
);
