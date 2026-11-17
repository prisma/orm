import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildProject,
  harness,
  mocks,
  ormConfig,
  removeMigrateShowProjects,
  resetMigrateShowMocks,
} from './fixtures/migrate-show-project';

afterEach(removeMigrateShowProjects);
beforeEach(resetMigrateShowMocks);

describe('db migrate and the module migration files import from', () => {
  it('refuses before connecting when the config names no migration module', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd, { migrations: { dir: 'migrations' } })).run(
      ['db', 'migrate', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CONFIG.MIGRATION_MODULE_MISSING' } },
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
