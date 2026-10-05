import type { Contract } from '@internal/contract/types';
import type {
  ColumnTypeDescriptor,
  ScalarFieldDeclarationBuilder,
} from '@internal/framework-components/codec';
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
  OrderableFieldNames,
} from './types';

/** A field declared by its codec and nullability, for a scope written without a field builder. */
export interface DeclaredField<
  CodecId extends string = string,
  Nullable extends boolean = boolean,
> {
  readonly codecId: CodecId;
  readonly nullable: Nullable;
}

/** A field builder from the contract DSL, such as `field.text().optional()`, with the codec and nullability it declares. */
export type ScopeFieldBuilder<
  CodecId extends string = string,
  Nullable extends boolean = boolean,
> = ScalarFieldDeclarationBuilder<ColumnTypeDescriptor<CodecId>, Nullable>;

/** The fields a scope for any model needs, each declared with a field builder or a {@link DeclaredField}. */
export type ScopeFieldDeclarations<CodecId extends string = string> = Readonly<
  Record<string, ScopeFieldBuilder<CodecId> | DeclaredField<CodecId>>
>;

type DeclarationField<Declaration> =
  Declaration extends ScopeFieldBuilder<infer Id, infer Nullable>
    ? DeclaredField<Id, Nullable>
    : Declaration extends DeclaredField<infer Id, infer Nullable>
      ? DeclaredField<Id, Nullable>
      : never;

/** The declared fields with each builder read as its codec and nullability. */
export type DeclaredFields<Declarations extends ScopeFieldDeclarations> = {
  readonly [K in keyof Declarations]: DeclarationField<Declarations[K]>;
} extends infer Fields
  ? { readonly [K in keyof Fields]: Fields[K] }
  : never;

/** The model accessor of a scope for any model: only the declared fields, typed by codec. */
export type ScopeModelAccessor<
  TContract extends Contract<SqlStorage>,
  Fields extends Readonly<Record<string, DeclaredField>>,
> = {
  readonly [K in keyof Fields]: Fields[K]['codecId'] extends keyof ExtractCodecTypes<TContract> &
    string
    ? CodecField<TContract, Fields[K]['codecId'], Fields[K]['nullable']>
    : never;
};

export declare const ScopeFactsType: unique symbol;

/** What the body of a scope for any model has established. A flag that is `boolean` is not known; `true` is established. */
export interface ScopeFacts {
  readonly hasWhere: boolean;
  readonly hasOrderBy: boolean;
}

type OrderSelector<Row> = (row: Row) => OrderByItem;

/** The collection the body of a scope for any model receives: the methods that keep the row, on the declared fields, and what has been established so far. */
export interface ScopeCollection<Row, Facts extends ScopeFacts> {
  readonly [ScopeFactsType]: Facts;
  where(
    fn: (row: Row) => WhereArg,
  ): ScopeCollection<Row, { readonly hasWhere: true; readonly hasOrderBy: Facts['hasOrderBy'] }>;
  orderBy(
    selection: OrderSelector<Row> | ReadonlyArray<OrderSelector<Row>>,
  ): ScopeCollection<Row, { readonly hasWhere: Facts['hasWhere']; readonly hasOrderBy: true }>;
  limit(n: number): ScopeCollection<Row, Facts>;
  offset(n: number): ScopeCollection<Row, Facts>;
}

type MismatchedField<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Fields extends Readonly<Record<string, DeclaredField>>,
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

type ModelScopeTarget<
  TContract extends Contract<SqlStorage>,
  Fields extends Readonly<Record<string, DeclaredField>>,
  ModelName extends string,
  NsId extends string,
> = HasState<{ readonly nsId: NsId }> & { readonly modelName: ModelName } & ([
    MismatchedField<TContract, ModelName, NsId, Fields>,
  ] extends [never]
    ? unknown
    : {
        readonly 'the model has no field with the codec and nullability the scope declares': MismatchedField<
          TContract,
          ModelName,
          NsId,
          Fields
        >;
      });

type WithFacts<C, Facts extends ScopeFacts> = Facts['hasOrderBy'] extends true
  ? Ordered<Facts['hasWhere'] extends true ? Filtered<C> : C>
  : Facts['hasWhere'] extends true
    ? Filtered<C>
    : C;

