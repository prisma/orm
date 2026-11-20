import { writeFile } from 'node:fs/promises';
import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildProject,
  C2,
  contractEnvelope,
  harness,
  mocks,
  ormConfig,
  removeMigrateShowProjects,
  resetMigrateShowMocks,
  writePkg,
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

describe('db migrate --show --permit-policy-change without a ref', () => {
  it('refuses the flag before it connects', async () => {
    const cwd = await projectWithProductionRef();

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--show', '--to', C2, '--permit-policy-change', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: 'CLI.INVALID_ARGUMENTS',
          summary: '--permit-policy-change needs --to <ref>',
          why: `${C2} is not a ref, so it declares no policies to write.`,
          meta: { command: 'db migrate', to: C2 },
        },
      },
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});

describe('db migrate --show, a database whose data protection policy forbids data loss', () => {
  it('previews the refusal db migrate would raise for a pending migration that drops a column', async () => {
    const cwd = await buildProject();
    const c3 = '3'.repeat(64);
    const dirName = await writePkg(
      join(cwd, 'migrations', 'app'),
      { from: C2, to: c3, providedInvariants: [], createdAt: '2026-01-01T10:02:00.000Z' },
      [
        {
          id: 'column.users.nickname.drop',
          label: 'Drop column nickname',
          operationClass: 'destructive',
        },
      ],
    );
    await writeFile(join(cwd, 'contract.json'), JSON.stringify(contractEnvelope(c3)));
    mocks.readAllMarkers.mockResolvedValue(
      new Map([
        [
          'app',
          {
            storageHash: C2,
            invariants: [],
            meta: { policies: { dataProtection: { dataLoss: 'data-loss-forbidden' } } },
          },
        ],
      ]),
    );

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show', '--json'], { cwd });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
          meta: {
            command: 'db migrate',
            operations: [
              {
                setting: 'dataLoss',
                spaceId: 'app',
                migration: dirName,
                operationId: 'column.users.nickname.drop',
              },
            ],
          },
        },
      },
    });
  });
});
