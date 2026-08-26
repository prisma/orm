import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type {
  Db,
  QueryContext,
  Scope,
  ScopeField,
  SelectQuery,
} from '@prisma-next/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE,
  orm as ormBuilder,
} from '@prisma-next/sql-orm-client';
import { RawSqlExpr, type SelectAst, TableSource } from '@prisma-next/sql-relational-core/ast';
import type { CodecTypesBase, RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import { planFromAst, type SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  BindSiteParams,
  ConnectionContext,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  PreparedStatement,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeAdapterInstance,
  SqlRuntimeExtensionDescriptor,
  TransactionContext,
  VerifyMarkerOption,
} from '@prisma-next/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  withConnection,
  withTransaction,
} from '@prisma-next/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { type Client, Pool } from 'pg';
import {
  type PostgresBinding,
  type PostgresBindingInput,
  resolveOptionalPostgresBinding,
  resolvePostgresBinding,
} from './binding';
import { PostgresRuntimeImpl } from './postgres-runtime';

export type PostgresTargetId = 'postgres';
type OrmClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof ormBuilder<TContract>>;

export interface TempTableColumnDef {
  readonly name: string;
  readonly type: string;
}

type TempTableJoinSource<Row extends Record<string, ScopeField>> = ReturnType<
  SelectQuery<QueryContext, Scope, Row>['as']
>;

type TempTableQuerySource<Row extends Record<string, ScopeField>> = {
  buildAst(): SelectAst;
  getRowFields(): Row;
};

type TempTableSubqueryConvertible<Row extends Record<string, ScopeField>> = {
  [INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE](): TempTableQuerySource<Row>;
};

type TempTableAsInput<Row extends Record<string, ScopeField>> =
  | TempTableQuerySource<Row>
  | TempTableSubqueryConvertible<Row>;

export type TempTableHandle<Row extends Record<string, ScopeField> = Record<string, ScopeField>> =
  TempTableJoinSource<Row> & {
    readonly name: string;
    readonly fields: Row;
    append(input: TempTableAppendInput<Row>): Promise<void>;
    drop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
  };

export type TempTableAppendInput<
  Row extends Record<string, ScopeField> = Record<string, ScopeField>,
> = TempTableAsInput<Row> | readonly (readonly (string | number | boolean | null)[])[];

export interface TempTableBuilder {
  as<Row extends Record<string, ScopeField>>(
    query: TempTableAsInput<Row>,
  ): Promise<TempTableHandle<Row>>;
  from(columns: readonly TempTableColumnDef[]): Promise<TempTableHandle>;
}

export interface PostgresTransactionContext<TContract extends Contract<SqlStorage>>
  extends TransactionContext {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
  readonly enums: NamespacedEnums<TContract>;
  tempTable(): TempTableBuilder;
}

export interface PostgresConnectionContext<TContract extends Contract<SqlStorage>>
  extends ConnectionContext {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
  readonly enums: NamespacedEnums<TContract>;
  tempTable(): TempTableBuilder;
}

export interface PostgresClient<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
  readonly enums: NamespacedEnums<TContract>;
  readonly raw: RawSqlTag;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  connect(bindingInput?: PostgresBindingInput): Promise<Runtime>;
  runtime(): Runtime;
  transaction<R>(fn: (tx: PostgresTransactionContext<TContract>) => PromiseLike<R>): Promise<R>;
  connection<R>(fn: (conn: PostgresConnectionContext<TContract>) => PromiseLike<R>): Promise<R>;
  prepare<
    D extends Declaration<CT>,
    Row,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract> & CodecTypesBase,
  >(
    declaration: D,
    callback: (sql: Db<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
  ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface PostgresOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
  readonly poolOptions?: {
    readonly connectionTimeoutMillis?: number;
    readonly idleTimeoutMillis?: number;
  };
}

export interface PostgresBindingOptions {
  readonly binding?: PostgresBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
}

export type PostgresOptionsWithContract<TContract extends Contract<SqlStorage>> =
  PostgresBindingOptions &
    PostgresOptionsBase & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type PostgresOptionsWithContractJson<TContract extends Contract<SqlStorage>> =
  PostgresBindingOptions &
    PostgresOptionsBase & {
      readonly contractJson: unknown;
      readonly contract?: never;
      readonly _contract?: TContract;
    };

export type PostgresOptions<TContract extends Contract<SqlStorage>> =
  | PostgresOptionsWithContract<TContract>
  | PostgresOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): options is PostgresOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

const contractSerializer = new PostgresContractSerializer();

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): TContract {
  const contractInput = hasContractJson(options) ? options.contractJson : options.contract;
  return contractSerializer.deserializeContract(contractInput) as TContract;
}

