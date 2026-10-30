import { asNamespaceId } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  RemoveStoredValueCall,
  ReplaceStoredValueCall,
} from '../../src/core/migrations/op-factory-call';
import {
  removeStoredValue,
  replaceStoredValue,
} from '../../src/core/migrations/operations/stored-values';
import { postgresTypeLookups } from '../postgres-type-lookups';

const target = {
  id: 'postgres',
  details: { schema: 'app', objectType: 'column', name: 'state', table: 'task' },
};

describe('replaceStoredValue', () => {
  it('changes the value in a scalar column, and checks afterwards that no row holds the old one', () => {
    expect(replaceStoredValue('app', 'task', 'state', 'ARCHIVED', 'RETIRED', false)).toEqual({
      id: 'replaceStoredValue.task.state.ARCHIVED',
      label: 'Replace value "ARCHIVED" with "RETIRED" in column "state" of "task"',
      operationClass: 'widening',
      target,
      precheck: [],
      execute: [
        {
          description: 'replace value "ARCHIVED" with "RETIRED" in column "state"',
          sql: 'UPDATE "app"."task" SET "state" = $2 WHERE "state" = $1',
          params: ['ARCHIVED', 'RETIRED'],
        },
      ],
      postcheck: [
        {
          description: 'verify no row of "task" holds value "ARCHIVED" in column "state"',
          sql: 'SELECT NOT EXISTS (SELECT 1 FROM "app"."task" WHERE "state" = $1) AS result',
          params: ['ARCHIVED'],
        },
      ],
    });
  });

  it('changes the value inside every list of a list column', () => {
    const op = replaceStoredValue('app', 'task', 'labels', 1, 2, true);

    expect(op).toMatchObject({
      id: 'replaceStoredValue.task.labels.1',
      label: 'Replace value 1 with 2 in column "labels" of "task"',
      execute: [
        {
          sql: 'UPDATE "app"."task" SET "labels" = array_replace("labels", $1, $2) WHERE $1 = ANY("labels")',
          params: [1, 2],
        },
      ],
      postcheck: [
        {
          description: 'verify no list in column "labels" of "task" holds value 1',
          sql: 'SELECT NOT EXISTS (SELECT 1 FROM "app"."task" WHERE $1 = ANY("labels")) AS result',
          params: [1],
        },
      ],
    });
  });

  it('leaves a table of the unbound namespace unqualified', () => {
    const op = replaceStoredValue(UNBOUND_NAMESPACE_ID, 'task', 'state', 'a', 'b', false);

    expect(op.execute[0]?.sql).toBe('UPDATE "task" SET "state" = $2 WHERE "state" = $1');
  });

  it('passes a value with a quote in it as a parameter, never in the SQL text', () => {
    const op = replaceStoredValue('app', 'task', 'state', "it's", 'it"s', false);

    expect([...op.execute, ...op.postcheck].map((step) => step.sql).join('\n')).not.toMatch(
      /it's|it"s/,
    );
    expect(op.execute[0]?.params).toEqual(["it's", 'it"s']);
  });
});

const ACCEPTS_NULL_OR_NOT_HELD =
  'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = \'app\' AND table_name = $2 AND column_name = $3 AND is_nullable = \'YES\') OR NOT EXISTS (SELECT 1 FROM "app"."task" WHERE "state" = $1) AS result';

describe('removeStoredValue', () => {
  it('sets the value to NULL in a scalar column, after checking that the column takes NULL or no row holds the value', () => {
    expect(removeStoredValue('app', 'task', 'state', 'ARCHIVED', false, undefined)).toEqual({
      id: 'removeStoredValue.task.state.ARCHIVED',
      label: 'Remove value "ARCHIVED" from column "state" of "task"',
      operationClass: 'destructive',
      target,
      precheck: [
        {
          description:
            'ensure column "state" of "task" takes NULL, or no row holds "ARCHIVED" in it',
          sql: ACCEPTS_NULL_OR_NOT_HELD,
          params: ['ARCHIVED', 'task', 'state'],
        },
      ],
      execute: [
        {
          description: 'remove value "ARCHIVED" from column "state"',
          sql: 'UPDATE "app"."task" SET "state" = NULL WHERE "state" = $1',
          params: ['ARCHIVED'],
        },
      ],
      postcheck: [
        {
          description: 'verify no row of "task" holds value "ARCHIVED" in column "state"',
          sql: 'SELECT NOT EXISTS (SELECT 1 FROM "app"."task" WHERE "state" = $1) AS result',
          params: ['ARCHIVED'],
        },
      ],
    });
  });

  it('checks the current schema for a table of the unbound namespace', () => {
    expect(
      removeStoredValue(UNBOUND_NAMESPACE_ID, 'task', 'state', 'a', false, undefined).precheck[0]
        ?.sql,
    ).toContain('table_schema = current_schema()');
  });

  it('marks the check with the enum value it removes, when it is given, and keeps the check short', () => {
    const [check] = removeStoredValue('app', 'task', 'state', 'ARCHIVED', false, {
      enumValue: { enum: 'Status', member: 'ARCHIVED' },
      value: 'ARCHIVED',
    }).precheck;
    expect({ description: check?.description, meta: check?.meta }).toEqual({
      description: 'ensure column "state" of "task" takes NULL, or no row holds "ARCHIVED" in it',
      meta: {
        rowsHoldingValue: {
          enumValue: { enum: 'Status', member: 'ARCHIVED' },
          value: 'ARCHIVED',
          table: 'task',
          column: 'state',
          storedValue: 'ARCHIVED',
        },
      },
    });
  });

  it('takes the value out of every list of a list column, which never writes NULL', () => {
    const op = removeStoredValue('app', 'task', 'labels', 'x', true, undefined);

    expect(op.precheck).toEqual([]);
    expect(op.execute).toEqual([
      {
        description: 'remove value "x" from column "labels"',
        sql: 'UPDATE "app"."task" SET "labels" = array_remove("labels", $1) WHERE $1 = ANY("labels")',
        params: ['x'],
      },
    ]);
  });
});

