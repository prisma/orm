import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationPlanner,
  type MigrationPlannerSuccessResult,
  planOriginOf,
} from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

const TO_STORAGE_HASH = '2'.repeat(64);
const FROM_STORAGE_HASH = '3'.repeat(64);

function createEmptyContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash(TO_STORAGE_HASH),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: {} },
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

function makeFrameworkPlanner(): MigrationPlanner<'sql', 'postgres'> {
  return postgresTargetDescriptor.migrations.createPlanner({
    familyId: 'sql',
    extensions: [],
  } as never);
}

describe('PostgresMigrationPlanner authoring surface', () => {
  describe('plan(...).plan.renderTypeScript()', () => {
    it('emits a migration scaffold carrying the destination storage hash', () => {
      const planner = makeFrameworkPlanner();
      const contract = createEmptyContract();
      const fromSchemaIR = new PostgresDatabaseSchemaNode({
        namespaces: {
          public: new PostgresNamespaceSchemaNode({
            schemaName: 'public',
            tables: {},
          }),
        },
        pgVersion: '',
        roles: [],
        existingSchemas: [],
      });

      const fromContract: Contract<SqlStorage> = {
        ...createEmptyContract(),
        storage: new SqlStorage({
          storageHash: coreHash(FROM_STORAGE_HASH),
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
              id: UNBOUND_NAMESPACE_ID,
              entries: { table: {} },
            }),
          },
        }),
      };
      const result = planner.plan({
        contract,
        schema: fromSchemaIR,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract,
        origin: planOriginOf(fromContract),
        statements: [],
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });

      if (result.kind !== 'success') {
        throw new Error(`Expected planner success, got: ${JSON.stringify(result)}`);
      }
      const success = result as MigrationPlannerSuccessResult;

      const source = success.plan.renderTypeScript(keepInternalSpecifiers);

      expect(source).toContain("from '@internal/postgres/migration'");
      expect(source).toMatch(/\bMigration\b/);
      // New shape: base derives describe() from the imported contract JSON, so
      // the scaffold carries `Migration<Start, End>` + the JSON/field imports
      // and emits no describe()/hash literals.
      expect(source).toContain('export default class M extends Migration<Start, End>');
      expect(source).toContain('override readonly endContractJson = endContract;');
      expect(source).not.toContain('describe()');
      expect(source).not.toContain(`'${FROM_STORAGE_HASH}'`);
      expect(source).not.toContain(`"${FROM_STORAGE_HASH}"`);
    });
  });

  describe('emptyMigration(context)', () => {
    it("identifies as the 'postgres' target with no operations and the supplied destination hash", () => {
      const planner = makeFrameworkPlanner();
      const empty = planner.emptyMigration(
        {
          packageDir: '/tmp/migration-pkg',
          fromHash: null,
          toHash: 'to-hash-stub',
          snapshotsImportPath: '../../snapshots',
        },
        APP_SPACE_ID,
      );

      expect(empty.targetId).toBe('postgres');
      expect(empty.operations).toEqual([]);
      expect(empty.destination).toEqual({ storageHash: 'to-hash-stub' });
    });

    it('renders a stub that derives from/to from contract JSON and has an empty operations list', () => {
      const planner = makeFrameworkPlanner();
      const fromHash = 'e'.repeat(64);
      const toHash = 'f'.repeat(64);
      const empty = planner.emptyMigration(
        {
          packageDir: '/tmp/migration-pkg',
          fromHash,
          toHash,
          snapshotsImportPath: '../../snapshots',
        },
        APP_SPACE_ID,
      );

      const source = empty.renderTypeScript(keepInternalSpecifiers);

      expect(source).toContain("from '@internal/postgres/migration'");
      expect(source).toContain('export default class M extends Migration<Start, End>');
      expect(source).toContain('override readonly endContractJson = endContract;');
      expect(source).not.toContain('describe()');
      expect(source).not.toContain(`"${fromHash}"`);
      expect(source).not.toContain(`"${toHash}"`);
      expect(source).toContain('override get operations()');
    });
  });
});
