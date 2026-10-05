import { type Contract, domainModelsAtDefaultNamespace } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  ExecutionContext,
  SqlAggregateDescriptorRegistry,
} from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { aggregateOperationNames } from './aggregate-operations';
import { type Collection, CollectionBase, reservedCollectionMemberNames } from './collection';
import { ormError } from './orm-errors';
import {
  type DeclaredFields,
  defineFieldScope,
  type FieldScope,
  type ScopeCollection,
  type ScopeFacts,
  type ScopeFieldDeclarations,
  type ScopeModelAccessor,
} from './scopes';
import { domainModelNamesInNamespace, domainModelTableInNamespace } from './storage-resolution';
import type {
  CollectionContext,
  CollectionModelName,
  CollectionTypeState,
  DefaultCollectionTypeState,
  InferRootRow,
  RuntimeQueryable,
  WithNsId,
} from './types';

export interface OrmOptions<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> {
  readonly runtime: RuntimeQueryable;
  readonly collections?: Collections;
  readonly context: ExecutionContext<TContract>;
}

type ModelNames<TContract extends Contract<SqlStorage>> = CollectionModelName<TContract>;

type AnyCollectionClass = new (...args: never[]) => object;

type CustomCollectionForKey<
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  Key extends string,
> = Key extends keyof Collections
  ? Collections[Key] extends AnyCollectionClass
    ? InstanceType<Collections[Key]>
    : never
  : never;

// The `NsId` coordinate is threaded into the collection (and its `InferRootRow`)
// so the read row AND the create/update/where input types resolve the model's
// fields within its namespace (per-namespace domain block + nested
// `FieldOutputTypes[NsId]`).
type ModelCollection<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  NsId extends string,
  ModelName extends ModelNames<TContract>,
> = [CustomCollectionForKey<Collections, ModelName>] extends [never]
  ? Collection<
      TContract,
      ModelName,
      InferRootRow<TContract, ModelName, NsId>,
      WithNsId<DefaultCollectionTypeState, NsId>
    >
  : CustomCollectionForKey<Collections, ModelName>;

type NamespaceModelNames<
  TContract extends Contract<SqlStorage>,
  NsId extends keyof TContract['domain']['namespaces'],
> = keyof TContract['domain']['namespaces'][NsId]['models'] & string & ModelNames<TContract>;

// The model collections of a single domain namespace, keyed by bare model
// name. Lets callers reach a model by its namespace coordinate
// (`orm.<ns>.<Model>`). Enums are not adjacent to models here — they live on
// the `db.enums` facade member, lane-agnostic contract metadata.
export type OrmNamespace<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
  NsId extends keyof TContract['domain']['namespaces'],
> = {
  [K in NamespaceModelNames<TContract, NsId>]: ModelCollection<
    TContract,
    Collections,
    NsId & string,
    K
  >;
};

type NamespacedClientMap<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> = {
  [Ns in keyof TContract['domain']['namespaces']]: OrmNamespace<TContract, Collections, Ns>;
};

/** The members of the client beside its namespaces. */
export interface OrmClientMembers<TContract extends Contract<SqlStorage>> {
  /**
   * Define a scope for any model that has the declared fields. Declare each field with a field builder from the contract DSL or with `{ codecId, nullable }`. The body sees only the declared fields and may call `where`, `orderBy`, `limit` and `offset`. The scope accepts a collection of any model whose fields include the declared ones with the same column type and nullability, and returns that collection with the filter and order the body applied.
   *
   * ```ts
   * const notDeleted = db.orm.scope(
   *   { deletedAt: field.column(timestamptzTemporalColumn).optional() },
   *   (rows) => rows.where((r) => r.deletedAt.isNull()),
   * );
   * db.orm.public.Post.apply(notDeleted).deleteAll();
   * ```
   */
  scope<const Declarations extends ScopeFieldDeclarations, Facts extends ScopeFacts>(
    fields: Declarations,
    body: (
      rows: ScopeCollection<
        ScopeModelAccessor<TContract, DeclaredFields<Declarations>>,
        ScopeFacts
      >,
    ) => ScopeCollection<ScopeModelAccessor<TContract, DeclaredFields<Declarations>>, Facts>,
  ): FieldScope<TContract, DeclaredFields<Declarations>, Facts>;
}

type OrmClient<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
> = NamespacedClientMap<TContract, Collections> &
  ('scope' extends keyof TContract['domain']['namespaces'] ? unknown : OrmClientMembers<TContract>);

/**
 * Reject a contributed aggregate operation whose name a collection member
 * already owns. Aggregate operations surface as reducer methods on the
 * collection, in one flat namespace with the builder members, so a same-named
 * operation would shadow the member it collides with — a client-surface
 * concern, enforced here where that surface is assembled.
 */
