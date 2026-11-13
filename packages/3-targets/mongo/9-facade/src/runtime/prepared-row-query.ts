import type { RuntimeExecuteOptions } from '@internal/framework-components/runtime';
import type { MongoCodecTypesBase } from '@internal/mongo-contract';
import type { MongoPreparable, MongoQueryExecutor, MongoQueryPlan } from '@internal/mongo-orm';
import type {
  MongoDeclaration,
  MongoParamsFromDeclaration,
  MongoPlaceholders,
  MongoPreparedFor,
  MongoPreparedStatement,
  MongoRuntime,
} from '@internal/mongo-runtime';
import { blindCast } from '@internal/utils/casts';

/** A prepared ORM read. Each run returns the read's result: a row stream for `all()`, a promise for `first()` and `firstOrThrow()`. */
export interface MongoPreparedRowQuery<Params, Result> {
  query(target: MongoQueryExecutor, params: Params, options?: RuntimeExecuteOptions): Result;
}

/** The handle `db.prepare` returns: an ORM read prepares into a `MongoPreparedRowQuery`, a plan into the handle its command picks. */
export type MongoPreparedFrom<Params, Q> =
  Q extends MongoPreparable<unknown, infer Result>
    ? MongoPreparedRowQuery<Params, Result>
    : Q extends MongoQueryPlan<infer Row, infer Command>
      ? MongoPreparedFor<Params, Row, Command>
      : never;

export async function prepareMongoQuery<
  D extends MongoDeclaration<CT>,
  Q extends MongoQueryPlan | MongoPreparable<unknown, unknown>,
  CT extends MongoCodecTypesBase,
>(
  runtime: Pick<MongoRuntime, 'prepare'>,
  declaration: D,
  callback: (placeholders: MongoPlaceholders<D>) => Q,
): Promise<MongoPreparedFrom<MongoParamsFromDeclaration<D, CT>, Q>> {
  let description: MongoPreparable<unknown, unknown> | undefined;
  const statement = await runtime.prepare(declaration, (placeholders) => {
    const authored: MongoQueryPlan | MongoPreparable<unknown, unknown> = callback(placeholders);
    if ('plan' in authored) {
      description = authored;
      return authored.plan;
    }
    return authored;
  });
  const prepared = description ? createMongoPreparedRowQuery(description, statement) : statement;
  return blindCast<
    MongoPreparedFrom<MongoParamsFromDeclaration<D, CT>, Q>,
    'an ORM read gets its consumer; a plan keeps the handle its command picks'
  >(prepared);
}

export function createMongoPreparedRowQuery<Params, Row, Result>(
  description: MongoPreparable<Row, Result>,
  statement: MongoPreparedStatement<Params, Row>,
): MongoPreparedRowQuery<Params, Result> {
  return Object.freeze({
    query(target: MongoQueryExecutor, params: Params, options?: RuntimeExecuteOptions): Result {
      return description.consume(statement.query(target, params, options));
    },
  });
}
