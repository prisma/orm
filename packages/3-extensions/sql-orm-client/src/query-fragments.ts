import type { Contract } from '@internal/contract/types';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import {
  type Direction,
  isOrderByDirection,
  type OrderByItem,
  type WhereArg,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { modelOf, resolveFieldToColumn } from './collection-contract';
import type { Filtered, HasState, Ordered } from './collection-types';
import { hasTrait, resolveColumn } from './column-codec';
import { ormError } from './orm-errors';
import type {
  CodecField,
  FieldCodecId,
  FieldNullable,
  FieldsOf,
  Orderable,
  OrderableFieldName,
} from './types';

/** A field declared by its column type and nullability, for a scope written without a field builder. */
export interface ScopeFieldSpec<
  CodecId extends string = string,
  Nullable extends boolean = boolean,
> {
  readonly codecId: CodecId;
  readonly nullable: Nullable;
}

/** A field builder from the contract DSL, such as `field.column(textColumn).optional()`: what `client.scope` reads from it. */
export interface ScopeFieldBuilder<
  CodecId extends string = string,
  Nullable extends boolean = boolean,
> {
  build(): {
    readonly descriptor?: { readonly codecId: CodecId } | undefined;
    readonly nullable: Nullable;
  };
}

/** The fields a scope for any model needs, each declared with a field builder or a {@link ScopeFieldSpec}. */
export type ScopeFieldDeclarations = Readonly<Record<string, ScopeFieldBuilder | ScopeFieldSpec>>;

type DeclaredField<Declaration> =
  Declaration extends ScopeFieldBuilder<infer Id, infer Nullable>
    ? ScopeFieldSpec<Id, Nullable>
    : Declaration extends ScopeFieldSpec<infer Id, infer Nullable>
      ? ScopeFieldSpec<Id, Nullable>
      : never;

/** The declared fields with each builder read as its column type and nullability. */
export type DeclaredFields<Declarations extends ScopeFieldDeclarations> = {
  readonly [K in keyof Declarations]: DeclaredField<Declarations[K]>;
} extends infer Fields
  ? { readonly [K in keyof Fields]: Fields[K] }
  : never;

/** The model accessor of a scope for any model: only the declared fields, typed by column type. */
export type ScopeRow<
  TContract extends Contract<SqlStorage>,
  Fields extends Readonly<Record<string, ScopeFieldSpec>>,
> = {
  readonly [K in keyof Fields]: Fields[K]['codecId'] extends keyof ExtractCodecTypes<TContract> &
    string
    ? CodecField<TContract, Fields[K]['codecId'], Fields[K]['nullable']>
    : never;
};

/** What a scope for any model has established: a filter, an order. */
export interface ScopeFacts {
  readonly hasWhere: boolean;
  readonly hasOrderBy: boolean;
}

export interface NoFacts extends ScopeFacts {
  readonly hasWhere: false;
  readonly hasOrderBy: false;
}

type OrderSelector<Row> = (row: Row) => OrderByItem;

/** The collection the body of a scope for any model receives: the methods that keep the row, on the declared fields. */
export interface ScopeQuery<Row, Facts extends ScopeFacts> {
  where(
    fn: (row: Row) => WhereArg,
  ): ScopeQuery<Row, { readonly hasWhere: true; readonly hasOrderBy: Facts['hasOrderBy'] }>;
  orderBy(
    selection: OrderSelector<Row> | ReadonlyArray<OrderSelector<Row>>,
  ): ScopeQuery<Row, { readonly hasWhere: Facts['hasWhere']; readonly hasOrderBy: true }>;
  limit(n: number): ScopeQuery<Row, Facts>;
  offset(n: number): ScopeQuery<Row, Facts>;
}

type MismatchedField<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Fields extends Readonly<Record<string, ScopeFieldSpec>>,
> = {
  [K in keyof Fields & string]: K extends keyof FieldsOf<TContract, ModelName, NsId>
    ? [
        FieldCodecId<TContract, ModelName, K, NsId>,
        FieldNullable<TContract, ModelName, K, NsId>,
      ] extends [Fields[K]['codecId'], Fields[K]['nullable']]
      ? [Fields[K]['codecId'], Fields[K]['nullable']] extends [
          FieldCodecId<TContract, ModelName, K, NsId>,
          FieldNullable<TContract, ModelName, K, NsId>,
        ]
        ? never
        : K
      : K
    : K;
}[keyof Fields & string];

type ScopeFieldsCheck<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Fields extends Readonly<Record<string, ScopeFieldSpec>>,
> = [MismatchedField<TContract, ModelName, NsId, Fields>] extends [never]
  ? unknown
  : {
      readonly 'the model has no field with the column type and nullability the scope declares': MismatchedField<
        TContract,
        ModelName,
        NsId,
        Fields
      >;
    };

type WithFacts<C, Facts extends ScopeFacts> = Facts['hasOrderBy'] extends true
  ? Ordered<Facts['hasWhere'] extends true ? Filtered<C> : C>
  : Facts['hasWhere'] extends true
    ? Filtered<C>
    : C;

/**
 * A scope made by `client.scope`: it accepts a collection of any model that has the declared fields, and returns that collection with what the body established.
 */
export type FieldScope<
  TContract extends Contract<SqlStorage>,
  Fields extends Readonly<Record<string, ScopeFieldSpec>>,
  Facts extends ScopeFacts,
> = <C, ModelName extends string, NsId extends string = never>(
  collection: C &
    HasState<{ readonly nsId: NsId }> & { readonly modelName: ModelName } & ScopeFieldsCheck<
      TContract,
      ModelName,
      NsId,
      Fields
    >,
) => WithFacts<C, Facts>;

function nullability(nullable: boolean): string {
  return nullable ? 'may be null' : 'is never null';
}

function declaredFieldSpecs(
  declarations: ScopeFieldDeclarations,
): ReadonlyArray<readonly [string, ScopeFieldSpec]> {
  return Object.entries(declarations).map(([name, declaration]) => {
    if (!('build' in declaration)) return [name, declaration];
    const built = declaration.build();
    if (built.descriptor === undefined) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `Cannot declare the scope field ${name}: the field builder names no column type`,
        {
          why: 'A scope for any model matches each declared field by its column type, and this builder refers to a named type instead of a column type.',
          fix: 'Declare the field with field.column(...) and a column type, or with { codecId, nullable }.',
          meta: { field: name },
        },
      );
    }
    return [name, { codecId: built.descriptor.codecId, nullable: built.nullable }];
  });
}