function assertAggregateOperationsNotReserved(registry: SqlAggregateDescriptorRegistry): void {
  const reserved = reservedCollectionMemberNames();
  for (const operation of aggregateOperationNames(registry)) {
    if (!reserved.has(operation)) {
      continue;
    }
    throw ormError(
      'ORM.AGGREGATE_OPERATION_RESERVED',
      `Aggregate operation '${operation}' is reserved: the name is a collection builder member.`,
      {
        why: 'Aggregate operations surface as reducer methods on the collection, in one namespace with the query-builder members; a same-named operation would shadow the member it collides with.',
        fix: 'Rename the contributed aggregate operation.',
        meta: { operation },
      },
    );
  }
}

export function orm<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>> = Record<never, never>,
>(options: OrmOptions<TContract, Collections>): OrmClient<TContract, Collections> {
  const { runtime, collections, context } = options;
  assertAggregateOperationsNotReserved(context.aggregateDescriptors);
  const contract = context.contract;
  const ctx: CollectionContext<TContract> = { runtime, context };
  const collectionRegistry = createCollectionRegistry(contract, collections);

  type AnyCollection = Collection<TContract, string, unknown, CollectionTypeState>;

  function buildCollection(
    namespaceId: string,
    modelName: string,
    tableName?: string,
  ): AnyCollection {
    const CollectionClass = collectionRegistry.get(modelName) ?? CollectionBase;
    const CollectionCtor = blindCast<
      new (
        ctx: CollectionContext<TContract>,
        modelName: string,
        options?: Record<string, unknown>,
      ) => AnyCollection,
      'a registered collection class is a Collection subclass constructor'
    >(CollectionClass);
    return new CollectionCtor(ctx, modelName, {
      registry: collectionRegistry,
      namespaceId,
      ...(tableName !== undefined ? { tableName } : {}),
    });
  }

  const namespaceFacets = new Map<string, object>();

  function namespaceFacet(namespaceId: string): object {
    const cached = namespaceFacets.get(namespaceId);
    if (cached) {
      return cached;
    }
    const facetModelNames = new Set(domainModelNamesInNamespace(contract, namespaceId));
    const facetCache = new Map<string, AnyCollection>();
    const facet = new Proxy(
      {},
      {
        get(_facetTarget, modelProp: string | symbol): unknown {
          if (typeof modelProp !== 'string') {
            return undefined;
          }
          if (!facetModelNames.has(modelProp)) {
            return undefined;
          }
          const hit = facetCache.get(modelProp);
          if (hit) {
            return hit;
          }
          const collection = buildCollection(
            namespaceId,
            modelProp,
            domainModelTableInNamespace(contract, namespaceId, modelProp),
          );
          facetCache.set(modelProp, collection);
          return collection;
        },
      },
    );
    namespaceFacets.set(namespaceId, facet);
    return facet;
  }

  return new Proxy({} as OrmClient<TContract, Collections>, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') {
        return undefined;
      }

      if (Object.hasOwn(contract.domain.namespaces, prop)) {
        return namespaceFacet(prop);
      }

      return prop === 'scope' ? defineFieldScope : undefined;
    },
  });
}

function createCollectionRegistry<
  TContract extends Contract<SqlStorage>,
  Collections extends Partial<Record<string, AnyCollectionClass>>,
>(contract: TContract, collections: Collections | undefined): Map<string, AnyCollectionClass> {
  const registry = new Map<string, AnyCollectionClass>();
  if (!collections) {
    return registry;
  }

  const models = domainModelsAtDefaultNamespace(contract.domain);
  for (const [key, collectionClass] of Object.entries(collections)) {
    if (!collectionClass) {
      continue;
    }
    if (!isCollectionClass(collectionClass)) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `Custom collection '${key}' must be a Collection class (constructor), not an instance`,
        { meta: { method: 'orm', argument: 'collections', key } },
      );
    }
    if (!Object.hasOwn(models, key)) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `No model found for custom collection '${key}'. Available models: ${Object.keys(models).join(', ')}`,
        { meta: { method: 'orm', argument: 'collections', key } },
      );
    }
    registry.set(key, collectionClass);
  }

  return registry;
}

function isCollectionClass(value: unknown): value is AnyCollectionClass {
  if (typeof value !== 'function') {
    return false;
  }
  const candidate = value as { prototype?: unknown };
  if (!candidate.prototype || typeof candidate.prototype !== 'object') {
    return false;
  }
  return candidate.prototype instanceof CollectionBase;
}
