import { MongoDriverImpl } from '@internal/driver-mongo';
import { AsyncIterableResult, type RuntimeMode } from '@internal/framework-components/runtime';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import type { MongoOrmClient, MongoQueryPlan, MongoRawClient } from '@internal/mongo-orm';
import { mongoOrm } from '@internal/mongo-orm';
import type { MongoMiddleware, MongoRuntime } from '@internal/mongo-runtime';
import { createMongoRuntime, type MongoExecutionContext } from '@internal/mongo-runtime';
import { ifDefined } from '@internal/utils/defined';
import { validateMongoContract } from '../static/contract-from-json';
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
  readonly mode?: RuntimeMode;
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

export type MongoOptions<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> = MongoBindingOptions &
  MongoOptionsBase & {
    readonly contract: TContract;
  };

/**
 * Creates a lazy Mongo client. The client infers its contract type from `contract`: a value from
 * `contractFromJson` for an emitted contract, or a TypeScript-authored contract. A contract is
 * validated once, however many clients are built from it. The `orm` and `query` surfaces are
 * available at once; the driver connects on the first query or `connect()`.
 *
 * @example
 * ```ts
 * import { contractFromJson } from '@prisma/orm-mongo/static';
 * import mongo from '@prisma/orm-mongo/runtime';
 * import type { Contract } from './contract.d';
 * import contractJson from './contract.json' with { type: 'json' };
 *
 * export const contract = contractFromJson<Contract>(contractJson);
 * export const db = mongo({ contract, url: process.env['MONGODB_URL']! });
 * ```
 */
export default function mongo<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOptions<TContract>): MongoClient<TContract> {
  const contract = validateMongoContract(options.contract);
  let binding = resolveOptionalMongoBinding(options);

  const { context, stack, query, enums, raw } = buildMongoStaticContext<TContract>(contract);

  // Single source of truth for the lifecycle. `runtimePromise` is the in-flight
  // or settled build; `closed` is the terminal state set by `close()`. A failed
  // build resets `runtimePromise` so a retry is possible (see test).
  let runtimePromise: Promise<MongoRuntime> | undefined;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  const closedError = () => mongoError('DRIVER.NOT_CONNECTED', 'Mongo client is closed');

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
      adapter: stack.adapter.create(stack),
      driver,
      ...ifDefined('mode', options.mode),
      ...ifDefined('middleware', options.middleware),
    });
  };

  const getRuntime = (): Promise<MongoRuntime> => {
    if (closed) {
      return Promise.reject(closedError());
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
    context,
    runtime: { query: queryRows, execute: executeStats },
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
        throw closedError();
      }
      if (runtimePromise !== undefined) {
        if (bindingInput !== undefined) {
          throw mongoError('DRIVER.ALREADY_CONNECTED', 'Mongo client is already bound', {
            why: 'connect() was given options after the client was bound to a database.',
            fix: 'Call connect() without options, or create a new client for another database.',
          });
        }
        const runtime = await runtimePromise;
        if (closed) throw closedError();
        return runtime;
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
      const runtime = await getRuntime();
      if (closed) throw closedError();
      return runtime;
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
