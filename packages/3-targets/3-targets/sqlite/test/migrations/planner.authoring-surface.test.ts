import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import {
  SqliteUnboundDatabase,
  sqliteCreateNamespace,
} from '../../src/core/sqlite-unbound-database';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => {
    throw new Error('lower() called on stubLowerer — planner must use lowerToExecuteRequest()');
  },
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
};

const SNAPSHOTS_IMPORT_PATH = '../../snapshots';
const TO_STORAGE_HASH = 'b'.repeat(64);
const FROM_STORAGE_HASH = 'a'.repeat(64);

function createContract(): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('profile'),
    storage: new SqlStorage({
      storageHash: coreHash(TO_STORAGE_HASH),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
                  email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function fromContractWithHash(hash: string): Contract<SqlStorage> {
  return {
    ...createContract(),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: { [UNBOUND_NAMESPACE_ID]: SqliteUnboundDatabase.instance },
    }),
  };
}

const emptySchema = new SqlSchemaIR({ tables: {} });

describe('SqliteMigrationPlanner authoring surface', () => {
  describe('plan(...).plan', () => {
    it('returns a TypeScriptRenderableSqliteMigration with targetId="sqlite"', () => {
      const planner = createSqliteMigrationPlanner(stubLowerer);
      const result = planner.plan({
        contract: createContract(),
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: fromContractWithHash(FROM_STORAGE_HASH),
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') return;
      expect(result.plan.targetId).toBe('sqlite');
    });

    it('describe() returns the supplied from/to meta derived from fromContract', () => {
      const planner = createSqliteMigrationPlanner(stubLowerer);
      const contract = createContract();
      const fromContract = fromContractWithHash(FROM_STORAGE_HASH);
      const result = planner.plan({
        contract: contract,
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
      });

      if (result.kind !== 'success') throw new Error('expected success');
      const meta = result.plan.describe();
      expect(meta.from).toBe(fromContract.storage.storageHash);
      expect(meta.to).toBe(contract.storage.storageHash);
    });

    it('describe().from is null when fromContract is null', () => {
      const planner = createSqliteMigrationPlanner(stubLowerer);
      const result = planner.plan({
        contract: createContract(),
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
      });

      if (result.kind !== 'success') throw new Error('expected success');
      expect(result.plan.describe().from).toBeNull();
    });

    it('destination carries both storageHash and profileHash from the contract', () => {
      const planner = createSqliteMigrationPlanner(stubLowerer);
      const contract = createContract();
      const result = planner.plan({
        contract: contract,
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
      });

      if (result.kind !== 'success') throw new Error('expected success');
      expect(result.plan.destination).toEqual({
        storageHash: contract.storage.storageHash,
        profileHash: contract.profileHash,
      });
    });

    it('operations getter renders the IR via toOp() in emission order', async () => {
      const planner = createSqliteMigrationPlanner(stubLowerer);
      const result = planner.plan({
        contract: createContract(),
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
      });

      if (result.kind !== 'success') throw new Error('expected success');
      const ops = await Promise.all(result.plan.operations);
      expect(ops).toHaveLength(1);
      expect(ops[0]?.id).toBe('table.user');
      expect(ops[0]?.operationClass).toBe('additive');
    });

    it('renderTypeScript() emits a class-flow scaffold with target-sqlite/migration import', () => {
      const planner = createSqliteMigrationPlanner(stubLowerer);
      const result = planner.plan({
        contract: createContract(),
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: fromContractWithHash(FROM_STORAGE_HASH),
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
      });

      if (result.kind !== 'success') throw new Error('expected success');
      const source = result.plan.renderTypeScript(keepInternalSpecifiers);
      expect(source).toContain("from '@internal/sqlite/migration'");
      expect(source).toMatch(/\bMigration\b/);
      // New shape: base derives describe() from the imported contract JSON, so
      // the scaffold carries `Migration<Start, End>` + the JSON/field imports
      // and emits no `describe()` / hash literals.
      expect(source).toContain('export default class M extends Migration<Start, End>');
      expect(source).toContain('override readonly startContractJson = startContract;');
      expect(source).toContain('override readonly endContractJson = endContract;');
      expect(source).not.toContain('describe()');
      expect(source).not.toContain(`'${FROM_STORAGE_HASH}'`);
      expect(source).not.toContain(`"${FROM_STORAGE_HASH}"`);
      expect(source).toContain('this.createTable(');
    });
  });

  describe('emptyMigration(context)', () => {
    it("identifies as the 'sqlite' target with no operations and the supplied destination hash", () => {
      const planner = createSqliteMigrationPlanner(stubLowerer);
      const empty = planner.emptyMigration(
        {
          packageDir: '/tmp/migration-pkg',
          fromHash: null,
          toHash: 'to-hash-stub',
          snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
        },
        APP_SPACE_ID,
      );

      expect(empty.targetId).toBe('sqlite');
      expect(empty.operations).toEqual([]);
      expect(empty.destination).toEqual({ storageHash: 'to-hash-stub' });
    });

    it('renders a stub that derives from/to from contract JSON and has an empty operations list', () => {
      const planner = createSqliteMigrationPlanner(stubLowerer);
      const empty = planner.emptyMigration(
        {
          packageDir: '/tmp/migration-pkg',
          fromHash: FROM_STORAGE_HASH,
          toHash: TO_STORAGE_HASH,
          snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
        },
        APP_SPACE_ID,
      );

      const source = empty.renderTypeScript(keepInternalSpecifiers);
      expect(source).toContain("from '@internal/sqlite/migration'");
      // New shape: base derives from/to; scaffold imports the contract JSON
      // rather than embedding hash literals or a describe() method.
      expect(source).toContain('export default class M extends Migration<Start, End>');
      expect(source).toContain('override readonly endContractJson = endContract;');
      expect(source).not.toContain('describe()');
      expect(source).not.toContain(`"${FROM_STORAGE_HASH}"`);
      expect(source).not.toContain(`"${TO_STORAGE_HASH}"`);
      expect(source).toContain('override get operations()');
    });
  });

  describe('policy violations', () => {
    it('returns failure when policy excludes "additive"', () => {
      const planner = createSqliteMigrationPlanner(stubLowerer);
      const result = planner.plan({
        contract: createContract(),
        schema: emptySchema,
        policy: { allowedOperationClasses: ['widening', 'destructive'] },
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
      });

      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') return;
      expect(result.conflicts[0]?.kind).toBe('unsupportedOperation');
      expect(result.conflicts[0]?.summary).toContain('additive');
    });
  });
});
