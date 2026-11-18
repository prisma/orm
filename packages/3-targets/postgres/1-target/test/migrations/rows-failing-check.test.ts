import { coreHash } from '@internal/contract/types';
import { CheckConstraint, SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { computeCheckContentHash, formatWireName } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { buildTargetDetails } from '../../src/core/migrations/planner-target-details';
import { rowsFailingCheckOf } from '../../src/core/migrations/rows-failing-check';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';

const OLD_EXPRESSION = `"address" IS NULL`;
const NEW_EXPRESSION = `"address" IS NOT NULL`;
const PREFIX = 'user_address_shape';
const OLD = formatWireName(PREFIX, computeCheckContentHash(OLD_EXPRESSION));
const NEW = formatWireName(PREFIX, computeCheckContentHash(NEW_EXPRESSION));

function storageWith(check: CheckConstraint): SqlStorage {
  return new SqlStorage({
    storageHash: coreHash('contract'),
    namespaces: {
      public: postgresCreateNamespace({
        id: 'public',
        entries: {
          table: {
            user: new StorageTable({
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                address: { dataType: 'pg/jsonb', codecId: 'pg/jsonb@1', nullable: true },
              },
              primaryKey: { columns: ['id'] },
              foreignKeys: [],
              uniques: [],
              indexes: [],
              checks: [check],
            }),
          },
        },
      }),
    },
  });
}

function checkOperation(id: string, name: string) {
  return {
    id,
    label: id,
    operationClass: 'additive' as const,
    target: {
      id: 'postgres',
      details: buildTargetDetails('checkConstraint', name, 'public', 'user'),
    },
    precheck: [],
    execute: [],
    postcheck: [],
  };
}

const wireCheck = new CheckConstraint({
  naming: { kind: 'wire', prefix: PREFIX, hash: computeCheckContentHash(NEW_EXPRESSION) },
  expression: NEW_EXPRESSION,
});
const drop = checkOperation(`dropCheckConstraint.user.${OLD}`, OLD);
const add = checkOperation(`checkConstraint.user.${NEW}`, NEW);

describe('the rows a check the apply adds refuses', () => {
  it('names the check, the table and the column, gives the query, and the check the plan drops before it', () => {
    expect(
      rowsFailingCheckOf({
        operation: add,
        constraint: NEW,
        storage: storageWith(wireCheck),
        operations: [drop, add],
        operationIndex: 1,
      }),
    ).toEqual({
      summary: `Rows of table "user" fail check "${NEW}" on column "address", so the check cannot be added.`,
      why: `Find them with \`SELECT * FROM "public"."user" WHERE NOT ("address" IS NOT NULL)\`.`,
      fact: { check: NEW, replacedCheck: OLD, operationIndex: 1 },
    });
  });

  it('names no column and no replaced check for a check named by hand', () => {
    const exact = new CheckConstraint({
      naming: { kind: 'exact', name: 'address_present' },
      expression: NEW_EXPRESSION,
    });
    const addExact = checkOperation('checkConstraint.user.address_present', 'address_present');
    expect(
      rowsFailingCheckOf({
        operation: addExact,
        constraint: 'address_present',
        storage: storageWith(exact),
        operations: [drop, addExact],
        operationIndex: 1,
      }),
    ).toEqual({
      summary: 'Rows of table "user" fail check "address_present", so the check cannot be added.',
      why: 'Find them with `SELECT * FROM "public"."user" WHERE NOT ("address" IS NOT NULL)`.',
      fact: { check: 'address_present', operationIndex: 1 },
    });
  });

  it('says nothing when the violated check is not the one the operation adds, or the contract does not declare it', () => {
    const storage = storageWith(wireCheck);
    expect([
      rowsFailingCheckOf({
        operation: add,
        constraint: 'other',
        storage,
        operations: [add],
        operationIndex: 0,
      }),
      rowsFailingCheckOf({
        operation: checkOperation('checkConstraint.user.undeclared', 'undeclared'),
        constraint: 'undeclared',
        storage,
        operations: [],
        operationIndex: 0,
      }),
    ]).toEqual([undefined, undefined]);
  });
});