/** A collection of any model, in any namespace, that has the declared fields with the same codec and nullability. For a model that lacks one, the type names the field, so the refusal names it too. */
export type CollectionWithFields<
  TContract extends Contract<SqlStorage>,
  Fields extends Readonly<Record<string, DeclaredField>>,
> = {
  [NsId in keyof TContract['domain']['namespaces'] & string]: {
    [ModelName in keyof TContract['domain']['namespaces'][NsId]['models'] &
      string]: ModelScopeTarget<TContract, Fields, ModelName, NsId>;
  }[keyof TContract['domain']['namespaces'][NsId]['models'] & string];
}[keyof TContract['domain']['namespaces'] & string];

/**
 * A scope made by the client's `scope` method: it accepts a collection of any model that has the declared fields, and returns that collection with what the body established.
 */
export type FieldScope<
  TContract extends Contract<SqlStorage>,
  Fields extends Readonly<Record<string, DeclaredField>>,
  Facts extends ScopeFacts,
> = <C extends CollectionWithFields<TContract, Fields>>(collection: C) => WithFacts<C, Facts>;

function nullability(nullable: boolean): string {
  return nullable ? 'may be null' : 'is never null';
}

function isFieldBuilder(value: object): value is ScopeFieldBuilder {
  return 'build' in value && typeof value.build === 'function';
}

function isFieldSpec(value: object): value is DeclaredField {
  return (
    'codecId' in value &&
    typeof value.codecId === 'string' &&
    'nullable' in value &&
    typeof value.nullable === 'boolean'
  );
}

const FIELD_DECLARATION_FIX =
  'Declare each field with a field builder, such as field.temporal.timestamptz().optional(), or with { codecId, nullable }.';

function declaredFieldSpec(name: string, declaration: unknown): DeclaredField {
  if (typeof declaration === 'object' && declaration !== null && isFieldBuilder(declaration)) {
    const built: unknown = declaration.build();
    const descriptor =
      typeof built === 'object' && built !== null && 'descriptor' in built
        ? built.descriptor
        : undefined;
    const nullable =
      typeof built === 'object' && built !== null && 'nullable' in built
        ? built.nullable
        : undefined;
    if (
      typeof descriptor !== 'object' ||
      descriptor === null ||
      !('codecId' in descriptor) ||
      typeof descriptor.codecId !== 'string' ||
      typeof nullable !== 'boolean'
    ) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `Cannot define the scope: the field builder for ${name} names no column type`,
        {
          why: 'A scope for any model matches each declared field by its codec and nullability, and this builder refers to a named type instead of a column type.',
          fix: 'Declare the field with a builder that has a column type, such as field.text() or field.column(textColumn), or with { codecId, nullable }.',
          meta: { field: name },
        },
      );
    }
    return { codecId: descriptor.codecId, nullable };
  }
  if (typeof declaration === 'object' && declaration !== null && isFieldSpec(declaration)) {
    return { codecId: declaration.codecId, nullable: declaration.nullable };
  }
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `Cannot define the scope: the declaration of field ${name} is not a field builder or { codecId, nullable }`,
    {
      why: `Each field of a scope is declared with a field builder or with an object that has a string codecId and a boolean nullable; received ${describeReceived(declaration)} for ${name}.`,
      fix: FIELD_DECLARATION_FIX,
      meta: { field: name },
    },
  );
}

function declaredFieldSpecs(
  declarations: unknown,
): ReadonlyArray<readonly [string, DeclaredField]> {
  if (typeof declarations !== 'object' || declarations === null || Array.isArray(declarations)) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'Cannot define the scope: the fields are not an object',
      {
        why: `The first argument of scope maps the name of each field the scope needs to its declaration; received ${describeReceived(declarations)}.`,
        fix: FIELD_DECLARATION_FIX,
        meta: { argument: 'fields' },
      },
    );
  }
  return Object.entries(declarations).map(([name, declaration]) => [
    name,
    declaredFieldSpec(name, declaration),
  ]);
}

/** Throws `ORM.ARGUMENT_INVALID` unless `body`, the body of a scope, is a function. */
export function assertScopeBody(body: unknown): void {
  if (typeof body !== 'function') {
    throw ormError('ORM.ARGUMENT_INVALID', 'Cannot define the scope: the body is not a function', {
      why: `The body of a scope is a function that receives a collection and returns one; received ${describeReceived(body)}.`,
      fix: 'Pass a function, such as (rows) => rows.where(...).',
      meta: { argument: 'body' },
    });
  }
}

