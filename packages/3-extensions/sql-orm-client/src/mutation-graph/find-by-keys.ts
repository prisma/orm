import { AsyncIterableResult } from '@internal/framework-components/runtime';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ListExpression,
  OrExpr,
  ParamRef,
  type ProjectionItem,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { ormError } from '../orm-errors';
import { combineWhereExprs } from '../where-utils';
import type { StorageRow } from './edge';
import { withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run } from './node';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';
import { StatementNode } from './statement-node';

type Keyed = { keys: Rows };

/** What a read-back that must find every row reports when it does not. */
export interface MissingRow {
  readonly operation: string;
  readonly modelName: string;
}

/**
 * Reads rows back by key, for a database without `RETURNING`. A single key column is matched with an `IN` list. `overrides` replaces key values the write changed. With `missing`, a key whose row is not found fails the read, so the transaction rolls back.
 */
export class FindByKeys extends StatementNode<Keyed> {
  readonly ast: SelectAst;
  readonly keyColumns: readonly ProjectionItem[];
  readonly overrides: Readonly<StorageRow>;
  readonly missing: MissingRow | undefined;

  constructor(
    ast: SelectAst,
    keyColumns: readonly ProjectionItem[],
    overrides: Readonly<StorageRow>,
    missing: MissingRow | undefined,
  ) {
    super();
    this.ast = ast;
    this.keyColumns = Object.freeze([...keyColumns]);
    this.overrides = overrides;
    this.missing = missing;
    Object.freeze(this);
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.projection;
  }

  override execute(inputs: OutputsOf<Keyed>, run: Run): Executed {
    const keys = inputs.keys.map((row) => ({ ...row, ...this.overrides }));
    if (keys.length === 0) {
      return rowsResult([]);
    }
    const existing = this.ast.where === undefined ? [] : [this.ast.where];
    const ast = this.ast.withWhere(combineWhereExprs([...existing, this.#matching(keys)]));
    const { missing } = this;
    if (missing === undefined) {
      return run.query(ast);
    }
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      const found = await run.query(ast).toArray();
      if (found.length < keys.length) {
        throw ormError(
          'ORM.MUTATION_ROW_MISSING',
          `${missing.operation} for model "${missing.modelName}" did not find the row it wrote`,
          { meta: { operation: missing.operation, model: missing.modelName, phase: 'read-back' } },
        );
      }
      yield* found;
    };
    return new AsyncIterableResult(generator());
  }

  #matching(keys: readonly StorageRow[]): AnyExpression {
    const [only, ...others] = this.keyColumns;
    if (only !== undefined && others.length === 0) {
      return BinaryExpr.in(only.expr, ListExpression.of(keys.map((key) => paramOf(only, key))));
    }
    return OrExpr.of(
      keys.map((key) =>
        AndExpr.of(
          this.keyColumns.map((column) => BinaryExpr.eq(column.expr, paramOf(column, key))),
        ),
      ),
    );
  }

  override withReturning(columns: readonly ProjectionItem[]): FindByKeys {
    return new FindByKeys(
      this.ast.withProjection(withColumns(this.returns, columns)),
      this.keyColumns,
      this.overrides,
      this.missing,
    );
  }
}

function paramOf(column: ProjectionItem, key: StorageRow): ParamRef {
  return ParamRef.of(key[column.alias], {
    name: column.alias,
    ...ifDefined('codec', column.codec),
  });
}
