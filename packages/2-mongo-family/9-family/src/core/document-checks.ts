import type { MongoMigrationCheck } from '@internal/mongo-query-ast/control';
import { MongoExistsExpr, RawAggregateCommand } from '@internal/mongo-query-ast/execution';

type Document = Readonly<Record<string, unknown>>;

/** The plan meta of the raw queries a migration's operations run and check with. */
export const RAW_PLAN_META = { target: 'mongo', storageHash: '', lane: 'mongo-raw' } as const;

/**
 * A check that no document of `collection` fails `validator`: an aggregate that matches the
 * documents the validator rejects.
 */
export function documentsFitValidator(
  collection: string,
  validator: Document,
): MongoMigrationCheck {
  return {
    description: `every document in ${collection} fits the new validator`,
    source: {
      collection,
      command: new RawAggregateCommand(collection, [
        { $match: { $nor: [validator] } },
        { $limit: 1 },
      ]),
      meta: { ...RAW_PLAN_META },
    },
    filter: MongoExistsExpr.exists('_id'),
    expect: 'notExists',
  };
}
