import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  CollectionMethodBody,
  CollectionMethodContribution,
  CollectionMethodContributionId,
  CollectionMethodModel,
  CollectionMethodReceiver,
  CollectionMethodRegistry,
  ContributedMethodSignature,
} from '@internal/sql-relational-core/collection-methods';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import type { Filtered, Ordered } from './collection-types';
import { ormError } from './orm-errors';
import { resolveTableForContract } from './storage-resolution';
import type { CollectionMethodModelTypeOf } from './types';

type MethodsOf<Entry, Model> = (Entry & { readonly model: Model })['methods' & keyof Entry];

type ContributedTables<Model> = {
  readonly [Id in CollectionMethodContributionId]: MethodsOf<CollectionMethodRegistry[Id], Model>;
};

type MethodNames<Tables> = { [Id in keyof Tables]: keyof Tables[Id] }[keyof Tables];

type SignatureFrom<Tables, Name> = {
  [Id in keyof Tables]: Name extends keyof Tables[Id] ? Tables[Id][Name] : never;
}[keyof Tables];

type IsUnion<T, All = T> = T extends unknown ? ([All] extends [T] ? false : true) : never;

/** The type of a method name that more than one contribution gives the same model. Calling it is a compile error that names the model and the contributions. */
export interface CollectionMethodNameClash<Name, ModelName, Contributions> {
  readonly clash: `more than one contribution gives model "${ModelName & string}" a collection method named "${Name & string}"`;
  readonly contributions: Contributions;
}

/** What a contributed method returns: the collection it was called on, with `Filtered` and `Ordered` added as its signature declares. */
export type ContributedMethodResult<Signature, Self> = Signature extends { readonly filters: true }
  ? Signature extends { readonly orders: true }
    ? Ordered<Filtered<Self>>
    : Filtered<Self>
  : Signature extends { readonly orders: true }
    ? Ordered<Self>
    : Self;

export type ContributedCollectionMethod<Signature extends ContributedMethodSignature, Self> = <
  Receiver extends Self = Self,
>(
  ...args: Signature['parameters']
) => ContributedMethodResult<Signature, Receiver>;

type MergedTable<Tables, ModelName> = {
  readonly [Name in MethodNames<Tables>]: {
    [Id in keyof Tables]: Name extends keyof Tables[Id] ? Id : never;
  }[keyof Tables] extends infer Ids
    ? true extends IsUnion<Ids>
      ? CollectionMethodNameClash<Name, ModelName, Ids>
      : SignatureFrom<Tables, Name>
    : never;
};

/** Each contributed method of a model, by name, with its signature. It does not depend on the receiver, so TypeScript computes it once per model. */
export type ModelContributedMethodTable<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
> = string extends ModelName | NsId
  ? Record<never, never>
  : MergedTable<
      ContributedTables<CollectionMethodModelTypeOf<TContract, ModelName, NsId>>,
      ModelName
    >;

/** The contributed methods of a model's collection `Self`: the type of `using`. */
export type ContributedCollectionMethods<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Self,
  Table = ModelContributedMethodTable<TContract, ModelName, NsId>,
> = {
  readonly [Name in keyof Table]: Table[Name] extends ContributedMethodSignature
    ? ContributedCollectionMethod<Table[Name], Self>
    : Table[Name];
};

type MethodTable = Readonly<Record<string, CollectionMethodBody>>;

const tablesByContext = new WeakMap<ExecutionContext, ReadonlyMap<string, MethodTable>>();
const NO_METHODS: MethodTable = Object.freeze({});

function modelKey(namespaceId: string, modelName: string): string {
  return JSON.stringify([namespaceId, modelName]);
}

function assertUniqueIds(contributions: ReadonlyArray<CollectionMethodContribution>): void {
  const seen = new Set<string>();
  for (const { id } of contributions) {
    if (seen.has(id)) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `Two collection method contributions have the id "${id}".`,
        {
          why: 'A contribution is registered under its id in CollectionMethodRegistry, so an id names one contribution.',
          fix: 'List each extension once, or give one of the two contributions another id.',
          meta: { id },
        },
      );
    }
    seen.add(id);
  }
}

