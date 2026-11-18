import { cp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyProject, type ProjectCopy, prisma } from './cli';

interface MigrationManifest {
  readonly from: string | null;
  readonly to: string;
}

const exampleDir = fileURLToPath(new URL('..', import.meta.url));

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readManifest(migrationDir: string): Promise<MigrationManifest> {
  return JSON.parse(await readFile(join(migrationDir, 'migration.json'), 'utf8'));
}

async function firstMigrationDir(projectDir: string): Promise<string> {
  const appMigrationsDir = join(projectDir, 'migrations', 'app');
  const [first] = (await readdir(appMigrationsDir)).sort();
  if (first === undefined) throw new Error(`${appMigrationsDir} holds no migration`);
  return join(appMigrationsDir, first);
}

describe('migration plan in a project with no migrations', () => {
  let project: ProjectCopy;
  let committedDir: string;
  let committedManifest: MigrationManifest;

  beforeAll(async () => {
    committedDir = await firstMigrationDir(exampleDir);
    committedManifest = await readManifest(committedDir);
    project = await copyProject();
    await rm(join(project.dir, 'migrations'), { recursive: true });
    const snapshotDir = join(exampleDir, 'migrations', 'snapshots', committedManifest.to);
    for (const file of ['contract.json', 'contract.d.ts']) {
      await cp(join(snapshotDir, file), join(project.dir, 'src', 'prisma', file));
    }
  });

  afterAll(async () => {
    await project?.remove();
  });

  it('plans the committed first migration from the contract it ends at', async () => {
    const run = await prisma(project.dir, undefined, ['migration', 'plan', '--name', 'init']);

    expect(run).toMatchObject({
      exitCode: 0,
      result: { ok: true, noOp: false, from: null, to: committedManifest.to },
    });
    const plannedDir = await firstMigrationDir(project.dir);
    expect(await readJson(join(plannedDir, 'ops.json'))).toEqual(
      await readJson(join(committedDir, 'ops.json')),
    );
    expect(await readJson(join(plannedDir, 'migration.json'))).toEqual({
      ...committedManifest,
      createdAt: expect.any(String),
      migrationHash: expect.any(String),
    });
  });
});
