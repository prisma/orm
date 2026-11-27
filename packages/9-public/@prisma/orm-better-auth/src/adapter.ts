import type { BetterAuthOptions } from '@better-auth/core';
import { type BetterAuthDBSchema, getAuthTables } from '@better-auth/core/db';
import {
  type AdapterFactoryConfig,
  type AdapterFactoryCustomizeAdapterCreator,
  type CleanedWhere,
  type CustomAdapter,
  createAdapterFactory,
  type DBAdapter,
  type DBAdapterSchemaCreation,
  type JoinConfig,
} from '@better-auth/core/db/adapter';
import { BetterAuthError } from '@better-auth/core/error';
import { blindCast } from '@prisma/orm-framework/utils/casts';
import { createModelCollections, type ModelCollections } from './collections';
import { compareContract } from './contract/compare';
import {
  contractMismatchError,
  createContractCheck,
  registerContractCheck,
} from './contract/contract-check';
import { fieldOf, unsupportedError, whereFilter } from './filters';
import { moveJoinedRows, planJoins } from './joins';
import { betterAuthModels, caseOnlyNameCollisions } from './models/better-auth-models';
import { assertFieldName, caseOnlyNameCollisionMessage } from './models/identifiers';
import type { FoundModel, SqlContract } from './models/model-lookup';
import type { PrismaAdapterOptions } from './options';
import { callMethod, hasMethod, type OrmCollection, type Row } from './orm';

/**
 * A Prisma 8 Postgres or SQLite client, as `postgres(...)` and `sqlite(...)` return it.
 */
export interface PrismaClientLike {
  readonly contract: SqlContract;
  readonly orm: object;
}

/** A client that runs interactive transactions, which the `transaction` option needs. */
export interface TransactionalPrismaClientLike extends PrismaClientLike {
  transaction<R>(fn: (tx: { readonly orm: object }) => PromiseLike<R>): Promise<R>;
}

/** The client `prismaAdapter` takes: one with `transaction()` when `transaction` may be on. */
export type PrismaClientLikeFor<Options extends PrismaAdapterOptions> =
  'transaction' extends keyof Options
    ? true extends Options['transaction' & keyof Options]
      ? TransactionalPrismaClientLike
      : PrismaClientLike
    : PrismaClientLike;

function hasTransaction(db: PrismaClientLike): db is TransactionalPrismaClientLike {
  return 'transaction' in db && typeof db.transaction === 'function';
}

function listsInteractiveTransactions(contract: SqlContract): boolean {
  return contract.capabilities['sql']?.['interactiveTransactions'] === true;
}

const supportedTargets = ['postgres', 'sqlite'];