function toRuntimeBinding<TContract extends Contract<SqlStorage>>(
  binding: PostgresBinding,
  options: PostgresOptions<TContract>,
) {
  if (binding.kind !== 'url') {
    return binding;
  }

  return {
    kind: 'pgPool',
    pool: new Pool({
      connectionString: binding.url,
      connectionTimeoutMillis: options.poolOptions?.connectionTimeoutMillis ?? 20_000,
      idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
    }),
  } as const;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function toSqlLiteral(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot use non-finite number as SQL literal: ${value}`);
    }
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function resolveTempTableName(): string {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  return `pn_temp_${suffix}`;
}

function createTempTableBuilder(
  execCtx: Pick<TransactionContext, 'execute'>,
  registerCleanupHook: (hook: () => Promise<void>) => void,
  contract: Contract<SqlStorage>,
  adapter: SqlRuntimeAdapterInstance<PostgresTargetId>,
  onCommitDrop = true,
): TempTableBuilder {
  const normalizeQuerySource = <Row extends Record<string, ScopeField>>(
    query: TempTableAsInput<Row>,
  ): TempTableQuerySource<Row> => {
    if ('buildAst' in query && 'getRowFields' in query) {
      return query;
    }
    return query[INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE]();
  };

  const asJoinSource = <Row extends Record<string, ScopeField>>(
    tableName: string,
    alias: string,
    rowFields: Row,
  ): TempTableJoinSource<Row> => {
    const source = {
      getJoinOuterScope: () => ({
        topLevel: rowFields,
        namespaces: { [alias]: rowFields } as Record<string, Row>,
      }),
      buildAst: () => TableSource.named(tableName, alias),
    };
    return blindCast<TempTableJoinSource<Row>, 'source implements TempTableJoinSource duck-type'>(
      source,
    );
  };

  const createAppend =
    (quotedName: string) =>
    async (input: TempTableAppendInput<Record<string, ScopeField>>): Promise<void> => {
      if (Array.isArray(input)) {
        const rows = blindCast<
          readonly (readonly (string | number | boolean | null)[])[],
          'Array.isArray true — input is a raw rows array'
        >(input);
        if (rows.length === 0) return;
        const valueRows = rows.map((row) => `(${row.map(toSqlLiteral).join(', ')})`).join(', ');
        const insertSql = `INSERT INTO ${quotedName} VALUES ${valueRows}`;
        const insertAst = RawSqlExpr.of([insertSql], []);
        const insertQueryPlan = planFromAst(insertAst, contract, 'raw.temp-table');
        await execCtx
          .execute(
            Object.freeze({
              sql: insertAst.fragments[0] ?? '',
              params: [] as unknown[],
              ast: insertAst,
              meta: insertQueryPlan.meta,
            }),
          )
          .toArray();
      } else {
        const source = normalizeQuerySource(
          blindCast<
            TempTableAsInput<Record<string, ScopeField>>,
            'Array.isArray false — input is a query source'
          >(input),
        );
        const queryPlan = planFromAst(source.buildAst(), contract, 'dsl');
        const lowered = adapter.lower(queryPlan.ast, { contract, params: queryPlan.params });
        const params = lowered.params.map((slot) => {
          if (slot.kind === 'literal') return slot.value;
          throw new Error('tempTable.append(...) does not accept bind-site parameters.');
        });
        const insertSql = `INSERT INTO ${quotedName} ${lowered.sql}`;
        const insertAst = RawSqlExpr.of([insertSql], []);
        const insertQueryPlan = planFromAst(insertAst, contract, 'raw.temp-table');
        await execCtx
          .execute(
            Object.freeze({
              sql: insertAst.fragments[0] ?? '',
              params,
              ast: insertAst,
              meta: insertQueryPlan.meta,
            }),
          )
          .toArray();
      }
    };

  return {
    async as<Row extends Record<string, ScopeField>>(
      query: TempTableAsInput<Row>,
    ): Promise<TempTableHandle<Row>> {
      const source = normalizeQuerySource(query);
      const tableName = resolveTempTableName();
      const quotedTableName = quoteIdentifier(tableName);
      const queryPlan = planFromAst(source.buildAst(), contract, 'dsl');
      const lowered = adapter.lower(queryPlan.ast, {
        contract,
        params: queryPlan.params,
      });
      const params = lowered.params.map((slot) => {
        if (slot.kind === 'literal') return slot.value;
        throw new Error('tempTable.as(...) does not accept bind-site parameters.');
      });

      const createAst = RawSqlExpr.of(
        [
          `CREATE TEMP TABLE ${quotedTableName}${onCommitDrop ? ' ON COMMIT DROP' : ''} AS ${lowered.sql}`,
        ],
        [],
      );
      const createQueryPlan = planFromAst(createAst, contract, 'raw.temp-table');
      const createPlan = Object.freeze({
        sql: createAst.fragments[0] ?? '',
        params,
        ast: createAst,
        meta: createQueryPlan.meta,
      });
      await execCtx.execute(createPlan).toArray();

      const dropPlan = Object.freeze({
        sql: `DROP TABLE IF EXISTS ${quotedTableName}`,
        params: [],
        ast: queryPlan.ast,
        meta: queryPlan.meta,
      });
      let dropped = false;
      const drop = async (): Promise<void> => {
        if (dropped) return;
        dropped = true;
        await execCtx.execute(dropPlan).toArray();
      };
      if (!onCommitDrop) {
        registerCleanupHook(drop);
      }

      const rowFields = blindCast<Row, 'subquery row fields align with Subquery<Row> generic'>(
        source.getRowFields(),
      );
      const defaultJoin = asJoinSource(tableName, tableName, rowFields);

      return blindCast<
        TempTableHandle<Row>,
        'temp table handle created from Subquery<Row> preserves the same row field shape'
      >({
        ...defaultJoin,
        name: tableName,
        fields: rowFields,
        append: createAppend(quotedTableName),
        drop,
        [Symbol.asyncDispose]: drop,
      });
    },

    async from(columns: readonly TempTableColumnDef[]): Promise<TempTableHandle> {
      const tableName = resolveTempTableName();
      const quotedTableName = quoteIdentifier(tableName);

      const colDefs = columns.map((c) => `${quoteIdentifier(c.name)} ${c.type}`).join(', ');
      const createSql = `CREATE TEMP TABLE ${quotedTableName} (${colDefs})${onCommitDrop ? ' ON COMMIT DROP' : ''}`;
      const createAst = RawSqlExpr.of([createSql], []);
      const createQueryPlan = planFromAst(createAst, contract, 'raw.temp-table');
      const createPlan = Object.freeze({
        sql: createAst.fragments[0] ?? '',
        params: [] as unknown[],
        ast: createAst,
        meta: createQueryPlan.meta,
      });
      await execCtx.execute(createPlan).toArray();

      const dropAst = RawSqlExpr.of([`DROP TABLE IF EXISTS ${quotedTableName}`], []);
      const dropQueryPlan = planFromAst(dropAst, contract, 'raw.temp-table');
      const dropPlan = Object.freeze({
        sql: dropAst.fragments[0] ?? '',
        params: [] as unknown[],
        ast: dropAst,
        meta: dropQueryPlan.meta,
      });
      let dropped = false;
      const drop = async (): Promise<void> => {
        if (dropped) return;
        dropped = true;
        await execCtx.execute(dropPlan).toArray();
      };
      if (!onCommitDrop) {
        registerCleanupHook(drop);
      }

      const emptyFields = {} as Record<string, ScopeField>;
      const defaultJoin = asJoinSource(tableName, tableName, emptyFields);
      return blindCast<TempTableHandle, 'from() handle has no typed row fields'>({
        ...defaultJoin,
        name: tableName,
        fields: emptyFields,
        append: createAppend(quotedTableName),
        drop,
        [Symbol.asyncDispose]: drop,
      });
    },
  };
}

/**
 * Creates a lazy Postgres client from either `contractJson` or a TypeScript-authored `contract`.
 * Static query surfaces are available immediately, while `runtime()` instantiates the driver/pool on first call.
 *
 * - No-emit: pass a TypeScript-authored contract. Example: postgres({ contract })
 * - Emitted: pass Contract type explicitly. Example: postgres<Contract>({ contractJson, url })
 */
export default function postgres<TContract extends Contract<SqlStorage>>(
  options: PostgresOptionsWithContract<TContract>,
): PostgresClient<TContract>;
export default function postgres<TContract extends Contract<SqlStorage>>(
  options: PostgresOptionsWithContractJson<TContract>,
): PostgresClient<TContract>;
export default function postgres<TContract extends Contract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): PostgresClient<TContract> {
  const contract = resolveContract(options);
  let binding = resolveOptionalPostgresBinding(options);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: options.extensions ?? [],
  });
  const stackInstance = instantiateExecutionStack(stack);

  const context = createExecutionContext({
    contract,
    stack,
  });

  const rawCodecInferer = stack.adapter.rawCodecInferer;
  const rawSqlTag: RawSqlTag = createRawSql(rawCodecInferer);

  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  const connectDriver = async (resolvedBinding: PostgresBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new Error('Postgres runtime driver missing');
    if (connectPromise) return connectPromise;
    const runtimeBinding = toRuntimeBinding(resolvedBinding, options);
    if (resolvedBinding.kind === 'url' && runtimeBinding.kind === 'pgPool') {
      const pool = runtimeBinding.pool;
      let disposed = false;
      ownedDispose = async () => {
        if (disposed) return;
        disposed = true;
        await pool.end().then(() => undefined);
      };
    }
    connectPromise = runtimeDriver
      .connect(runtimeBinding)
      .then(() => {
        driverConnected = true;
      })
      .catch(async (err) => {
        backgroundConnectError = err;
        connectPromise = undefined;
        await ownedDispose?.().catch(() => undefined);
        throw err;
      });
    return connectPromise;
  };
  const getRuntime = (): Runtime => {
    if (closed) {
      throw new Error('Postgres client is closed');
    }

    if (backgroundConnectError !== undefined) {
      throw backgroundConnectError;
    }

    if (runtimeInstance) {
      return runtimeInstance;
    }

    const driverDescriptor = stack.driver;
    if (!driverDescriptor) {
      throw new Error('Driver descriptor missing from execution stack');
    }

    const driver = driverDescriptor.create({
      cursor: { disabled: true },
    });
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = new PostgresRuntimeImpl({
      context,
      adapter: stackInstance.adapter,
      driver,
      ...ifDefined('verifyMarker', options.verifyMarker),
      ...ifDefined('middleware', options.middleware),
    });

    return runtimeInstance;
  };
  const orm: OrmClient<TContract> = ormBuilder({
    runtime: {
      execute(plan) {
        return getRuntime().execute(plan);
      },
      connection() {
        return getRuntime().connection();
      },
    },
    context,
  });

  const sql: Db<TContract> = sqlBuilder<TContract>({ context, rawCodecInferer });

  const enums = blindCast<
    NamespacedEnums<TContract>,
    'buildNamespacedEnums returns the namespace-keyed accessor map this contract types'
  >(Object.freeze(buildNamespacedEnums(contract.domain)));

  return {
    sql,
    orm,
    enums,
    raw: rawSqlTag,
    context,
    stack,

    async connect(bindingInput) {
      if (closed) {
        throw new Error('Postgres client is closed');
      }

      if (driverConnected || connectPromise) {
        throw new Error('Postgres client already connected');
      }

      if (bindingInput !== undefined) {
        binding = resolvePostgresBinding(bindingInput);
      }

      if (binding === undefined) {
        throw new Error(
          'Postgres binding not configured. Pass url/pg/binding to postgres(...) or call db.connect({ ... }).',
        );
      }

      const runtime = getRuntime();
      if (driverConnected) {
        return runtime;
      }

      await connectDriver(binding);
      return runtime;
    },

    runtime() {
      return getRuntime();
    },

    prepare<
      D extends Declaration<CT>,
      Row,
      CT extends CodecTypesBase = ExtractCodecTypes<TContract> & CodecTypesBase,
    >(
      declaration: D,
      callback: (sql: Db<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
    ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>> {
      return getRuntime().prepare<D, Row, CT>(declaration, (params) => callback(sql, params));
    },

    transaction<R>(fn: (tx: PostgresTransactionContext<TContract>) => PromiseLike<R>): Promise<R> {
      return withTransaction(getRuntime(), (txCtx) => {
        const txSql: Db<TContract> = sqlBuilder<TContract>({
          context,
          rawCodecInferer,
        });

        const txOrm: OrmClient<TContract> = ormBuilder({
          runtime: {
            execute(plan) {
              return txCtx.execute(plan);
            },
          },
          context,
        });

        // Use `txCtx` as the prototype instead of spreading it so that live
        // accessors (notably the `invalidated` getter, which reads a closure
        // variable in `withTransaction`) remain wired to the original object.
        // Spreading would evaluate the getter once and freeze its value.
        const tx: PostgresTransactionContext<TContract> = Object.assign(
          Object.create(txCtx) as TransactionContext,
          {
            sql: txSql,
            orm: txOrm,
            enums,
            tempTable(): TempTableBuilder {
              return createTempTableBuilder(
                txCtx,
                (hook) => txCtx.registerPreCommitHook(hook),
                context.contract,
                stackInstance.adapter,
                true,
              );
            },
          },
        );

        return fn(tx);
      });
    },

    connection<R>(fn: (conn: PostgresConnectionContext<TContract>) => PromiseLike<R>): Promise<R> {
      return withConnection(getRuntime(), (connCtx) => {
        const connSql: Db<TContract> = sqlBuilder<TContract>({
          context,
          rawCodecInferer,
        });

        const connOrm: OrmClient<TContract> = ormBuilder({
          runtime: {
            execute(plan) {
              return connCtx.execute(plan);
            },
          },
          context,
        });

        const conn: PostgresConnectionContext<TContract> = Object.assign(
          Object.create(connCtx) as ConnectionContext,
          {
            sql: connSql,
            orm: connOrm,
            enums,
            tempTable(): TempTableBuilder {
              return createTempTableBuilder(
                connCtx,
                (hook) => connCtx.registerReleaseHook(hook),
                context.contract,
                stackInstance.adapter,
                false,
              );
            },
          },
        );

        return fn(conn);
      });
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await connectPromise?.catch(() => undefined);
      await ownedDispose?.();
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
