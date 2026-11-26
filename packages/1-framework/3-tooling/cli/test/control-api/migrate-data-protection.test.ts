import type { ContractMarkerRecord } from '@internal/contract/types';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCESS_FORBIDDEN,
  APP_HEAD,
  APP_MIGRATION,
  CREATE_TABLE,
  DATA_LOSS_FORBIDDEN,
  DISABLE_RLS,
  DROP_COLUMN,
  forbidding,
  LATER_MIGRATION,
  markerAt,
  migrate,
  production,
  removeProjectDirs,
} from './migrate-data-protection.fixtures';

const KEEP_DATA =
  "This database's data protection policy forbids losing data, so these operations cannot run on it. If another database has already applied a migration listed here, keep it as it is. For a migration no database has applied, delete the migration and any later ones no database has applied, and plan again: with --rename if a model or field was only renamed, with --convert if its type changed, or after putting back in the contract what the migration removes.";

afterEach(removeProjectDirs);

describe('executeMigrate, data protection', () => {
  it('refuses a migration that loses data under data-loss-forbidden, and runs nothing', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [CREATE_TABLE, DROP_COLUMN],
      markers: forbidding(DATA_LOSS_FORBIDDEN),
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual({
      ok: false,
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      severity: 'error',
      summary: "This database's data protection policy forbids data loss",
      why: `The marker records dataLoss: data-loss-forbidden. Drop column "legacy_name" from "user" (stored column.user.legacy_name.drop), in migration ${APP_MIGRATION} of contract space "app".`,
      fix: KEEP_DATA,
      nextActions: [{ kind: 'user-choice', label: KEEP_DATA }],
      meta: {
        spaceId: 'app',
        command: 'db migrate',
        settings: [{ setting: 'dataLoss', level: 'data-loss-forbidden' }],
        operations: [
          {
            setting: 'dataLoss',
            spaceId: 'app',
            migration: APP_MIGRATION,
            operationId: DROP_COLUMN.id,
            subject: 'stored column.user.legacy_name.drop',
            label: DROP_COLUMN.label,
          },
        ],
      },
    });
    expect(runnerCalls).toEqual([]);
  });

  it('refuses a migration that disables row-level security under access-widening-forbidden', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [CREATE_TABLE, DISABLE_RLS],
      markers: forbidding(ACCESS_FORBIDDEN),
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      summary: "This database's data protection policy forbids changing who can read or write data",
      meta: {
        settings: [{ setting: 'accessWidening', level: 'access-widening-forbidden' }],
        operations: [
          {
            setting: 'accessWidening',
            spaceId: 'app',
            migration: APP_MIGRATION,
            operationId: DISABLE_RLS.id,
            subject: 'public.post',
            label: DISABLE_RLS.label,
          },
        ],
      },
    });
    expect(runnerCalls).toEqual([]);
  });

  it('reports both settings in one error when the migration breaks both', async () => {
    const { result } = await migrate({
      appOps: [DROP_COLUMN, DISABLE_RLS],
      markers: forbidding({
        dataProtection: {
          dataLoss: 'data-loss-forbidden',
          accessWidening: 'access-widening-forbidden',
        },
      }),
    });

    expect(result.ok ? undefined : result.failure.toEnvelope().meta).toMatchObject({
      settings: [
        { setting: 'dataLoss', level: 'data-loss-forbidden' },
        { setting: 'accessWidening', level: 'access-widening-forbidden' },
      ],
    });
  });

  it.each([
    { level: 'data-loss-with-consent', markers: new Map<string, ContractMarkerRecord>() },
    {
      level: 'data-loss-permitted',
      markers: forbidding({ dataProtection: { dataLoss: 'data-loss-permitted' } }),
    },
  ])('runs a migration that loses data under $level', async ({ markers }) => {
    const { result, runnerCalls } = await migrate({ appOps: [DROP_COLUMN], markers });

    expect({ ok: result.ok, spaces: runnerCalls.map((call) => call.map((o) => o.space)) }).toEqual({
      ok: true,
      spaces: [['app']],
    });
  });

  it('runs under the settings the ref declares when the run consents to loosening forbidden', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [DROP_COLUMN],
      markers: forbidding(DATA_LOSS_FORBIDDEN),
      ref: production({ dataProtection: { dataLoss: 'data-loss-with-consent' } }),
      permitPolicyChange: true,
    });

    expect({
      ok: result.ok,
      written: runnerCalls.map((call) =>
        call.map((o) => o.databasePolicies?.dataProtection.dataLoss),
      ),
    }).toEqual({ ok: true, written: [['data-loss-with-consent']] });
  });

  it('refuses, naming the ref, when the run consents to tightening to forbidden with a lossy migration pending', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [DROP_COLUMN],
      markers: new Map(),
      ref: production(DATA_LOSS_FORBIDDEN),
      permitPolicyChange: true,
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      summary: 'production declares a data protection policy that forbids data loss',
      why: expect.stringMatching(/^production declares dataLoss: data-loss-forbidden\. /),
    });
    expect(runnerCalls).toEqual([]);
  });

  it('records the policies of a run with nothing pending, since it has no operation to refuse', async () => {
    const { result, runnerCalls } = await migrate({
      appOps: [DROP_COLUMN],
      markers: new Map([['app', markerAt(APP_HEAD)]]),
      ref: production(DATA_LOSS_FORBIDDEN),
      permitPolicyChange: true,
    });

    expect({
      summary: result.ok ? result.value.summary : result.failure.code,
      written: runnerCalls.map((call) =>
        call.map((o) => o.databasePolicies?.dataProtection.dataLoss),
      ),
    }).toEqual({
      summary: 'Policies updated: dataProtection.dataLoss: data-loss-forbidden',
      written: [['data-loss-forbidden']],
    });
  });

  it('names the later of two pending migrations when it holds the drop', async () => {
    const { result } = await migrate({
      earlierOps: [CREATE_TABLE],
      appOps: [DROP_COLUMN],
      markers: forbidding(DATA_LOSS_FORBIDDEN),
    });

    const envelope = result.ok ? undefined : result.failure.toEnvelope();
    expect({ why: envelope?.why, meta: envelope?.meta }).toMatchObject({
      why: expect.stringContaining(`in migration ${LATER_MIGRATION} of contract space "app"`),
      meta: { operations: [{ migration: LATER_MIGRATION, operationId: DROP_COLUMN.id }] },
    });
  });
});