function assertClient(db: PrismaClientLike, adapterOptions: PrismaAdapterOptions): void {
  const contract: SqlContract | undefined = db.contract;
  if (contract === undefined) {
    throw new BetterAuthError('prismaAdapter needs the Prisma client, not a transaction.');
  }
  if (!supportedTargets.includes(contract.target)) {
    throw new BetterAuthError(
      `@prisma/orm-better-auth supports Postgres and SQLite. This client's database is "${contract.target}".`,
    );
  }
  const namespace = adapterOptions.namespace;
  if (namespace !== undefined && !Object.hasOwn(contract.domain.namespaces, namespace)) {
    throw new BetterAuthError(`Namespace "${namespace}" is not in your Prisma contract.`);
  }
  if (adapterOptions.transaction !== true) return;
  if (!hasTransaction(db)) {
    throw new BetterAuthError(
      'The transaction option runs Better Auth transactions through the client’s transaction(), which this object does not have. Pass the Prisma client, or turn the option off.',
    );
  }
  if (!listsInteractiveTransactions(contract)) {
    throw new BetterAuthError(
      'The transaction option is unavailable: your contract declares no dependency on `sql.interactiveTransactions`. It runs Better Auth transactions through the client’s `transaction()`; without it, turn the option off. To enable it, add `sql.interactiveTransactions` to your contract’s required capabilities.',
    );
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

interface ModelCall {
  /** The physical model name, which finds the contract model. */
  readonly model: string;
  /** Better Auth's key for the model in its table description, which maps field names. */
  readonly modelKey?: string | undefined;
}

interface FilteredCall extends ModelCall {
  readonly where: CleanedWhere[];
}

interface ReadCall extends FilteredCall {
  readonly select?: string[] | undefined;
  readonly join?: JoinConfig | undefined;
}

/** The calls of Better Auth's `CustomAdapter`, with the rows they return typed as rows. */
interface RowAdapter {
  create(call: ModelCall & { readonly data: Row }): Promise<Row>;
  findOne(call: ReadCall): Promise<Row | null>;
  findMany(
    call: Omit<ReadCall, 'where'> & {
      readonly where?: CleanedWhere[] | undefined;
      readonly limit: number;
      readonly sortBy?: { readonly field: string; readonly direction: 'asc' | 'desc' } | undefined;
      readonly offset?: number | undefined;
    },
  ): Promise<Row[]>;
  count(call: ModelCall & { readonly where?: CleanedWhere[] | undefined }): Promise<number>;
  update(call: FilteredCall & { readonly update: Row }): Promise<Row | null>;
  updateMany(call: FilteredCall & { readonly update: Row }): Promise<number>;
  delete(call: FilteredCall): Promise<void>;
  deleteMany(call: FilteredCall): Promise<number>;
  createSchema(call: {
    readonly file?: string | undefined;
    readonly tables: BetterAuthDBSchema;
  }): Promise<DBAdapterSchemaCreation>;
}

/** What one adapter instance computes once and shares with the adapters it builds for transactions. */
interface InstanceState {
  readonly collections: ModelCollections;
  /** For each physical model name, the fields a read without `select` returns; computed on the first such read. */
  defaultSelections: ReadonlyMap<string, readonly string[]> | undefined;
  /** The error every call raises when Better Auth's model names collide, `null` when they do not; computed on the first call. */
  nameCollision: Error | null | undefined;
}

interface AdapterContext {
  readonly orm: object;
  readonly contract: SqlContract;
  readonly instance: InstanceState;
  readonly adapterOptions: PrismaAdapterOptions;
}

function asCustomAdapter(adapter: RowAdapter): CustomAdapter {
  return blindCast<
    CustomAdapter,
    "CustomAdapter's methods are generic in the row type the caller expects, which no adapter can know; the rows returned are the model's columns, which is what Better Auth reads"
  >(adapter);
}

/** The calls Better Auth's factory makes, over one ORM client root: the client's or a transaction's. */
function customAdapter({
  orm,
  contract,
  instance,
  adapterOptions,
}: AdapterContext): AdapterFactoryCustomizeAdapterCreator {
  const usePlural = adapterOptions.usePlural ?? false;
  const { collections } = instance;
  return ({ schema, options: betterAuthOptions, getFieldName, debugLog }) => {
    const resolve = (model: string): { found: FoundModel; collection: OrmCollection } => {
      if (instance.nameCollision === undefined) {
        const [collision] = caseOnlyNameCollisions(
          betterAuthModels(schema, { betterAuthOptions, usePlural }),
        );
        instance.nameCollision =
          collision === undefined
            ? null
            : contractMismatchError(caseOnlyNameCollisionMessage(collision));
      }
      if (instance.nameCollision !== null) throw instance.nameCollision;
      const found = collections.model(model);
      return { found, collection: collections.collection(orm, found) };
    };

    const assertFieldNames = (model: string, fields: Iterable<string>): void => {
      for (const field of fields) assertFieldName(model, field);
    };

    const filterFor = (
      model: string,
      found: FoundModel,
      where: readonly CleanedWhere[] | undefined,
    ) => {
      assertFieldNames(
        model,
        (where ?? []).map((clause) => clause.field),
      );
      return whereFilter(found, where);
    };

    const selectionOf = (model: string): readonly string[] => {
      instance.defaultSelections ??= defaultSelections(schema, betterAuthOptions, usePlural);
      const fields = instance.defaultSelections.get(model);
      if (fields === undefined) {
        throw new BetterAuthError(`Better Auth's table description has no model "${model}".`);
      }
      return fields;
    };

    const selected = (
      { model, modelKey = model }: ModelCall,
      select: readonly string[] | undefined,
    ): readonly string[] => {
      const fields =
        select !== undefined && select.length > 0
          ? select.map((field) => getFieldName({ model: modelKey, field }))
          : selectionOf(model);
      assertFieldNames(model, fields);
      return fields;
    };

    const adapter: RowAdapter = {
      async create({ model, data }) {
        assertFieldNames(model, Object.keys(data));
        const { collection } = resolve(model);
        return collection.create(data);
      },
      async findOne({ model, modelKey, where, select, join }) {
        const { found, collection } = resolve(model);
        const filtered = collection
          .where(filterFor(model, found, where))
          .select(...selected({ model, modelKey }, select));
        const joins = planJoins(filtered, found, join, collections, debugLog);
        const row = await joins.collection.first();
        return row === null ? null : moveJoinedRows(row, joins.included);
      },
      async findMany({ model, modelKey, where, limit, select, sortBy, offset, join }) {
        const { found, collection } = resolve(model);
        let query = collection
          .where(filterFor(model, found, where))
          .select(...selected({ model, modelKey }, select));
        if (sortBy !== undefined) {
          const field = getFieldName({ model: modelKey ?? model, field: sortBy.field });
          assertFieldNames(model, [field]);
          const direction: unknown = sortBy.direction;
          if (direction !== 'asc' && direction !== 'desc') {
            throw new BetterAuthError(`Sort direction "${String(direction)}" is not supported.`);
          }
          query = query.orderBy((accessor) => {
            const sorted = fieldOf(accessor, field);
            if (!hasMethod(sorted, direction)) throw unsupportedError(found, field, 'sorting');
            return callMethod(sorted, direction);
          });
        }
        query = query.limit(limit);
        if (offset !== undefined) query = query.offset(offset);
        const joins = planJoins(query, found, join, collections, debugLog);
        const rows: Row[] = await joins.collection.all();
        return rows.map((row) => moveJoinedRows(row, joins.included));
      },
      async count({ model, where }) {
        const { found, collection } = resolve(model);
        return rowCount(
          await collection
            .where(filterFor(model, found, where))
            .aggregate((aggregates) => ({ n: aggregates.count() })),
        );
      },
      async update({ model, where, update }) {
        assertFieldNames(model, Object.keys(update));
        const { found, collection } = resolve(model);
        return collection.where(filterFor(model, found, where)).update(update);
      },
      async updateMany({ model, where, update }) {
        assertFieldNames(model, Object.keys(update));
        const { found, collection } = resolve(model);
        return collection.where(filterFor(model, found, where)).updateAndCount(update);
      },
      async delete({ model, where }) {
        const { found, collection } = resolve(model);
        await collection.where(filterFor(model, found, where)).deleteAndCount();
      },
      async deleteMany({ model, where }) {
        const { found, collection } = resolve(model);
        return collection.where(filterFor(model, found, where)).deleteAndCount();
      },
      async createSchema({ file, tables }) {
        const comparison = compareContract({
          contract,
          tables,
          betterAuthOptions,
          namespace: adapterOptions.namespace,
          usePlural,
        });
        if (comparison.problems.length === 0) {
          return { code: '', path: file ?? 'prisma/contract.prisma' };
        }
        const { editedContractSource } = await import('./generate/edited-contract-source');
        return editedContractSource(file, comparison);
      },
    };
    return asCustomAdapter(adapter);
  };
}

function factoryConfig(
  adapterOptions: PrismaAdapterOptions,
  transaction: AdapterFactoryConfig['transaction'],
): AdapterFactoryConfig {
  return {
    adapterId: 'prisma-8',
    adapterName: 'Prisma 8',
    usePlural: adapterOptions.usePlural ?? false,
    debugLogs: adapterOptions.debugLogs ?? false,
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
export function prismaAdapter<const Options extends PrismaAdapterOptions = Record<never, never>>(
  db: PrismaClientLikeFor<Options>,
  adapterOptions?: Options,
): (betterAuthOptions: BetterAuthOptions) => DBAdapter<BetterAuthOptions>;
export function prismaAdapter(
  db: PrismaClientLike,
  adapterOptions: PrismaAdapterOptions = {},
): (betterAuthOptions: BetterAuthOptions) => DBAdapter<BetterAuthOptions> {
  assertClient(db, adapterOptions);
  return (betterAuthOptions) => {
    const context: AdapterContext = {
      orm: db.orm,
      contract: db.contract,
      instance: {
        collections: createModelCollections(db.contract, adapterOptions.namespace),
        defaultSelections: undefined,
        nameCollision: undefined,
      },
      adapterOptions,
    };
    const transaction: AdapterFactoryConfig['transaction'] =
      adapterOptions.transaction === true && hasTransaction(db)
        ? (callback) =>
            db.transaction((tx) =>
              callback(
                createAdapterFactory({
                  config: factoryConfig(adapterOptions, false),
                  adapter: customAdapter({ ...context, orm: tx.orm }),
                })(betterAuthOptions),
              ),
            )
        : false;
    const adapter = createAdapterFactory({
      config: factoryConfig(adapterOptions, transaction),
      adapter: customAdapter(context),
    })(betterAuthOptions);
    registerContractCheck(
      adapter,
      createContractCheck(() => ({
        contract: db.contract,
        tables: getAuthTables(betterAuthOptions),
        betterAuthOptions,
        namespace: adapterOptions.namespace,
        usePlural: adapterOptions.usePlural ?? false,
      })),
      betterAuthOptions,
    );
    return adapter;
  };
}
