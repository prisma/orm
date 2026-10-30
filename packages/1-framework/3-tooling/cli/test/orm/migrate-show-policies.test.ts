import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildProject,
  C2,
  harness,
  mocks,
  ormConfig,
  removeMigrateShowProjects,
  resetMigrateShowMocks,
} from './fixtures/migrate-show-project';

afterEach(removeMigrateShowProjects);
beforeEach(resetMigrateShowMocks);

async function projectWithProductionRef(): Promise<string> {
  const cwd = await buildProject();
  await writeRef(join(cwd, 'migrations', 'app', 'refs'), 'production', {
    hash: C2,
    invariants: [],
    policies: { change: ['migrate'] },
  });
  mocks.readAllMarkers.mockResolvedValue(new Map());
  return cwd;
}

describe('db migrate --show, a ref that declares policies', () => {
  it('previews the refusal db migrate would raise', async () => {
    const cwd = await projectWithProductionRef();

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--show', '--to', 'production', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.POLICY_MISMATCH',
          why: 'production declares change: migrate; the database has change: migrate, reconcile.',
        },
      },
    });
  });

  it('previews the route when --permit-policy-change consents', async () => {
    const cwd = await projectWithProductionRef();

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--show', '--to', 'production', '--permit-policy-change', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(0);
  });
});