function isModelCollection(value: unknown): value is RuntimeModelCollection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ctx' in value &&
    typeof value.ctx === 'object' &&
    value.ctx !== null &&
    'modelName' in value &&
    typeof value.modelName === 'string' &&
    'namespaceId' in value &&
    typeof value.namespaceId === 'string'
  );
}

/** Throws `ORM.ARGUMENT_INVALID` unless `value`, what a scope is applied to, is a collection. */
export function assertScopeReceiver(value: unknown): asserts value is RuntimeModelCollection {
  if (!isModelCollection(value)) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'Cannot apply the scope: it was not given a collection',
      {
        why: `A scope is applied to a collection, such as db.orm.public.Post; received ${describeReceived(value)}.`,
        fix: 'Run the scope with apply on a collection: collection.apply(scope).',
        meta: { argument: 'collection' },
      },
    );
  }
}

/** Throws `ORM.ARGUMENT_INVALID` unless `value` is a collection of the model and namespace a scope for one model was made from. */
export function assertModelScopeReceiver(
  source: { readonly modelName: string; readonly namespaceId: string },
  value: unknown,
): void {
  assertScopeReceiver(value);
  if (value.modelName !== source.modelName || value.namespaceId !== source.namespaceId) {
    const made = `${source.namespaceId}.${source.modelName}`;
    const given = `${value.namespaceId}.${value.modelName}`;
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Cannot apply a scope for ${made} to a collection of ${given}`,
      {
        why: `The scope was made with ${made}.scope(...), and its body was written for that model.`,
        fix: `Apply the scope to a collection of ${made}, or make a scope from ${given}.`,
        meta: {
          model: source.modelName,
          namespace: source.namespaceId,
          receivedModel: value.modelName,
          receivedNamespace: value.namespaceId,
        },
      },
    );
  }
}

/** The model as error messages name it: with its namespace when the contract has more than one. */
export function modelLabel(collection: RuntimeModelCollection): string {
  const namespaces = Object.keys(collection.ctx.context.contract.domain.namespaces);
  return namespaces.length > 1
    ? `${collection.namespaceId}.${collection.modelName}`
    : collection.modelName;
}

/** Throws `ORM.ARGUMENT_INVALID` unless `result`, what a scope's body returned, is a collection of the receiver's model, namespace and class. */
export function assertScopeResult(receiver: RuntimeModelCollection, result: unknown): void {
  const sameCollection =
    isModelCollection(result) &&
    result.modelName === receiver.modelName &&
    result.namespaceId === receiver.namespaceId &&
    result instanceof receiver.constructor;
  if (!sameCollection) {
    const label = modelLabel(receiver);
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Cannot apply the scope to ${label}: its body did not return a collection of ${label}`,
      {
        why: `The body of a scope for any model returns the collection it received, after where, orderBy, limit or offset; it returned ${isModelCollection(result) ? `a collection of ${modelLabel(result)}` : describeReceived(result)}.`,
        fix: 'Return the collection the body receives, or one made from it by calling its methods.',
        meta: {
          model: receiver.modelName,
          namespace: receiver.namespaceId,
          returned: isModelCollection(result) ? result.modelName : describeReceived(result),
        },
      },
    );
  }
}

