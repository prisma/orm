import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { harness } from './fixtures/migration-plan-project';
import {
  createOfflineProject,
  removeOfflineProjects,
  resetRenderContractDtsMock,
  seedDbRef,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const HASH_FROM = `beef${'1'.repeat(60)}`;

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

describe('migration new meets a db ref it cannot read', () => {
  it('refuses with the file and the reason, instead of scaffolding from the empty contract', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
    await writeFile(
      join(project.appMigrationsDir, 'refs', 'db.json'),
      JSON.stringify({ formatVersion: 1, hash: HASH_FROM, invariants: [], zzz: 1 }),
      'utf-8',
    );

    const run = await harness(project).run(['migration', 'new', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.INVALID_REF_FILE',
          why: expect.stringMatching(/refs\/db\.json.*zzz/),
        },
      },
    });
    expect((await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs')).toEqual(
      [],
    );
  });
});
