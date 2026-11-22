import type { BetterAuthOptions } from '@better-auth/core';
import type { BetterAuthDBSchema } from '@better-auth/core/db';
import {
  type AdapterFactoryConfig,
  type AdapterFactoryCustomizeAdapterCreator,
  type CleanedWhere,
  type CustomAdapter,
  createAdapterFactory,
  type DBAdapter,
  type JoinConfig,
} from '@better-auth/core/db/adapter';
import { BetterAuthError } from '@better-auth/core/error';
import { blindCast } from '@prisma/orm-framework/utils/casts';
import { betterAuthModels } from './contract/expected-models';
import { assertFieldName } from './contract/identifiers';
import type { FoundModel, SqlContract } from './contract/model-lookup';
import { fieldOf, unsupportedError, whereFilter } from './filters';
import { moveJoinedRows, planJoins } from './joins';
import { createModelLookups, type ModelLookups } from './lookups';
import type { PrismaAdapterOptions } from './options';
import { callMethod, hasMethod, type OrmCollection, type Row } from './orm';

/**
 * A Prisma 8 Postgres or SQLite client, as `postgres(...)` and `sqlite(...)` return it.
 */
export interface PrismaClientLike {
  readonly contract: SqlContract;
  readonly orm: object;
  transaction<R>(fn: (tx: { readonly orm: object }) => PromiseLike<R>): Promise<R>;
}

const supportedTargets = ['postgres', 'sqlite'];

function assertClient(db: PrismaClientLike, options: PrismaAdapterOptions): void {
  const contract: SqlContract | undefined = db.contract;
  if (contract === undefined) {
    throw new BetterAuthError('prismaAdapter needs the Prisma client, not a transaction.');
  }
  if (!supportedTargets.includes(contract.target)) {
    throw new BetterAuthError(
      `@prisma/better-auth-adapter supports Postgres and SQLite. This client's database is "${contract.target}".`,
    );
  }
  const namespace = options.namespace;
  if (namespace !== undefined && !Object.hasOwn(contract.domain.namespaces, namespace)) {
    throw new BetterAuthError(`Namespace "${namespace}" is not in your Prisma contract.`);
  }
}

/** For each physical model name, the fields a read without `select` returns: `id` and every field of Better Auth's table description. */
function defaultSelections(
  schema: BetterAuthDBSchema,
  betterAuthOptions: BetterAuthOptions,
  usePlural: boolean,
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    betterAuthModels(schema, { betterAuthOptions, usePlural }).map((model) => [
      model.physicalName,
      ['id', ...model.fields.map((field) => field.name)],
    ]),
  );
}

function rowCount(result: Record<string, unknown>): number {
  const count = result['n'];
  if (typeof count !== 'number') throw new BetterAuthError('The count query returned no number.');
  return count;
}

interface Target {
  readonly model: string;
}

interface Filtered extends Target {
  readonly where: CleanedWhere[];
}

interface Read extends Filtered {
  readonly select?: string[] | undefined;
  readonly join?: JoinConfig | undefined;
}

/** The calls of Better Auth's `CustomAdapter`, with the rows they return typed as rows. */
interface RowAdapter {
  create(call: Target & { readonly data: Row }): Promise<Row>;
  findOne(call: Read): Promise<Row | null>;
  findMany(
    call: Omit<Read, 'where'> & {
      readonly where?: CleanedWhere[] | undefined;
      readonly limit: number;
      readonly sortBy?: { readonly field: string; readonly direction: 'asc' | 'desc' } | undefined;
      readonly offset?: number | undefined;
    },
  ): Promise<Row[]>;
  count(call: Target & { readonly where?: CleanedWhere[] | undefined }): Promise<number>;
  update(call: Filtered & { readonly update: Row }): Promise<Row | null>;
  updateMany(call: Filtered & { readonly update: Row }): Promise<number>;
  delete(call: Filtered): Promise<void>;
  deleteMany(call: Filtered): Promise<number>;
}

function asCustomAdapter(adapter: RowAdapter): CustomAdapter {
  return blindCast<
    CustomAdapter,
    "CustomAdapter's methods are generic in the row type the caller expects, which no adapter can know; the rows returned are the model's columns, which is what Better Auth reads"
  >(adapter);
}