function assertScopeFields(
  collection: RuntimeModelCollection,
  fields: ReadonlyArray<readonly [string, DeclaredField]>,
): void {
  const { contract } = collection.ctx.context;
  const { modelName, namespaceId } = collection;
  const label = modelLabel(collection);
  const model = modelOf(contract, namespaceId, modelName);
  for (const [name, spec] of fields) {
    const declared = `The scope was declared for models that have a field ${name} with codec ${spec.codecId} that ${nullability(spec.nullable)}.`;
    const meta = {
      model: modelName,
      namespace: namespaceId,
      field: name,
      codecId: spec.codecId,
      nullable: spec.nullable,
    };
    if (!Object.hasOwn(model?.fields ?? {}, name)) {
      throw ormError(
        'ORM.FIELD_UNKNOWN',
        `Cannot apply a scope to ${label}: it has no field ${name}`,
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
          ? `${label}.${name} has no column.`
          : `${label}.${name} has codec ${column.codecId} and ${nullability(column.nullable)}.`;
      throw ormError(
        'ORM.FIELD_UNKNOWN',
        `Cannot apply a scope to ${label}: its field ${name} does not match the declaration`,
        {
          why: `${declared} ${actual}`,
          fix: `Apply the scope to a model whose ${name} field has that codec and nullability, or change the declaration in the scope.`,
          meta,
        },
      );
    }
  }
}

/**
 * Define a scope for any model that has the declared fields. Reached as the `scope` method of the client `orm()` returns.
 */
export function defineFieldScope<
  TContract extends Contract<SqlStorage>,
  const Declarations extends ScopeFieldDeclarations,
  Facts extends ScopeFacts,
>(
  declarations: Declarations,
  body: (
    rows: ScopeCollection<ScopeModelAccessor<TContract, DeclaredFields<Declarations>>, ScopeFacts>,
  ) => ScopeCollection<ScopeModelAccessor<TContract, DeclaredFields<Declarations>>, Facts>,
): FieldScope<TContract, DeclaredFields<Declarations>, Facts> {
  const fields = declaredFieldSpecs(declarations);
  assertScopeBody(body);
  return (collection) => {
    const receiver: unknown = collection;
    assertScopeReceiver(receiver);
    assertScopeFields(receiver, fields);
    const result: unknown = body(
      blindCast<
        ScopeCollection<ScopeModelAccessor<TContract, DeclaredFields<Declarations>>, ScopeFacts>,
        'a collection offers where, orderBy, limit and offset with these run-time shapes'
      >(collection),
    );
    assertScopeResult(receiver, result);
    return blindCast<
      WithFacts<typeof collection, Facts>,
      "checked above: a collection of the receiver's model, namespace and class, with the facts the body established"
    >(result);
  };
}

export interface ModelCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
> {
  readonly ctx: { readonly context: ExecutionContext<TContract> };
  readonly modelName: ModelName;
  readonly namespaceId: NsId;
  readonly tableName: string;
}

export type RuntimeModelCollection = ModelCollection<Contract<SqlStorage>, string, string>;

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
 * An `orderBy` selector for a field named by a string, such as an order parameter of a request. `allowed` lists the fields a request may order by. A name that is not in `allowed` or not an orderable field of the collection's model, and a direction other than `asc` or `desc`, throw `ORM.ARGUMENT_INVALID`. An undefined direction is `asc`.
 *
 * ```ts
 * db.Post.orderBy(orderByField(db.Post, input.orderBy, input.direction, ['title', 'createdAt']));
 * ```
 */
export function orderByField<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  const Allowed extends OrderableFieldNames<TContract, ModelName, NsId>,
  NsId extends string = never,
>(
  collection: ModelCollection<TContract, ModelName, NsId>,
  name: string,
  direction: string | undefined,
  allowed: readonly [Allowed, ...Allowed[]],
): (row: { readonly [K in Allowed]: Orderable }) => OrderByItem {
  const receiver: unknown = collection;
  if (!isModelCollection(receiver)) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'Cannot order: orderByField was not given a collection',
      {
        why: `orderByField takes the collection it orders, such as db.orm.public.Post; received ${describeReceived(receiver)}.`,
        fix: 'Pass the collection the selector is for as the first argument.',
        meta: { argument: 'collection' },
      },
    );
  }
  const { modelName } = collection;
  const requestedName: unknown = name;
  const requestedDirection: unknown = direction === undefined ? 'asc' : direction;
  const allowedList: unknown = allowed;
  if (!Array.isArray(allowedList) || allowedList.some((field) => typeof field !== 'string')) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Cannot order ${modelName}: the allowed fields are not a list of names`,
      {
        why: `orderByField takes the list of fields a request may order by; received ${describeReceived(allowedList)}.`,
        fix: `Pass an array of field names of ${modelName}, such as ['title', 'createdAt'].`,
        meta: { model: modelName, argument: 'allowed' },
      },
    );
  }
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
  const allowedNames: readonly string[] = allowedList;
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
  const order: Direction = requestedDirection;
  return (row) => row[field][order]();
}