function assertScopeFields(
  collection: RuntimeModelCollection,
  fields: ReadonlyArray<readonly [string, ScopeFieldSpec]>,
): void {
  const { contract } = collection.ctx.context;
  const { modelName, namespaceId } = collection;
  const model = modelOf(contract, namespaceId, modelName);
  for (const [name, spec] of fields) {
    const declared = `The scope was declared for models that have a field ${name} of column type ${spec.codecId} that ${nullability(spec.nullable)}.`;
    const meta = { model: modelName, field: name, codecId: spec.codecId, nullable: spec.nullable };
    if (!Object.hasOwn(model?.fields ?? {}, name)) {
      throw ormError(
        'ORM.FIELD_UNKNOWN',
        `Cannot apply a scope to ${modelName}: it has no field ${name}`,
        {
          why: declared,
          fix: `Apply the scope to a model that has a field ${name}, or remove ${name} from the declaration in the scope.`,
          meta,
        },
      );
    }
    const column = resolveColumn(
      contract,
      namespaceId,
      collection.tableName,
      resolveFieldToColumn(contract, namespaceId, modelName, name),
    );
    if (column?.codecId !== spec.codecId || column.nullable !== spec.nullable) {
      const actual =
        column === undefined
          ? `${modelName}.${name} has no column.`
          : `${modelName}.${name} has column type ${column.codecId} and ${nullability(column.nullable)}.`;
      throw ormError(
        'ORM.FIELD_UNKNOWN',
        `Cannot apply a scope to ${modelName}: its field ${name} does not match the declaration`,
        {
          why: `${declared} ${actual}`,
          fix: `Apply the scope to a model whose ${name} field has that column type and nullability, or change the declaration in the scope.`,
          meta,
        },
      );
    }
  }
}

/**
 * Define a scope for any model that has the declared fields. Reached as `client.scope(fields, body)` on the client `orm()` returns.
 */
export function defineFieldScope<
  TContract extends Contract<SqlStorage>,
  const Declarations extends ScopeFieldDeclarations,
  Facts extends ScopeFacts,
>(
  declarations: Declarations,
  body: (
    rows: ScopeQuery<ScopeRow<TContract, DeclaredFields<Declarations>>, NoFacts>,
  ) => ScopeQuery<ScopeRow<TContract, DeclaredFields<Declarations>>, Facts>,
): FieldScope<TContract, DeclaredFields<Declarations>, Facts> {
  const fields = declaredFieldSpecs(declarations);
  return (collection) => {
    assertScopeFields(
      blindCast<
        RuntimeModelCollection,
        'every collection carries its context, model, namespace and table'
      >(collection),
      fields,
    );
    return blindCast<
      WithFacts<typeof collection, Facts>,
      'where, orderBy, limit and offset return a collection of the same class with the facts the body established'
    >(
      body(
        blindCast<
          ScopeQuery<ScopeRow<TContract, DeclaredFields<Declarations>>, NoFacts>,
          'a collection offers where, orderBy, limit and offset with these run-time shapes'
        >(collection),
      ),
    );
  };
}

interface ModelCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
> {
  readonly ctx: { readonly context: ExecutionContext<TContract> };
  readonly modelName: ModelName;
  readonly namespaceId: NsId;
  readonly tableName: string;
}

type RuntimeModelCollection = ModelCollection<Contract<SqlStorage>, string, string>;

const SHOWN_LENGTH = 64;

interface ShownText {
  readonly text: string;
  readonly cut: boolean;
}