describe('stored value calls', () => {
  const replace = new ReplaceStoredValueCall('app', 'task', 'state', 'ARCHIVED', 'RETIRED', false);
  const remove = new RemoveStoredValueCall('app', 'task', 'labels', 'x', true);

  it('are named after their facade methods and classed by their effect', () => {
    expect(replace).toMatchObject({
      factoryName: 'replaceStoredValue',
      operationClass: 'widening',
      label: 'Replace value "ARCHIVED" with "RETIRED" in column "state" of "task"',
    });
    expect(remove).toMatchObject({
      factoryName: 'removeStoredValue',
      operationClass: 'destructive',
      label: 'Remove value "x" from column "labels" of "task"',
    });
  });

  it('lower to the operations their factories build', async () => {
    expect(await replace.toOp()).toEqual(
      replaceStoredValue('app', 'task', 'state', 'ARCHIVED', 'RETIRED', false),
    );
    expect(await remove.toOp()).toEqual(
      removeStoredValue('app', 'task', 'labels', 'x', true, undefined),
    );
  });

  it('name the enum value of a removal, and mark its check with the value as the contract stores it', async () => {
    const call = new RemoveStoredValueCall(
      'app',
      'task',
      'state',
      'archived',
      false,
      { codecRef: { codecId: 'pg/text@1' }, codecs: postgresTypeLookups.codecLookup },
      { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'ARCHIVED' },
    );

    expect(call.renderTypeScript()).toBe(
      'this.removeStoredValue({ schema: "app", table: "task", column: "state", value: "archived", codecRef: { codecId: "pg/text@1" }, enumValue: { namespaceId: "app", enum: "Status", member: "ARCHIVED" } })',
    );
    expect((await call.toOp()).precheck[0]?.meta).toEqual({
      rowsHoldingValue: {
        enumValue: { namespaceId: 'app', enum: 'Status', member: 'ARCHIVED' },
        value: 'archived',
        codecRef: { codecId: 'pg/text@1' },
        table: 'task',
        column: 'state',
        storedValue: 'archived',
      },
    });
  });

  it('write a value through the column codec they carry, and render the codec', async () => {
    const codec = { codecRef: { codecId: 'pg/int8@1' }, codecs: postgresTypeLookups.codecLookup };
    const call = new ReplaceStoredValueCall('app', 'task', 'rank', '7', '8', false, codec);

    expect((await call.toOp()).execute[0]?.params).toEqual(['7', '8']);
    expect(call.renderTypeScript()).toBe(
      'this.replaceStoredValue({ schema: "app", table: "task", column: "rank", from: "7", to: "8", codecRef: { codecId: "pg/int8@1" } })',
    );
    await expect(
      new ReplaceStoredValueCall('app', 'task', 'rank', '07', '8', false, codec).toOp(),
    ).rejects.toThrow('pg/int8 JSON value must be "7"');
    const remove = new RemoveStoredValueCall('app', 'task', 'rank', '07', false, codec);
    await expect(remove.toOp()).rejects.toThrow('pg/int8 JSON value must be "7"');
  });

  it('refuse a value that is neither a string nor a number, which would match no row', () => {
    const missing = null as unknown as string;
    expect(() => new ReplaceStoredValueCall('app', 'task', 'state', missing, 'b', false)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'replaceStoredValue({ schema: "app", table: "task", column: "state" }): from must be a string or a number; got null',
        meta: { what: 'replaceStoredValue from' },
      }),
    );
    expect(() => new ReplaceStoredValueCall('app', 'task', 'state', 'a', missing, false)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }),
    );
    expect(
      () => new RemoveStoredValueCall(UNBOUND_NAMESPACE_ID, 'task', 'rank', Number.NaN, false),
    ).toThrow(
      expect.objectContaining({
        message:
          'removeStoredValue({ table: "task", column: "rank" }): value must be a string or a number; got NaN',
      }),
    );
  });

  it('render the facade call, leaving out an unbound schema and a scalar column', () => {
    expect(replace.renderTypeScript()).toBe(
      'this.replaceStoredValue({ schema: "app", table: "task", column: "state", from: "ARCHIVED", to: "RETIRED" })',
    );
    expect(remove.renderTypeScript()).toBe(
      'this.removeStoredValue({ schema: "app", table: "task", column: "labels", value: "x", many: true })',
    );
    expect(
      new RemoveStoredValueCall(UNBOUND_NAMESPACE_ID, 'task', 'rank', 3, false).renderTypeScript(),
    ).toBe('this.removeStoredValue({ table: "task", column: "rank", value: 3 })');
  });

  it('need no import, since each renders as a method of the migration', () => {
    expect(replace.importRequirements()).toEqual([]);
    expect(remove.importRequirements()).toEqual([]);
  });
});
