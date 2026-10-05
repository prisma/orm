/**
 * The column-default issues the node-based Postgres planner maps to `setDefault`: an `autoincrement()` default on an existing integer column, additive with no default before and widening over a literal one.
 */
import { fn } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { makeContract, planFor, rootOf } from './node-issue-planner-fixtures';

describe('node issue planner: column defaults', () => {
  describe('an autoincrement default on an existing integer column', () => {
    const contract = makeContract({
      post: {
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          serial: {
            nativeType: 'int4',
            codecId: 'pg/int4@1',
            nullable: false,
            default: { kind: 'function', expression: 'autoincrement()' },
          },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    });

    function liveSerial(serialDefault: { raw: string; value: number } | undefined) {
      return rootOf({
        post: new PostgresTableSchemaNode({
          name: 'post',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false, resolvedNativeType: 'int4' },
            serial: {
              name: 'serial',
              nativeType: 'int4',
              nullable: false,
              resolvedNativeType: 'int4',
              ...(serialDefault === undefined
                ? {}
                : {
                    default: serialDefault.raw,
                    resolvedDefault: { kind: 'literal', value: serialDefault.value },
                  }),
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          policies: [],
          rlsEnabled: false,
        }),
      });
    }

    it('sets the default, additive, when the column had none', () => {
      const calls = planFor(contract, liveSerial(undefined));

      expect(calls).toMatchObject([
        {
          factoryName: 'setDefault',
          operationClass: 'additive',
          tableName: 'post',
          column: { name: 'serial', type: 'int4', default: fn('autoincrement()') },
        },
      ]);
    });

    it('replaces a literal default, widening', () => {
      const calls = planFor(contract, liveSerial({ raw: '0', value: 0 }));

      expect(calls).toMatchObject([
        {
          factoryName: 'setDefault',
          operationClass: 'widening',
          tableName: 'post',
          column: { name: 'serial', type: 'int4', default: fn('autoincrement()') },
        },
      ]);
    });
  });
});
