import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  contractJson,
  createOfflineProject,
  OFFLINE_COMMANDS,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  resetRenderContractDtsMock,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const ADVICE = 'Apply the schema change with the owning tool';

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

function ownedHarness(project: OfflineProject) {
  return createOrmTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    orm: {
      ...offlineConfig({ project }),
      contract: {
        source: {
          format: 'psl',
          inputs: [],
          load: async () => contractJson('unused'),
          schemaOwner: { applySchemaChangeAdvice: ADVICE },
        },
        output: project.contractPath,
      },
    },
  });
}

describe('migration authoring on a database whose schema another tool changes', () => {
  it.each([
    ['migration plan', ['migration', 'plan', '--name', 'first']],
    ['migration new', ['migration', 'new', '--name', 'first']],
  ])('%s refuses, writes no migration, and points at that tool', async (_name, argv) => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await ownedHarness(project).run([...argv, '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.SCHEMA_OWNED_ELSEWHERE',
          nextActions: [
            { kind: 'user-choice', label: ADVICE },
            {
              kind: 'run-command',
              label: 'Then sign the database again',
              command: '{bin} db sign',
            },
          ],
        },
      },
    });
    expect(existsSync(project.migrationsDir)).toBe(false);
  });
});
