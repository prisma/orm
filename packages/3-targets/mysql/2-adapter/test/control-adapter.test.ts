import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { DdlColumn, DdlNode } from '@internal/sql-relational-core/ast';
import { createTable } from '@internal/target-mysql/contract-free';
import type { MysqlDdlVisitor } from '@internal/target-mysql/ddl';
import { describe, expect, it } from 'vitest';
import { mysqlAdapterCapabilities } from '../src/core/capabilities';
import { createAdapter, recordingDriver } from './helpers';

class OtherDdl extends DdlNode {
  readonly kind = 'other' as const;
}

class CreateTableFromAnotherCopy extends DdlNode {
  readonly kind = 'copied-create-table' as const;
  accept<R>(visitor: MysqlDdlVisitor<R>): R {
    return visitor.createTable(
      createTable({ table: 'Copied', columns: [new DdlColumn({ name: 'id', type: 'int' })] }),
    );
  }
}

const markerRow = {
  space: 'app',
  core_hash: 'sha256:core',
  profile_hash: 'sha256:profile',
  contract_json: null,
  canonical_version: '1',
  updated_at: '2024-01-02 03:04:05.678',
  app_tag: null,
  meta: '{}',
  invariants: '["b","a"]',
};

const ledgerRow = {
  space: 'app',
  migration_name: '20240101_init',
  migration_hash: 'sha256:m',
  origin_core_hash: null,
  destination_core_hash: 'sha256:core',
  operations: '[{"id":"one"},{"id":"two"}]',
  created_at: '2024-01-02 03:04:05.678',
};

function catalogDriver(tables: readonly string[], rows: readonly Record<string, unknown>[]) {
  return recordingDriver((sql, params) => {
    if (sql.includes('information_schema.TABLES')) {
      return tables.includes(String(params[0])) ? [{ TABLE_NAME: params[0] }] : [];
    }
    return rows;
  });
}