/** The calls Better Auth's factory makes, over one ORM client root: the client's or a transaction's. */
function customAdapter(
  orm: object,
  lookups: ModelLookups,
  usePlural: boolean,
): AdapterFactoryCustomizeAdapterCreator {
  return ({ schema, options, getFieldName, debugLog }) => {
    const selections = defaultSelections(schema, options, usePlural);
    const target = (model: string): { found: FoundModel; collection: OrmCollection } => {
      const found = lookups.model(model);
      return { found, collection: lookups.collection(orm, found) };
    };

    const selected = (model: string, select: readonly string[] | undefined): readonly string[] => {
      const fields =
        select !== undefined && select.length > 0
          ? select.map((field) => getFieldName({ model, field }))
          : (selections.get(model) ?? ['id']);
      for (const field of fields) assertFieldName(model, field);
      return fields;
    };

    const adapter: RowAdapter = {
      async create({ model, data }) {
        const { collection } = target(model);
        return collection.create(data);
      },
      async findOne({ model, where, select, join }) {
        const { found, collection } = target(model);
        const filtered = collection
          .where(whereFilter(found, where))
          .select(...selected(model, select));
        const joins = planJoins(filtered, found, join, lookups, debugLog);
        const row = await joins.collection.first();
        return row === null ? null : moveJoinedRows(row, joins.included);
      },
      async findMany({ model, where, limit, select, sortBy, offset, join }) {
        const { found, collection } = target(model);
        let query = collection.where(whereFilter(found, where)).select(...selected(model, select));
        if (sortBy !== undefined) {
          const field = getFieldName({ model, field: sortBy.field });
          query = query.orderBy((accessor) => {
            const sorted = fieldOf(accessor, found, field);
            if (!hasMethod(sorted, sortBy.direction)) {
              throw unsupportedError(found, field, 'sorting');
            }
            return callMethod(sorted, sortBy.direction);
          });
        }
        query = query.limit(limit);
        if (offset !== undefined) query = query.offset(offset);
        const joins = planJoins(query, found, join, lookups, debugLog);
        const rows: Row[] = await joins.collection.all();
        return rows.map((row) => moveJoinedRows(row, joins.included));
      },
      async count({ model, where }) {
        const { found, collection } = target(model);
        return rowCount(
          await collection
            .where(whereFilter(found, where))
            .aggregate((aggregates) => ({ n: aggregates.count() })),
        );
      },
      async update({ model, where, update }) {
        const { found, collection } = target(model);
        return collection.where(whereFilter(found, where)).update(update);
      },
      async updateMany({ model, where, update }) {
        const { found, collection } = target(model);
        return collection.where(whereFilter(found, where)).updateAndCount(update);
      },
      async delete({ model, where }) {
        const { found, collection } = target(model);
        await collection.where(whereFilter(found, where)).deleteAndCount();
      },
      async deleteMany({ model, where }) {
        const { found, collection } = target(model);
        return collection.where(whereFilter(found, where)).deleteAndCount();
      },
    };
    return asCustomAdapter(adapter);
  };
}

function factoryConfig(
  options: PrismaAdapterOptions,
  transaction: AdapterFactoryConfig['transaction'],
): AdapterFactoryConfig {
  return {
    adapterId: 'prisma-8',
    adapterName: 'Prisma 8',
    usePlural: options.usePlural ?? false,
    debugLogs: options.debugLogs ?? false,
    supportsDates: true,
    supportsBooleans: true,
    supportsNumericIds: true,
    supportsJSON: false,
    supportsArrays: false,
    supportsUUIDs: false,
    transaction,
  };
}

/**
 * A Better Auth database adapter over a Prisma 8 Postgres or SQLite client.
 *
 * @example
 * ```ts
 * export const auth = betterAuth({ database: prismaAdapter(db) });
 * ```
 */
export function prismaAdapter(
  db: PrismaClientLike,
  options: PrismaAdapterOptions = {},
): (betterAuthOptions: BetterAuthOptions) => DBAdapter<BetterAuthOptions> {
  assertClient(db, options);
  return (betterAuthOptions) => {
    const lookups = createModelLookups(db.contract, options.namespace);
    const transaction: AdapterFactoryConfig['transaction'] =
      options.transaction === true
        ? (callback) =>
            db.transaction((tx) =>
              callback(
                createAdapterFactory({
                  config: factoryConfig(options, false),
                  adapter: customAdapter(tx.orm, lookups, options.usePlural ?? false),
                })(betterAuthOptions),
              ),
            )
        : false;
    return createAdapterFactory({
      config: factoryConfig(options, transaction),
      adapter: customAdapter(db.orm, lookups, options.usePlural ?? false),
    })(betterAuthOptions);
  };
}
