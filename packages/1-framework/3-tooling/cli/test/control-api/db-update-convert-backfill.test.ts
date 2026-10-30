import type { Contract } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { StatementText } from '../../src/control-api/statements/statement-text';
import {
  DESTINATION_HASH,
  markerAt,
  migrationsDirWithSnapshot,
  ORIGIN_HASH,
  recordingMigrations,
  update,
} from './db-update-statement-fixtures';
import { contractOf } from './statements/statement-fixtures';

function contractAt(storageHash: string, namespaces: Parameters<typeof contractOf>[0]): Contract {
  const contract = contractOf(namespaces);
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    ...contract,
    storage: { ...contract.storage, storageHash, tables: {} },
  } as unknown as Contract;
}

function app(values: Readonly<Record<string, string>>, geoPoint: readonly string[]) {
  return {
    app: {
      models: {
        Task: { fields: ['id', 'type'], discriminator: 'type', variants: values },
        Bug: { base: 'Task' },
        User: {
          fields: ['id', 'age'],
          fieldTypes: {
            age: { codecId: values['bug'] === undefined ? 'test/int@1' : 'test/text@1' },
          },
        },
      },
      valueObjects: { GeoPoint: geoPoint },
    },
  };
}

const origin = contractAt(ORIGIN_HASH, app({ bug: 'Bug' }, ['lat']));
const destination = contractAt(DESTINATION_HASH, app({ defect: 'Bug' }, ['lat', 'country']));

async function updateWith(fieldStatements: readonly StatementText[]) {
  const recording = recordingMigrations();
  const result = update({
    migrationsDir: await migrationsDirWithSnapshot(origin),
    marker: markerAt(ORIGIN_HASH),
    renames: [],
    fieldStatements,
    destination,
    migrations: recording.migrations,
  });
  return { result, calls: recording.calls };
}

describe('executeDbUpdate with convert and backfill statements', () => {
  it('hands a variant convert to the planner', async () => {
    const { result, calls } = await updateWith([{ verb: 'convert', text: 'Bug' }]);
    await result;
    expect(calls.map(({ statements }) => statements)).toEqual([
      [{ kind: 'convert', entity: 'model', model: { namespaceId: 'app', model: 'Bug' } }],
    ]);
  });

  it('refuses a field convert and a value object field backfill once they resolve, before it plans', async () => {
    const { result, calls } = await updateWith([
      { verb: 'convert', text: 'Bug' },
      { verb: 'convert', text: 'User.age' },
      { verb: 'backfill', text: 'GeoPoint.country' },
    ]);
    await expect(result).rejects.toMatchObject({
      code: 'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
      meta: {
        statements: [
          { verb: 'convert', text: 'User.age' },
          { verb: 'backfill', text: 'GeoPoint.country' },
        ],
      },
    });
    expect(calls).toEqual([]);
  });

  it('names no --from in the printed plan command when no migration ends at the database contract', async () => {
    const { result } = await updateWith([{ verb: 'convert', text: 'User.age' }]);
    const refusal = await result.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toMatchObject({
      code: 'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
      fix: expect.not.stringContaining('--from'),
    });
  });

  it('refuses a convert that does not resolve as unresolved', async () => {
    const { result, calls } = await updateWith([{ verb: 'convert', text: 'User.nickname' }]);
    await expect(result).rejects.toMatchObject({ code: 'MIGRATION.STATEMENT_UNRESOLVED' });
    expect(calls).toEqual([]);
  });
});