describe('MysqlControlAdapter', () => {
  it('reports the capabilities of MySQL 8.4', () => {
    expect(mysqlAdapterCapabilities).toEqual({
      sql: { orderBy: true, limit: true, foreignKeys: true, enums: true },
    });
  });

  it('names its marker table', () => {
    expect(createAdapter().markerLocation).toBe('_prisma_marker');
  });

  it('reads no marker from a database without the marker table', async () => {
    const adapter = createAdapter();
    const driver = catalogDriver([], []);
    expect(await adapter.readMarker(driver, 'app')).toBeNull();
    expect(await adapter.readAllMarkers(driver)).toEqual(new Map());
    expect(await adapter.readLedger(driver)).toEqual([]);
  });

  it('reads a marker row as MySQL sends it', async () => {
    const adapter = createAdapter();
    const driver = catalogDriver(['_prisma_marker'], [markerRow]);
    const expected = {
      storageHash: 'sha256:core',
      profileHash: 'sha256:profile',
      contractJson: null,
      canonicalVersion: 1,
      updatedAt: new Date('2024-01-02T03:04:05.678Z'),
      appTag: null,
      meta: {},
      invariants: ['b', 'a'],
    };
    expect(await adapter.readMarker(driver, 'app')).toEqual(expected);
    expect(await adapter.readAllMarkers(driver)).toEqual(new Map([['app', expected]]));
    expect(driver.statements.at(-1)).toBe(
      'SELECT space, core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants FROM `_prisma_marker`',
    );
  });

  it('refuses a marker row whose invariants are not JSON', async () => {
    const driver = catalogDriver(['_prisma_marker'], [{ ...markerRow, invariants: '[' }]);
    await expect(createAdapter().readMarker(driver, 'app')).rejects.toThrow(/corrupt/);
  });

  it('reads the ledger in the order it was written', async () => {
    const driver = catalogDriver(['_prisma_ledger'], [ledgerRow]);
    expect(await createAdapter().readLedger(driver, 'app')).toEqual([
      {
        space: 'app',
        migrationName: '20240101_init',
        migrationHash: 'sha256:m',
        from: null,
        to: 'sha256:core',
        appliedAt: new Date('2024-01-02T03:04:05.678Z'),
        operationCount: 2,
      },
    ]);
    expect(driver.statements.at(-1)).toMatch(/WHERE space = \? ORDER BY id$/);
  });

  it('commits work that succeeds and rolls back work that fails', async () => {
    const adapter = createAdapter();
    const driver = recordingDriver();
    expect(await adapter.withTransaction(driver, async () => 'done')).toBe('done');
    await expect(
      adapter.withTransaction(driver, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(driver.statements).toEqual([
      'START TRANSACTION',
      'COMMIT',
      'START TRANSACTION',
      'ROLLBACK',
    ]);
  });

  it('takes no lock inside a transaction, because holdMarkerLock takes it around the transaction', async () => {
    const adapter = createAdapter();
    const driver = recordingDriver();
    await adapter.withTransaction(driver, () => adapter.lockMarker(driver));
    expect(driver.statements).toEqual(['START TRANSACTION', 'COMMIT']);
  });

  it('holds the marker lock outside a transaction while the work it guards runs, and releases it when that work ends', async () => {
    const adapter = createAdapter();
    const driver = recordingDriver((sql) =>
      sql.startsWith('SELECT GET_LOCK') ? [{ acquired: '1' }] : [],
    );
    const held = await adapter.holdMarkerLock(driver, async () => {
      await driver.query('CREATE TABLE IF NOT EXISTS marker');
      return adapter.withTransaction(driver, async () => 'signed');
    });
    await expect(
      adapter.holdMarkerLock(driver, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect({ held, statements: driver.statements.map((sql) => sql.split('(')[0]) }).toEqual({
      held: 'signed',
      statements: [
        'SELECT GET_LOCK',
        'CREATE TABLE IF NOT EXISTS marker',
        'START TRANSACTION',
        'COMMIT',
        'SELECT RELEASE_LOCK',
        'SELECT GET_LOCK',
        'SELECT RELEASE_LOCK',
      ],
    });
  });

  it('keeps the failure of the work it guards when releasing the marker lock fails too', async () => {
    const adapter = createAdapter();
    const driver = recordingDriver((sql) => {
      if (sql.startsWith('SELECT RELEASE_LOCK')) throw new Error('Connection lost');
      return sql.startsWith('SELECT GET_LOCK') ? [{ acquired: '1' }] : [];
    });
    const fails = async () => {
      throw new Error('boom');
    };
    await expect(adapter.holdMarkerLock(driver, fails)).rejects.toThrow('boom');
    await expect(adapter.holdMarkerLock(driver, async () => 'done')).rejects.toThrow(
      'Connection lost',
    );
  });

  it('refuses to go on when another process holds the marker lock', async () => {
    const adapter = createAdapter();
    const driver = recordingDriver((sql) =>
      sql.startsWith('SELECT GET_LOCK') ? [{ acquired: '0' }] : [],
    );
    await expect(adapter.holdMarkerLock(driver, async () => 'never')).rejects.toMatchObject({
      code: 'MIGRATION.MARKER_LOCK_TIMEOUT',
    });
  });

  it('advances the marker only when the locked row still holds the expected hash', async () => {
    const adapter = createAdapter();
    const stored = { core_hash: 'sha256:old', invariants: '["b"]' };
    const driver = recordingDriver((sql) => (sql.includes('FOR UPDATE') ? [stored] : []));
    const destination = { storageHash: 'sha256:new', profileHash: 'p', invariants: ['a'] };

    expect(await adapter.updateMarker(driver, 'app', 'sha256:other', destination)).toBe(false);
    expect(await adapter.updateMarker(driver, 'app', 'sha256:old', destination)).toBe(true);
    expect(driver.statements).toEqual([
      'SELECT core_hash, meta, invariants FROM `_prisma_marker` WHERE space = ? FOR UPDATE',
      'SELECT core_hash, meta, invariants FROM `_prisma_marker` WHERE space = ? FOR UPDATE',
      'UPDATE `_prisma_marker` SET core_hash = ?, profile_hash = ?, updated_at = CURRENT_TIMESTAMP(3), invariants = ? WHERE space = ? AND core_hash = ?',
    ]);
  });

  it('refuses query lowering', async () => {
    const adapter: SqlControlAdapter<'mysql'> = createAdapter();
    const queryLoweringRefusal = {
      code: 'RUNTIME.AST_UNSUPPORTED',
      message: 'Lowering queries is not yet supported on MySQL.',
      meta: { target: 'mysql', feature: 'Lowering queries' },
    };
    await expect(adapter.lowerToExecuteRequest({} as never)).rejects.toMatchObject(
      queryLoweringRefusal,
    );
    expect(() => adapter.lower({} as never, { contract: undefined })).toThrow(
      expect.objectContaining(queryLoweringRefusal),
    );
    expect(() => adapter.lower(new OtherDdl(), { contract: undefined })).toThrow(
      /cannot lower DDL/,
    );
  });

  it('refuses a DDL node MySQL does not build with a structured error', async () => {
    class ForeignDdl extends DdlNode {
      readonly kind = 'drop-type' as const;
      accept<R>(visitor: { dropType(node: ForeignDdl): R }): R {
        return visitor.dropType(this);
      }
    }
    const adapter: SqlControlAdapter<'mysql'> = createAdapter();
    const refusal = { code: 'RUNTIME.DDL_UNSUPPORTED', meta: { surface: 'control-adapter' } };
    await expect(adapter.lowerToExecuteRequest(new OtherDdl())).rejects.toMatchObject({
      ...refusal,
      message: 'The MySQL control adapter cannot lower the DDL node "other".',
    });
    await expect(adapter.lowerToExecuteRequest(new ForeignDdl())).rejects.toMatchObject({
      ...refusal,
      message: 'The MySQL control adapter cannot lower the DDL node "drop-type".',
    });
  });

  it('lowers a DDL node through the visitor it accepts, so a node from another copy of the module lowers too', async () => {
    const adapter = createAdapter();
    expect((await adapter.lowerToExecuteRequest(new CreateTableFromAnotherCopy())).sql).toBe(
      'CREATE TABLE `Copied` (\n  `id` int\n)',
    );
  });

  it('bootstraps the marker table for db sign', () => {
    expect(createAdapter().bootstrapSignMarkerQueries()).toHaveLength(1);
    expect(createAdapter().bootstrapControlTableQueries()).toHaveLength(2);
  });
});
