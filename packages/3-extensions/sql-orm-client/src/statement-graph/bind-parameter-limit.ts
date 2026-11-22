import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { collectOrderedParamRefs, type InsertAst } from '@internal/sql-relational-core/ast';
import { targetDisplayNameOf } from '@internal/sql-relational-core/plan';
import { bindParameterLimitOf } from '../collection-contract';
import { ormError } from '../orm-errors';
import type { WrittenRowOwner } from '../written-keys';

/**
 * Refuses INSERT statements that bind more parameters than the target allows in one statement.
 *
 * `construction` runs on the ASTs a graph is built from, before any statement is sent. `execution`
 * runs in `Insert.execute` on the ASTs after payload parameters (parent keys, junction keys) have
 * been added to every row, because those push the statement past a limit its construction-time
 * count was under. The `why` of each refusal matches its point: at construction nothing was sent,
 * while at execution earlier statements of the same run may already have written rows.
 */
export function requireBindParametersWithinLimit(
  contract: Contract<SqlStorage>,
  asts: readonly InsertAst[],
  owner: WrittenRowOwner,
  point: 'construction' | 'execution' = 'construction',
): void {
  const limit = bindParameterLimitOf(contract);
  if (limit === undefined) return;
  for (const ast of asts) {
    const parameters = collectOrderedParamRefs(ast).length;
    if (parameters <= limit) continue;
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `${owner.operation}() on model "${owner.modelName}" would bind ${parameters} parameters in one INSERT statement; ${targetDisplayNameOf(contract.target)} allows ${limit} per statement.`,
      {
        why:
          point === 'construction'
            ? 'The database rejects a statement past its bind-parameter limit with a driver error that reads as a broken connection, so the ORM refuses the write before sending it; nothing was written.'
            : 'The database rejects a statement past its bind-parameter limit with a driver error that reads as a broken connection, so the ORM refuses the statement before sending it; statements earlier in the same run may already have written rows, and the surrounding transaction decides whether they stay.',
        fix: `Split the rows into smaller batches so no single INSERT statement binds more than ${limit} parameters.`,
        meta: {
          problem: 'too-many-bind-parameters',
          method: `${owner.operation}()`,
          model: owner.modelName,
          parameters,
          limit,
          target: contract.target,
        },
      },
    );
  }
}