function modelViews(context: ExecutionContext): Array<[string, CollectionMethodModel]> {
  const { contract } = context;
  const views: Array<[string, CollectionMethodModel]> = [];
  for (const [namespaceId, namespace] of Object.entries(contract.domain.namespaces)) {
    for (const [name, model] of Object.entries(namespace.models)) {
      const tableName = model.storage['table'];
      const resolved =
        typeof tableName === 'string'
          ? resolveTableForContract(contract, namespaceId, tableName)
          : undefined;
      if (resolved === undefined) {
        throw new InternalError(
          `Model "${name}" in namespace "${namespaceId}" has no storage table the contract declares.`,
        );
      }
      views.push([
        modelKey(namespaceId, name),
        {
          target: contract.target,
          name,
          fields: model.fields,
          relations: model.relations,
          table: resolved.table,
        },
      ]);
    }
  }
  return views;
}

function methodsOf(
  contribution: CollectionMethodContribution,
  view: CollectionMethodModel,
): Readonly<Record<string, CollectionMethodBody>> {
  let methods: Readonly<Record<string, unknown>>;
  try {
    methods = contribution.methodsFor(view);
  } catch (cause) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Collection method contribution "${contribution.id}" failed for model "${view.name}".`,
      {
        why: "The ORM client asks every contribution for every model's methods when it is created.",
        fix: `Fix or remove the extension that contributes "${contribution.id}"; the cause is the contribution's own error.`,
        meta: { model: view.name, contribution: contribution.id },
        cause,
      },
    );
  }
  if (typeof methods !== 'object' || methods === null) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Collection method contribution "${contribution.id}" returned no object of methods for model "${view.name}".`,
      {
        why: "A contribution returns an object holding a model's methods by name, empty when it gives the model none.",
        fix: `Fix or remove the extension that contributes "${contribution.id}".`,
        meta: { model: view.name, contribution: contribution.id },
      },
    );
  }
  for (const [name, body] of Object.entries(methods)) {
    if (typeof body !== 'function') {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `Collection method "${name}" that contribution "${contribution.id}" gives model "${view.name}" is not a function.`,
        {
          why: "A contribution returns each of a model's methods as a function of the collection and the caller's arguments.",
          fix: `Fix or remove the extension that contributes "${contribution.id}".`,
          meta: { model: view.name, method: name, contribution: contribution.id },
        },
      );
    }
  }
  return blindCast<
    Readonly<Record<string, CollectionMethodBody>>,
    "each value was checked to be a function; its parameters are the type half's to declare"
  >(methods);
}

function mergedTable(
  view: CollectionMethodModel,
  contributions: ReadonlyArray<CollectionMethodContribution>,
): MethodTable {
  const methods: Record<string, CollectionMethodBody> = Object.create(null);
  const owners = new Map<string, string>();
  for (const contribution of contributions) {
    for (const [name, body] of Object.entries(methodsOf(contribution, view))) {
      const owner = owners.get(name);
      if (owner !== undefined) {
        throw ormError(
          'ORM.ARGUMENT_INVALID',
          `Collection method "${name}" of model "${view.name}" is contributed by both "${owner}" and "${contribution.id}".`,
          {
            why: 'A collection offers one method under each name in `using`.',
            fix: 'Remove one of the extensions that contribute these methods.',
            meta: { model: view.name, method: name, contributions: [owner, contribution.id] },
          },
        );
      }
      owners.set(name, contribution.id);
      methods[name] = body;
    }
  }
  return Object.freeze(methods);
}

/**
 * Asks each contribution for each model's methods, once per execution context. Throws `ORM.ARGUMENT_INVALID` when two contributions share an id, give one model two methods with the same name, fail, or return a method that is not a function.
 */
export function collectionMethodTables(
  context: ExecutionContext,
): ReadonlyMap<string, MethodTable> {
  const cached = tablesByContext.get(context);
  if (cached !== undefined) return cached;
  const contributions = context.collectionMethods ?? [];
  assertUniqueIds(contributions);
  const tables = new Map<string, MethodTable>();
  for (const [key, view] of modelViews(context)) {
    tables.set(key, mergedTable(view, contributions));
  }
  tablesByContext.set(context, tables);
  return tables;
}

/** The contributed methods of a model, by name. */
export function collectionMethodTable(
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
): MethodTable {
  return collectionMethodTables(context).get(modelKey(namespaceId, modelName)) ?? NO_METHODS;
}

/** The run-time value of `collection.using`. */
export function createCollectionMethods(
  receiver: CollectionMethodReceiver,
  table: MethodTable,
): Readonly<Record<string, (...args: never[]) => CollectionMethodReceiver>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(table).map(([name, body]) => [
        name,
        (...args: never[]) => body(receiver, ...args),
      ]),
    ),
  );
}
