import type { Contract } from '@internal/contract/types';
import type { CodecDescriptor } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import type { Db, TableProxyContract } from '../types/db';
import type { BuilderContext } from './builder-base';
import { resolveTableInNamespace } from './resolve-table';
import { TableProxyImpl } from './table-proxy-impl';

export interface SqlOptions<C extends Contract<SqlStorage> & TableProxyContract> {
  readonly context: ExecutionContext<C>;
  readonly rawCodecInferer: RawCodecInferer;
}

function descriptorMaterializesWithoutTypeParams(
  descriptor: CodecDescriptor<unknown> | undefined,
): boolean {
  if (descriptor === undefined) return false;
  const schema = descriptor.paramsSchema;
  if (schema === undefined) return true;
  const result = schema['~standard'].validate({});
  return !(result instanceof Promise) && result.issues === undefined;
}

export function sql<C extends Contract<SqlStorage> & TableProxyContract>(
  options: SqlOptions<C>,
): Db<C> {
  const { context, rawCodecInferer } = options;
  const ctx: BuilderContext = {
    capabilities: context.contract.capabilities,
    queryOperationTypes: context.queryOperations.entries(),
    target: context.contract.target ?? 'unknown',
    storageHash: context.contract.storage.storageHash ?? 'unknown',
    storage: context.contract.storage,
    applyMutationDefaults: (options) => context.applyMutationDefaults(options),
    rawCodecInferer,
    aggregates: context.aggregateDescriptors,
    materializesWithoutTypeParams: (codecId) =>
      descriptorMaterializesWithoutTypeParams(context.codecDescriptors.descriptorFor(codecId)),
  };

  const { storage } = context.contract;

  return new Proxy(
    blindCast<Db<C>, 'the handler answers every property; the target is an empty carrier'>({}),
    {
      get(_target, prop: string | symbol) {
        if (typeof prop !== 'string') {
          return undefined;
        }
        if (!Object.hasOwn(storage.namespaces, prop)) {
          return undefined;
        }
        const namespaceId = prop;
        return new Proxy(
          {},
          {
            get(_facetTarget, tableName: string | symbol) {
              if (typeof tableName !== 'string') {
                return undefined;
              }
              const table = resolveTableInNamespace(storage, namespaceId, tableName);
              if (table) {
                // `namespaceId` is a dynamic Proxy key with no static literal here, so the
                // proxy's `NsId` type param lands on its `string` default at this boundary.
                // `TableProxyImpl` still forwards `NsId` through its `as()`/join chain.
                return new TableProxyImpl(tableName, table, tableName, ctx, namespaceId);
              }
              return undefined;
            },
          },
        );
      },
    },
  );
}
