/**
 * The postchecks of the add-column calls: the column type, read through the stack's data types or, for a type they do not read, by its oid; and NOT NULL where the column declares it.
 */
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { col } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { columnNullabilityAst, columnTypeOidAst } from '../../src/contract-free/checks';
import { postgresDataTypes } from '../../src/core/data-types';
import { AddColumnCall } from '../../src/core/migrations/op-factory-call';

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

describe('AddColumnCall postchecks', () => {
  it('checks a NOT NULL column is NOT NULL, and a type no data type reads by its oid', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await new AddColumnCall(
      'public',
      'user',
      col('position', 'geometry', { notNull: true }),
      postgresDataTypes,
    ).toOp(lowerer);

    expect({
      received: received.slice(3),
      postcheck: op.postcheck.map((step) => step.description),
    }).toEqual({
      received: [
        columnTypeOidAst({
          schema: 'public',
          table: 'user',
          column: 'position',
          type: 'geometry',
          many: false,
        }),
        columnNullabilityAst({
          schema: 'public',
          table: 'user',
          column: 'position',
          nullable: false,
        }),
      ],
      postcheck: [
        'verify column "position" exists',
        'verify column "position" has type "geometry"',
        'verify column "position" is NOT NULL',
      ],
    });
  });
});
