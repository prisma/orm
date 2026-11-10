import { describe, expect, it } from 'vitest';
import type { AppliedStatementReport } from '../../src/control-api/statements/report-applied-statements';
import { appliedStatementBlocks } from '../../src/orm/statement-blocks';

const field = { model: 'User', field: 'age' };

function applied(
  verb: 'convert' | 'backfill',
  operationIndexes: readonly number[],
): AppliedStatementReport {
  return {
    verb,
    statement: { kind: verb, entity: 'field', field },
    operationIndexes,
    description: `${verb} field "User.age"`,
  };
}

describe('appliedStatementBlocks', () => {
  it('says a convert or backfill with no operations yet wrote its slot into migration.ts', () => {
    expect(
      appliedStatementBlocks([
        applied('convert', []),
        applied('backfill', []),
        applied('convert', [0]),
      ]),
    ).toEqual([
      {
        kind: 'tree',
        roots: [
          {
            label: 'Statements applied',
            children: [
              { label: 'convert field "User.age" (conversion slot written in migration.ts)' },
              { label: 'backfill field "User.age" (backfill slots written in migration.ts)' },
              { label: 'convert field "User.age" (1 operation)' },
            ],
          },
        ],
      },
    ]);
  });
});
