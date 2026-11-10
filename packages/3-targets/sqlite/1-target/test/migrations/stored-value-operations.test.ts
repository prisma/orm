import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { describe, expect, it } from 'vitest';
import { createSqliteBuiltinCodecLookup } from '../../src/core/codec-registry';
import {
  RemoveStoredValueCall,
  ReplaceStoredValueCall,
} from '../../src/core/migrations/op-factory-call';
import {
  removeStoredValue,
  replaceStoredValue,
} from '../../src/core/migrations/operations/stored-values';
import type { SqlitePlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { SqliteMigration } from '../../src/core/migrations/sqlite-migration';
import type { Contract } from '../fixtures/sqlite-contract.d';
import contractJson from '../fixtures/sqlite-contract.json' with { type: 'json' };

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

const target = {
  id: 'sqlite',
  details: { objectType: 'column', name: 'state', table: 'task' },
};

describe('replaceStoredValue', () => {
  it('changes the value in the rows that hold it, and checks afterwards that none does', () => {
    expect(replaceStoredValue('task', 'state', 'ARCHIVED', 'RETIRED')).toEqual({
      id: 'replaceStoredValue.task.state.ARCHIVED',
      label: 'Replace value "ARCHIVED" with "RETIRED" in column "state" of "task"',
      operationClass: 'widening',
      target,
      precheck: [],
      execute: [
        {
          description: 'replace value "ARCHIVED" with "RETIRED" in column "state"',
          sql: 'UPDATE "task" SET "state" = ?2 WHERE "state" = ?1',
          params: ['ARCHIVED', 'RETIRED'],
        },
      ],
      postcheck: [
        {
          description: 'verify no row of "task" holds value "ARCHIVED" in column "state"',
          sql: 'SELECT NOT EXISTS (SELECT 1 FROM "task" WHERE "state" = ?1) AS result',
          params: ['ARCHIVED'],
        },
      ],
    });
  });

  it('passes a value with a quote in it as a parameter, never in the SQL text', () => {
    const op = replaceStoredValue('task', 'state', "it's", 'it"s');

    expect([...op.execute, ...op.postcheck].map((step) => step.sql).join('\n')).not.toMatch(
      /it's|it"s/,
    );
    expect(op.execute[0]?.params).toEqual(["it's", 'it"s']);
  });
});

describe('removeStoredValue', () => {
  it('sets the value to NULL in the rows that hold it, after checking that the column takes NULL or no row holds the value', () => {
    expect(removeStoredValue('task', 'state', 3, undefined)).toEqual({
      id: 'removeStoredValue.task.state.3',
      label: 'Remove value 3 from column "state" of "task"',
      operationClass: 'destructive',
      target,
      precheck: [
        {
          description: 'ensure column "state" of "task" takes NULL, or no row holds 3 in it',
          sql: `SELECT (SELECT COUNT(*) > 0 FROM pragma_table_info('task') WHERE name = 'state' AND "notnull" = 0) OR NOT EXISTS (SELECT 1 FROM "task" WHERE "state" = ?1) AS result`,
          params: [3],
        },
      ],
      execute: [
        {
          description: 'remove value 3 from column "state"',
          sql: 'UPDATE "task" SET "state" = NULL WHERE "state" = ?1',
          params: [3],
        },
      ],
      postcheck: [
        {
          description: 'verify no row of "task" holds value 3 in column "state"',
          sql: 'SELECT NOT EXISTS (SELECT 1 FROM "task" WHERE "state" = ?1) AS result',
          params: [3],
        },
      ],
    });
  });
});

describe('stored value calls', () => {
  const replace = new ReplaceStoredValueCall('task', 'state', 'ARCHIVED', 'RETIRED');
  const remove = new RemoveStoredValueCall('task', 'state', 3);

  it('are named after their facade methods and classed by their effect', () => {
    expect(replace).toMatchObject({
      factoryName: 'replaceStoredValue',
      operationClass: 'widening',
      label: 'Replace value "ARCHIVED" with "RETIRED" in column "state" of "task"',
    });
    expect(remove).toMatchObject({
      factoryName: 'removeStoredValue',
      operationClass: 'destructive',
      label: 'Remove value 3 from column "state" of "task"',
    });
  });

  it('lower to the operations their factories build', async () => {
    expect(await replace.toOp()).toEqual(
      replaceStoredValue('task', 'state', 'ARCHIVED', 'RETIRED'),
    );
    expect(await remove.toOp()).toEqual(removeStoredValue('task', 'state', 3, undefined));
  });

  it('render the facade call, with no import', () => {
    expect(replace.renderTypeScript()).toBe(
      'this.replaceStoredValue({ table: "task", column: "state", from: "ARCHIVED", to: "RETIRED" })',
    );
    expect(remove.renderTypeScript()).toBe(
      'this.removeStoredValue({ table: "task", column: "state", value: 3 })',
    );
    expect(replace.importRequirements()).toEqual([]);
    expect(remove.importRequirements()).toEqual([]);
  });
});

class ExposedMigration extends SqliteMigration<Contract, Contract> {
  override readonly endContractJson = contractJson;
  override get operations() {
    return [];
  }

  callReplaceStoredValue(options: {
    readonly table: string;
    readonly column: string;
    readonly from: string | number;
    readonly to: string | number;
  }): Promise<Op> {
    return this.replaceStoredValue(options);
  }

  callRemoveStoredValue(options: {
    readonly table: string;
    readonly column: string;
    readonly value: string | number;
  }): Promise<Op> {
    return this.removeStoredValue(options);
  }
}

describe('stored value codecs', () => {
  it('write a value through the column codec the call carries, and render the codec', async () => {
    const codec = {
      codecRef: { codecId: 'sqlite/bigint@1' },
      codecs: createSqliteBuiltinCodecLookup(),
    };
    const call = new ReplaceStoredValueCall('task', 'rank', '7', '8', codec);

    expect((await call.toOp()).execute[0]?.params).toEqual(['7', '8']);
    expect(call.renderTypeScript()).toBe(
      'this.replaceStoredValue({ table: "task", column: "rank", from: "7", to: "8", codecRef: { codecId: "sqlite/bigint@1" } })',
    );
    await expect(new RemoveStoredValueCall('task', 'rank', 'x', codec).toOp()).rejects.toThrow();
  });
});

describe('a planned removal', () => {
  it('names its enum value, and marks its check with it', async () => {
    const call = new RemoveStoredValueCall(
      'task',
      'state',
      'archived',
      { codecRef: { codecId: 'sqlite/text@1' }, codecs: createSqliteBuiltinCodecLookup() },
      { enum: 'Status', member: 'ARCHIVED' },
    );

    expect(call.renderTypeScript()).toBe(
      'this.removeStoredValue({ table: "task", column: "state", value: "archived", codecRef: { codecId: "sqlite/text@1" }, enumValue: { enum: "Status", member: "ARCHIVED" } })',
    );
    expect((await call.toOp()).precheck[0]).toMatchObject({
      description: 'ensure column "state" of "task" takes NULL, or no row holds "archived" in it',
      meta: {
        rowsHoldingValue: {
          enumValue: { enum: 'Status', member: 'ARCHIVED' },
          value: 'archived',
          codecRef: { codecId: 'sqlite/text@1' },
          table: 'task',
          column: 'state',
          storedValue: 'archived',
        },
      },
    });
  });
});

describe('stored value arguments', () => {
  it('refuse a value that is neither a string nor a number, which would match no row', () => {
    const missing = null as unknown as string;
    expect(() => new ReplaceStoredValueCall('task', 'state', missing, 'b')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'replaceStoredValue({ table: "task", column: "state" }): from must be a string or a number; got null',
        meta: { what: 'replaceStoredValue from' },
      }),
    );
    expect(() => new RemoveStoredValueCall('task', 'state', Number.POSITIVE_INFINITY)).toThrow(
      expect.objectContaining({
        message:
          'removeStoredValue({ table: "task", column: "state" }): value must be a string or a number; got Infinity',
      }),
    );
  });
});

describe('SqliteMigration replaceStoredValue and removeStoredValue', () => {
  it('give the operations their calls give, with no control stack', async () => {
    expect(
      await new ExposedMigration().callReplaceStoredValue({
        table: 'task',
        column: 'state',
        from: 'a',
        to: 'b',
      }),
    ).toEqual(await new ReplaceStoredValueCall('task', 'state', 'a', 'b').toOp());
    expect(
      await new ExposedMigration().callRemoveStoredValue({
        table: 'task',
        column: 'state',
        value: 'a',
      }),
    ).toEqual(await new RemoveStoredValueCall('task', 'state', 'a').toOp());
  });
});
