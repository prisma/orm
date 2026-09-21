import { MongoDriverImpl } from '@internal/driver-mongo';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import type { MongoOrmClient, MongoQueryPlan, MongoRawClient } from '@internal/mongo-orm';
import { mongoOrm } from '@internal/mongo-orm';
import type { MongoMiddleware, MongoRuntime } from '@internal/mongo-runtime';
import { createMongoRuntime, type MongoExecutionContext } from '@internal/mongo-runtime';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { buildMongoStaticContext, type MongoStaticContext } from '../static/mongo-static';
import {
  type MongoBinding,
  type MongoBindingInput,
  resolveMongoBinding,
  resolveOptionalMongoBinding,
} from './binding';
import { mongoError } from './mongo-errors';

export type MongoTargetId = 'mongo';

type UnboundEnums<TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>> =
  MongoStaticContext<TContract>['enums'];

export interface MongoClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> {
  readonly orm: MongoOrmClient<TContract>;
  readonly query: MongoStaticContext<TContract>['query'];
  readonly raw: MongoRawClient<TContract>;
  readonly contract: TContract;
  readonly enums: UnboundEnums<TContract>;
  readonly context: MongoExecutionContext<TContract>;
  connect(bindingInput?: MongoBindingInput): Promise<MongoRuntime>;
  runtime(): Promise<MongoRuntime>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface MongoOptionsBase {
  readonly mode?: 'strict' | 'permissive';
  /**
   * Optional middleware chain applied to every Mongo execution.
   */
  readonly middleware?: readonly MongoMiddleware[];
}

export interface MongoBindingOptions {
  readonly binding?: MongoBinding;
  readonly url?: string;
  readonly uri?: string;
  readonly dbName?: string;
  readonly mongoClient?: import('mongodb').MongoClient;
}

export type MongoOptionsWithContract<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> = MongoBindingOptions &
  MongoOptionsBase & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

/**
 * `TContract` is a phantom parameter that drives explicit-type inference at the
 * call site (e.g. `mongo<Contract>({ contractJson })`). It is not referenced in
 * the type body — the contract value comes through `contractJson` at runtime.
 */
export type MongoOptionsWithContractJson<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> = MongoBindingOptions &
  MongoOptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
    /**
     * @internal phantom field; never set at runtime, only references TContract
     * so that strict tsc/biome don't flag the type parameter as unused.
     */
    readonly __contractPhantom?: TContract;
  };

export type MongoOptions<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> = MongoOptionsWithContract<TContract> | MongoOptionsWithContractJson<TContract>;

function hasContractJson<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptions<TContract>): options is MongoOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

function resolveContract<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptions<TContract>): TContract {
  const contractInput = hasContractJson(options) ? options.contractJson : options.contract;
  return blindCast<
    TContract,
    'serializer validates the runtime contract while the caller supplies the named generated contract type'
  >(new MongoContractSerializer().deserializeContract(contractInput));
}

/**
 * Creates a lazy Mongo client from either `contractJson` or a TypeScript-authored `contract`.
 * The `orm` and `query` surfaces are available immediately; the underlying driver is connected
 * on the first query (or the first explicit `connect()` call), mirroring the Postgres facade.
 *
 * - No-emit: pass a TypeScript-authored contract. Example: `mongo({ contract, url })`
 * - Emitted: pass `Contract` type explicitly. Example: `mongo<Contract>({ contractJson, url })`
 */
export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptionsWithContract<TContract>): MongoClient<TContract>;
export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptionsWithContractJson<TContract>): MongoClient<TContract>;
export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptions<TContract>): MongoClient<TContract> {
  const contract = resolveContract(options);
  let binding = resolveOptionalMongoBinding(options);

  const { context, query, enums, raw } = buildMongoStaticContext<TContract>(contract);

  // Single source of truth for the lifecycle. `runtimePromise` is the in-flight
  // or settled build; `closed` is the terminal state set by `close()`. A failed
  // build resets `runtimePromise` so a retry is possible (see test).
  let runtimePromise: Promise<MongoRuntime> | undefined;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  const buildRuntime = async (resolvedBinding: MongoBinding): Promise<MongoRuntime> => {
    const driver =
      resolvedBinding.kind === 'url'
        ? await MongoDriverImpl.fromConnection(resolvedBinding.url, resolvedBinding.dbName)
        : MongoDriverImpl.fromDb(resolvedBinding.client.db(resolvedBinding.dbName));
    if (resolvedBinding.kind === 'url') {
      ownedDispose = () => driver.close();
    }
    return createMongoRuntime({
      context,
      driver,
      ...ifDefined('mode', options.mode),
      ...ifDefined('middleware', options.middleware),
    });
  };

  const getRuntime = (): Promise<MongoRuntime> => {
    if (closed) {
      return Promise.reject(mongoError('DRIVER.NOT_CONNECTED', 'Mongo client is closed'));
    }
    if (runtimePromise !== undefined) {
      return runtimePromise;
    }
    if (binding === undefined) {
      return Promise.reject(
        mongoError(
          'RUNTIME.BINDING_MISSING',
          'Mongo binding not configured. Pass url/uri+dbName/mongoClient+dbName/binding to mongo(...) or call db.connect({ ... }).',
        ),
      );
    }
    runtimePromise = buildRuntime(binding).catch((err) => {
      // Reset so a later connect()/runtime() can retry rather than always
      // re-throwing the cached failure.
      runtimePromise = undefined;
      throw err;
    });
    return runtimePromise;
  };

  function queryRows<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
    async function* iterate(): AsyncGenerator<Row, void, unknown> {
      const runtime = await getRuntime();
      yield* runtime.query(plan);
    }
    return new AsyncIterableResult(iterate());
  }

  async function executeStats(plan: MongoQueryPlan<unknown>) {
    const runtime = await getRuntime();
    return runtime.execute(plan);
  }

  const orm = mongoOrm<TContract>({
    contract,
    executor: { query: queryRows, execute: executeStats },
  });

  return {
    orm,
    query,
    raw,
    contract,
    enums,
    context,

    async connect(bindingInput?: MongoBindingInput): Promise<MongoRuntime> {
      if (closed) {
        throw mongoError('DRIVER.NOT_CONNECTED', 'Mongo client is closed');
      }
      if (runtimePromise !== undefined) {
        throw mongoError('DRIVER.ALREADY_CONNECTED', 'Mongo client already connected');
      }
      if (bindingInput !== undefined) {
        binding = resolveMongoBinding(bindingInput);
      }
      if (binding === undefined) {
        throw mongoError(
          'RUNTIME.BINDING_MISSING',
          'Mongo binding not configured. Pass url/uri+dbName/mongoClient+dbName/binding to mongo(...) or call db.connect({ ... }).',
        );
      }
      return getRuntime();
    },

    runtime(): Promise<MongoRuntime> {
      return getRuntime();
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (runtimePromise === undefined) return;
      // Await whatever the build resolved to. Swallow build failures because
      // the user's intent is "release any resources we acquired" — there is
      // nothing to close if the build never produced a runtime.
      try {
        await runtimePromise;
      } catch {
        // build failed; still attempt disposing any already-acquired owned driver.
      }
      const dispose = ownedDispose;
      ownedDispose = undefined;
      await dispose?.();
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