function shown(value: string): ShownText {
  const characters = Array.from(value);
  const cut = characters.length > SHOWN_LENGTH;
  return {
    text: JSON.stringify(cut ? `${characters.slice(0, SHOWN_LENGTH).join('')}…` : value),
    cut,
  };
}

function describeReceived(value: unknown): string {
  if (value === undefined || value === null) return String(value);
  if (Array.isArray(value)) return 'an array';
  const kind = typeof value;
  return kind === 'object' ? 'an object' : `a ${kind}`;
}

function cutNote(subject: string, value: ShownText): string {
  return value.cut ? ` The ${subject} above is cut to its first ${SHOWN_LENGTH} characters.` : '';
}

function fieldCodecId(collection: RuntimeModelCollection, field: string): string | undefined {
  const { contract } = collection.ctx.context;
  const column = resolveFieldToColumn(
    contract,
    collection.namespaceId,
    collection.modelName,
    field,
  );
  return resolveColumn(contract, collection.namespaceId, collection.tableName, column)?.codecId;
}

function canOrder(collection: RuntimeModelCollection, field: string): boolean {
  const codecId = fieldCodecId(collection, field);
  return codecId !== undefined && hasTrait(collection.ctx.context, codecId, 'order');
}

function orderableFieldNames(collection: RuntimeModelCollection): readonly string[] {
  const model = modelOf(
    collection.ctx.context.contract,
    collection.namespaceId,
    collection.modelName,
  );
  return Object.keys(model?.fields ?? {}).filter((field) => canOrder(collection, field));
}

function whyNotOrderable(collection: RuntimeModelCollection, name: string): string {
  const { modelName } = collection;
  const model = modelOf(collection.ctx.context.contract, collection.namespaceId, modelName);
  const quoted = shown(name).text;
  if (Object.hasOwn(model?.relations ?? {}, name)) {
    return `${quoted} is a relation of ${modelName}, not a field.`;
  }
  if (!Object.hasOwn(model?.fields ?? {}, name)) {
    return `${modelName} has no field ${quoted}.`;
  }
  return canOrder(collection, name)
    ? `${quoted} is not one of the fields allowed for ordering.`
    : `The codec ${fieldCodecId(collection, name)} of ${modelName}.${name} cannot be ordered.`;
}

/**
 * An `orderBy` selector for a field named by a string, such as an order parameter of a request. A name that is not an orderable field of the collection's model or not in `allowed`, and a direction other than `asc` or `desc`, throw `ORM.ARGUMENT_INVALID`.
 *
 * ```ts
 * db.Post.orderBy(orderByField(db.Post, input.orderBy, input.direction, ['title', 'createdAt']));
 * ```
 */
export function orderByField<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
  const Allowed extends OrderableFieldName<TContract, ModelName, NsId> = OrderableFieldName<
    TContract,
    ModelName,
    NsId
  >,
>(
  collection: ModelCollection<TContract, ModelName, NsId>,
  name: string,
  direction: Direction = 'asc',
  allowed?: readonly Allowed[],
): (row: { readonly [K in Allowed]: Orderable }) => OrderByItem {
  const { modelName } = collection;
  const requestedName: unknown = name;
  const requestedDirection: unknown = direction;
  if (typeof requestedDirection !== 'string') {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Cannot order ${modelName}: the direction is not a string`,
      {
        why: `An order direction is "asc" or "desc"; received ${describeReceived(requestedDirection)}.`,
        fix: 'Pass "asc" or "desc".',
        meta: { model: modelName, direction: requestedDirection },
      },
    );
  }
  if (!isOrderByDirection(requestedDirection)) {
    const shownDirection = shown(requestedDirection);
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Cannot order ${modelName} in direction ${shownDirection.text}`,
      {
        why: 'An order direction is "asc" or "desc".',
        fix: `Pass "asc" or "desc".${cutNote('direction', shownDirection)}`,
        meta: { model: modelName, direction: requestedDirection },
      },
    );
  }
  const orderable = orderableFieldNames(collection);
  const allowedNames: readonly string[] = allowed ?? orderable;
  const names = allowedNames.filter((field) => orderable.includes(field));
  const orderByOneOf =
    names.length === 0
      ? `Pass an allowed list that names at least one field of ${modelName} that can be ordered.`
      : `Order by one of: ${names.join(', ')}.`;
  if (typeof requestedName !== 'string') {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Cannot order ${modelName}: the field name is not a string`,
      {
        why: `An order field name is a string; received ${describeReceived(requestedName)}.`,
        fix: orderByOneOf,
        meta: { model: modelName, field: requestedName },
      },
    );
  }
  if (!names.includes(requestedName)) {
    const shownName = shown(requestedName);
    throw ormError('ORM.ARGUMENT_INVALID', `Cannot order ${modelName} by ${shownName.text}`, {
      why: whyNotOrderable(collection, requestedName),
      fix: `${orderByOneOf}${cutNote('name', shownName)}`,
      meta: { model: modelName, field: requestedName },
    });
  }
  const field = blindCast<Allowed, 'checked against the orderable fields and the allowed list'>(
    requestedName,
  );
  return (row) => row[field][requestedDirection]();
}
