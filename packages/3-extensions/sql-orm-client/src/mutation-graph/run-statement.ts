import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { StorageRow } from './edge';
import type { Executed, Run, StatementAst } from './node';

export function executeStatement(ast: StatementAst, run: Run): Executed {
  return ast.kind === 'select' || ast.returning !== undefined ? run.query(ast) : run.execute(ast);
}

export function rowsResult(rows: readonly StorageRow[]): AsyncIterableResult<StorageRow> {
  const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
    yield* rows;
  };
  return new AsyncIterableResult(generator());
}
