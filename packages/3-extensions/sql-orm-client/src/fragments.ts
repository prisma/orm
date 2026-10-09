import type { Contract } from '@internal/contract/types';
import type {
  CodecDescriptorRef,
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
import { getModelFields, modelOf } from './collection-contract';
import type { Filtered, HasTypeState, Ordered } from './collection-types';
import { hasTrait, resolveColumn } from './column-codec';
import { ormError } from './orm-errors';
import type {
  CodecField,
  CodecListField,
  FieldCodecId,
  FieldNullable,
  FieldsOf,
  Orderable,
  OrderableFieldNames,
} from './types';

type FieldMultiplicity = false | { readonly elementNullable: boolean };

/** A field declared by its codec and nullability, for a fragment written without a field builder. `many` declares a list field as a contract field records one: `{ elementNullable: false }`, or `{ elementNullable: true }` when its elements may be null. */
export interface DeclaredField<
  CodecId extends string = string,
  Nullable extends boolean = boolean,
  Many extends FieldMultiplicity = false,
> {
  readonly codecId: CodecId;
  readonly nullable: Nullable;
  readonly many?: Many | undefined;
}

type AnyDeclaredField = DeclaredField<string, boolean, FieldMultiplicity>;

type MultiplicityOf<Many> = Many extends {
  readonly elementNullable: infer ElementNullable extends boolean;
}
  ? { readonly elementNullable: ElementNullable }
  : false;

type DeclaredMultiplicity<Field> = Field extends { readonly many?: false | undefined }
  ? false
  : Field extends { readonly many?: infer Many }
    ? MultiplicityOf<Exclude<Many, undefined>>
    : false;

type BuiltMultiplicity<Builder> = Builder extends { build(): infer Built }
  ? DeclaredMultiplicity<Built>
  : false;

/** A field builder from the contract DSL, such as `field.text().optional()`, with the codec and nullability it declares. */
export type DeclaredFieldsFragmentFieldBuilder<
  CodecId extends string = string,
  Nullable extends boolean = boolean,
> = ScalarFieldDeclarationBuilder<CodecDescriptorRef<CodecId>, Nullable>;

/** The fields a fragment for any model needs, each declared with a field builder or a {@link DeclaredField}. */
export type DeclaredFieldsFragmentFieldDeclarations<CodecId extends string = string> = Readonly<
  Record<
    string,
    DeclaredFieldsFragmentFieldBuilder<CodecId> | DeclaredField<CodecId, boolean, FieldMultiplicity>
  >
>;

type DeclarationField<Declaration> =
  Declaration extends DeclaredFieldsFragmentFieldBuilder<infer Id, infer Nullable>
    ? DeclaredField<Id, Nullable, BuiltMultiplicity<Declaration>>
    : Declaration extends DeclaredField<infer Id, infer Nullable, FieldMultiplicity>
      ? DeclaredField<Id, Nullable, DeclaredMultiplicity<Declaration>>
      : never;

/** The declared fields with each builder read as its codec and nullability. */
export type DeclaredFields<Declarations extends DeclaredFieldsFragmentFieldDeclarations> = {
  readonly [K in keyof Declarations]: DeclarationField<Declarations[K]>;
} extends infer Fields
  ? { readonly [K in keyof Fields]: Fields[K] }
  : never;

/** The model accessor of a fragment for any model: only the declared fields, typed by codec. */
export type DeclaredFieldsFragmentModelAccessor<
  TContract extends Contract<SqlStorage>,
  Fields extends Readonly<Record<string, AnyDeclaredField>>,
> = {
  readonly [K in keyof Fields]: Fields[K]['codecId'] extends keyof ExtractCodecTypes<TContract> &
    string
    ? DeclaredMultiplicity<Fields[K]> extends {
        readonly elementNullable: infer ElementNullable extends boolean;
      }
      ? CodecListField<TContract, Fields[K]['codecId'], Fields[K]['nullable'], ElementNullable>
      : CodecField<TContract, Fields[K]['codecId'], Fields[K]['nullable']>
    : never;
};

export declare const FragmentFactsType: unique symbol;

/** What the body of a fragment for any model has established. A flag that is `boolean` is not known; `true` is established. */
export interface FragmentFacts {
  readonly hasWhere: boolean;
  readonly hasOrderBy: boolean;
}

type OrderSelector<Row> = (row: Row) => OrderByItem;

/** The collection the body of a fragment for any model receives: the methods that keep the row, on the declared fields, and what has been established so far. */
export interface DeclaredFieldsFragmentCollection<Row, Facts extends FragmentFacts> {
  readonly [FragmentFactsType]: Facts;
  where(
    fn: (row: Row) => WhereArg,
  ): DeclaredFieldsFragmentCollection<
    Row,
    { readonly hasWhere: true; readonly hasOrderBy: Facts['hasOrderBy'] }
  >;
  orderBy(
    selection: OrderSelector<Row> | ReadonlyArray<OrderSelector<Row>>,
  ): DeclaredFieldsFragmentCollection<
    Row,
    { readonly hasWhere: Facts['hasWhere']; readonly hasOrderBy: true }
  >;
  limit(n: number): DeclaredFieldsFragmentCollection<Row, Facts>;
  offset(n: number): DeclaredFieldsFragmentCollection<Row, Facts>;
}

type ContractFieldMultiplicity<Field> = Field extends { readonly many: infer Many }
  ? MultiplicityOf<Many>
  : false;

/** The declared fields that the model lacks, or has with another codec or nullability, as a list where the declaration has one value or the reverse, or as a list whose elements differ in nullability from the declared ones. For a union of models, the fields any of them lacks. */
export type MissingDeclaredFieldsFragmentFields<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Fields extends Readonly<Record<string, AnyDeclaredField>>,
> = ModelName extends string
  ? {
      [K in keyof Fields & string]: K extends keyof FieldsOf<TContract, ModelName, NsId>
        ? [
            FieldCodecId<TContract, ModelName, K, NsId>,
            FieldNullable<TContract, ModelName, K, NsId>,
            ContractFieldMultiplicity<FieldsOf<TContract, ModelName, NsId>[K]>,
          ] extends [Fields[K]['codecId'], Fields[K]['nullable'], DeclaredMultiplicity<Fields[K]>]
          ? [Fields[K]['codecId'], Fields[K]['nullable'], DeclaredMultiplicity<Fields[K]>] extends [
              FieldCodecId<TContract, ModelName, K, NsId>,
              FieldNullable<TContract, ModelName, K, NsId>,
              ContractFieldMultiplicity<FieldsOf<TContract, ModelName, NsId>[K]>,
            ]
            ? never
            : K
          : K
        : K;
    }[keyof Fields & string]
  : never;

/** What a fragment for any model requires of its receiver beyond the collection's own members: nothing when the model has the declared fields, otherwise a property whose name says why it is refused. */
export type DeclaredFieldsFragmentFieldsCheck<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
  Fields extends Readonly<Record<string, AnyDeclaredField>>,
> = string extends ModelName
  ? { readonly 'the fragment could not read the model of the collection from its type': ModelName }
  : [MissingDeclaredFieldsFragmentFields<TContract, ModelName, NsId, Fields>] extends [never]
    ? unknown
    : {
        readonly 'the model has no field that matches the declaration in the fragment': MissingDeclaredFieldsFragmentFields<
          TContract,
          ModelName,
          NsId,
          Fields
        >;
      };

/** A collection plus the filter and order a fragment's body established. */
export type WithFacts<C, Facts extends FragmentFacts> = Facts['hasOrderBy'] extends true
  ? Ordered<Facts['hasWhere'] extends true ? Filtered<C> : C>
  : Facts['hasWhere'] extends true
    ? Filtered<C>
    : C;

/**
 * A fragment made by the client's `fragment` method: it accepts a collection of any model that has the declared fields, checked against the collection's own contract, model and namespace, and returns that collection with what the body established. `with` reads the result from the receiver's type and the fragment's facts.
 */
export interface DeclaredFieldsFragment<
  TContract extends Contract<SqlStorage>,
  Fields extends Readonly<Record<string, AnyDeclaredField>>,
  Facts extends FragmentFacts,
> {
  <
    C,
    ModelName extends string,
    ReceiverContract extends Contract<SqlStorage> = TContract,
    NsId extends string = never,
  >(
    collection: C &
      HasTypeState<{ readonly nsId: NsId }> & {
        readonly modelName: ModelName;
        readonly ctx: { readonly context: { readonly contract: ReceiverContract } };
      } & DeclaredFieldsFragmentFieldsCheck<ReceiverContract, ModelName, NsId, Fields>,
  ): WithFacts<C, Facts>;
  readonly [FragmentFactsType]: Facts;
}

function nullability(nullable: boolean): string {
  return nullable ? 'may be null' : 'is never null';
}

function isFieldBuilder(value: object): value is DeclaredFieldsFragmentFieldBuilder {
  return 'build' in value && typeof value.build === 'function';
}

interface FieldSpec {
  readonly codecId: string;
  readonly nullable: boolean;
  readonly many: FieldMultiplicity;
}

function isListMultiplicity(value: unknown): value is { readonly elementNullable: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'elementNullable' in value &&
    typeof value.elementNullable === 'boolean'
  );
}

function isMultiplicity(value: unknown): value is FieldMultiplicity | undefined {
  return value === undefined || value === false || isListMultiplicity(value);
}

function isFieldSpec(value: object): value is AnyDeclaredField {
  return (
    'codecId' in value &&
    typeof value.codecId === 'string' &&
    'nullable' in value &&
    typeof value.nullable === 'boolean' &&
    (!('many' in value) || isMultiplicity(value.many))
  );
}

function multiplicity(many: unknown): FieldMultiplicity {
  return isListMultiplicity(many) ? { elementNullable: many.elementNullable } : false;
}

const FIELD_DECLARATION_FIX =
  'Declare each field with a field builder, such as field.temporal.timestamptz().optional(), or with { codecId, nullable }. Declare a list with .many() or many: { elementNullable: false }, or, when its elements may be null, with .many({ elementsNullable: true }) or many: { elementNullable: true }.';

function declaredFieldSpec(name: string, declaration: unknown): FieldSpec {
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
        `Cannot define the fragment: the field builder for ${name} names no column type`,
        {
          why: 'A fragment for any model matches each declared field by its codec and nullability, and this builder refers to a named type instead of a column type.',
          fix: 'Declare the field with a builder that has a column type, such as field.text() or field.column(textColumn), or with { codecId, nullable }.',
          meta: { field: name },
        },
      );
    }
    const many = typeof built === 'object' && built !== null && 'many' in built && built.many;
    if (!isMultiplicity(many)) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `Cannot define the fragment: the field builder for ${name} builds a many that is not false or { elementNullable }`,
        {
          why: `A field builder's build() returns many as false or undefined for one value, or as { elementNullable } with a boolean elementNullable for a list; received ${describeReceived(many)} for ${name}.`,
          fix: FIELD_DECLARATION_FIX,
          meta: { field: name },
        },
      );
    }
    return { codecId: descriptor.codecId, nullable, many: multiplicity(many) };
  }
  if (typeof declaration === 'object' && declaration !== null && isFieldSpec(declaration)) {
    return {
      codecId: declaration.codecId,
      nullable: declaration.nullable,
      many: multiplicity(declaration.many),
    };
  }
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `Cannot define the fragment: the declaration of field ${name} is not a field builder or { codecId, nullable }`,
    {
      why: `Each field of a fragment is declared with a field builder or with an object that has a string codecId, a boolean nullable and, for a list, many: { elementNullable } with a boolean elementNullable; received ${describeReceived(declaration)} for ${name}.`,
      fix: FIELD_DECLARATION_FIX,
      meta: { field: name },
    },
  );
}

function declaredFieldSpecs(declarations: unknown): ReadonlyArray<readonly [string, FieldSpec]> {
  if (typeof declarations !== 'object' || declarations === null || Array.isArray(declarations)) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'Cannot define the fragment: the fields are not an object',
      {
        why: `The first argument of fragment maps the name of each field the fragment needs to its declaration; received ${describeReceived(declarations)}.`,
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

/** Throws `ORM.ARGUMENT_INVALID` unless `body`, the body of a fragment, is a function. */
export function assertFragmentBody(body: unknown): void {
  if (typeof body !== 'function') {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'Cannot define the fragment: the body is not a function',
      {
        why: `The body of a fragment is a function that receives a collection and returns one; received ${describeReceived(body)}.`,
        fix: 'Pass a function, such as (rows) => rows.where(...).',
        meta: { argument: 'body' },
      },
    );
  }
}

function hasContract(ctx: object): boolean {
  return (
    'context' in ctx &&
    typeof ctx.context === 'object' &&
    ctx.context !== null &&
    'contract' in ctx.context &&
    typeof ctx.context.contract === 'object' &&
    ctx.context.contract !== null
  );
}

function isModelCollection(value: unknown): value is RuntimeModelCollection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ctx' in value &&
    typeof value.ctx === 'object' &&
    value.ctx !== null &&
    hasContract(value.ctx) &&
    'modelName' in value &&
    typeof value.modelName === 'string' &&
    'namespaceId' in value &&
    typeof value.namespaceId === 'string'
  );
}

/** Throws `ORM.ARGUMENT_INVALID` unless `value`, what a fragment is applied to, is a collection. */
export function assertFragmentReceiver(value: unknown): asserts value is RuntimeModelCollection {
  if (!isModelCollection(value)) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'Cannot apply the fragment: it was not given a collection',
      {
        why: `A fragment is applied to a collection, such as db.orm.public.Post; received ${describeReceived(value)}.`,
        fix: 'Pass the fragment to with on a collection: collection.with(fragment).',
        meta: { argument: 'collection' },
      },
    );
  }
}

/** Throws `ORM.ARGUMENT_INVALID` unless `value` is a collection of the model and namespace a fragment for one model was made from. */
export function assertModelFragmentReceiver(
  source: { readonly modelName: string; readonly namespaceId: string },
  value: unknown,
): void {
  assertFragmentReceiver(value);
  if (value.modelName !== source.modelName || value.namespaceId !== source.namespaceId) {
    const made = `${source.namespaceId}.${source.modelName}`;
    const given = `${value.namespaceId}.${value.modelName}`;
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Cannot apply a fragment for ${made} to a collection of ${given}`,
      {
        why: `The fragment was made with ${made}.fragment(...), and its body was written for that model.`,
        fix: `Apply the fragment to a collection of ${made}, or make a fragment from ${given}.`,
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

/** Throws `ORM.ARGUMENT_INVALID` unless `result`, what a fragment's body returned, is a collection of the receiver's model, namespace and class. */
export function assertDeclaredFieldsFragmentResult(
  receiver: RuntimeModelCollection,
  result: unknown,
): void {
  const sameCollection =
    isModelCollection(result) &&
    result.modelName === receiver.modelName &&
    result.namespaceId === receiver.namespaceId &&
    result instanceof receiver.constructor;
  if (!sameCollection) {
    const label = modelLabel(receiver);
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `Cannot apply the fragment to ${label}: its body did not return a collection of ${label}`,
      {
        why: `The body of a fragment for any model returns the collection it received, after where, orderBy, limit or offset; it returned ${isModelCollection(result) ? `a collection of ${modelLabel(result)}` : describeReceived(result)}.`,
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

function elementNullability(elementNullable: boolean): string {
  return elementNullable ? 'may be null' : 'are never null';
}

function sameMultiplicity(a: FieldMultiplicity, b: FieldMultiplicity): boolean {
  return a === false || b === false ? a === b : a.elementNullable === b.elementNullable;
}

function fieldShape(many: FieldMultiplicity): string {
  return many === false
    ? 'holds one value'
    : `is a list whose elements ${elementNullability(many.elementNullable)}`;
}

function declarationFor(many: FieldMultiplicity): string {
  if (many === false) return 'as one value, without .many() or many';
  return many.elementNullable
    ? 'as a list whose elements may be null, with .many({ elementsNullable: true }) or many: { elementNullable: true }'
    : 'as a list whose elements are never null, with .many() or many: { elementNullable: false }';
}

function describeField(field: {
  readonly codecId: string;
  readonly nullable: boolean;
  readonly many: FieldMultiplicity;
}): string {
  const value = `with codec ${field.codecId} that ${nullability(field.nullable)}`;
  return field.many === false
    ? value
    : `${value} and whose elements ${elementNullability(field.many.elementNullable)}`;
}

function assertDeclaredFieldsFragmentFields(
  collection: RuntimeModelCollection,
  fields: ReadonlyArray<readonly [string, FieldSpec]>,
): void {
  const { contract } = collection.ctx.context;
  const { modelName, namespaceId } = collection;
  const label = modelLabel(collection);
  const modelFields = getModelFields(contract, namespaceId, modelName);
  for (const [name, spec] of fields) {
    const declared = `The fragment was declared for models that have a ${spec.many === false ? 'field' : 'list field'} ${name} ${describeField(spec)}.`;
    const meta = {
      model: modelName,
      namespace: namespaceId,
      field: name,
      codecId: spec.codecId,
      nullable: spec.nullable,
      many: spec.many,
    };
    const fieldColumn = Object.hasOwn(modelFields, name) ? modelFields[name] : undefined;
    if (fieldColumn === undefined) {
      throw ormError(
        'ORM.FIELD_UNKNOWN',
        `Cannot apply a fragment to ${label}: it has no field ${name}`,
        {
          why: declared,
          fix: `Apply the fragment to a model that has a field ${name}, or remove ${name} from the declaration in the fragment.`,
          meta,
        },
      );
    }
    const fieldMany = multiplicity(domainFieldOf(contract, namespaceId, modelName, name)?.many);
    const column = resolveColumn(contract, namespaceId, fieldColumn.table, fieldColumn.column);
    const actual =
      column === undefined
        ? `${label}.${name} has no column.`
        : fieldMany === false
          ? `${label}.${name} has codec ${column.codecId} and ${nullability(column.nullable)}.`
          : `${label}.${name} is a list ${describeField({ codecId: column.codecId, nullable: column.nullable, many: fieldMany })}.`;
    const sameCodecAndNullability =
      column?.codecId === spec.codecId && column.nullable === spec.nullable;
    if (!sameCodecAndNullability || !sameMultiplicity(fieldMany, spec.many)) {
      throw ormError(
        'ORM.FIELD_UNKNOWN',
        `Cannot apply a fragment to ${label}: its field ${name} does not match the declaration`,
        {
          why: `${declared} ${actual}`,
          fix: sameCodecAndNullability
            ? `Apply the fragment to a model whose ${name} field ${fieldShape(spec.many)}, or declare ${name} ${declarationFor(fieldMany)}.`
            : `Apply the fragment to a model whose ${name} field has that codec and nullability, or change the declaration in the fragment.`,
          meta,
        },
      );
    }
  }
}

/**
 * Define a fragment for any model that has the declared fields. Reached as the `fragment` method of the client `orm()` returns.
 */
export function defineDeclaredFieldsFragment<
  TContract extends Contract<SqlStorage>,
  const Declarations extends DeclaredFieldsFragmentFieldDeclarations,
  Facts extends FragmentFacts,
>(
  declarations: Declarations,
  body: (
    rows: DeclaredFieldsFragmentCollection<
      DeclaredFieldsFragmentModelAccessor<TContract, DeclaredFields<Declarations>>,
      FragmentFacts
    >,
  ) => DeclaredFieldsFragmentCollection<
    DeclaredFieldsFragmentModelAccessor<TContract, DeclaredFields<Declarations>>,
    Facts
  >,
): DeclaredFieldsFragment<TContract, DeclaredFields<Declarations>, Facts> {
  const fields = declaredFieldSpecs(declarations);
  assertFragmentBody(body);
  return blindCast<
    DeclaredFieldsFragment<TContract, DeclaredFields<Declarations>, Facts>,
    'the facts are a declared property that exists only in the type'
  >((collection: unknown) => {
    const receiver: unknown = collection;
    assertFragmentReceiver(receiver);
    assertDeclaredFieldsFragmentFields(receiver, fields);
    const result: unknown = body(
      blindCast<
        DeclaredFieldsFragmentCollection<
          DeclaredFieldsFragmentModelAccessor<TContract, DeclaredFields<Declarations>>,
          FragmentFacts
        >,
        'a collection offers where, orderBy, limit and offset with these run-time shapes'
      >(collection),
    );
    assertDeclaredFieldsFragmentResult(receiver, result);
    return result;
  });
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
  const modelFields = getModelFields(contract, collection.namespaceId, collection.modelName);
  const fieldColumn = Object.hasOwn(modelFields, field) ? modelFields[field] : undefined;
  if (fieldColumn === undefined) return undefined;
  return resolveColumn(contract, collection.namespaceId, fieldColumn.table, fieldColumn.column)
    ?.codecId;
}

/** The domain declaration of a model's own or inherited field. */
function domainFieldOf(
  contract: RuntimeModelCollection['ctx']['context']['contract'],
  namespaceId: string,
  modelName: string,
  name: string,
): { readonly many?: unknown } | undefined {
  let model = modelOf(contract, namespaceId, modelName);
  while (model !== undefined) {
    const fields = model.fields ?? {};
    if (Object.hasOwn(fields, name)) return fields[name];
    const base = model.base;
    model = base === undefined ? undefined : modelOf(contract, base.namespace, base.model);
  }
  return undefined;
}

function canOrder(collection: RuntimeModelCollection, field: string): boolean {
  const codecId = fieldCodecId(collection, field);
  return codecId !== undefined && hasTrait(collection.ctx.context, codecId, 'order');
}

function orderableFieldNames(collection: RuntimeModelCollection): readonly string[] {
  const modelFields = getModelFields(
    collection.ctx.context.contract,
    collection.namespaceId,
    collection.modelName,
  );
  return Object.keys(modelFields).filter((field) => canOrder(collection, field));
}

function whyNotOrderable(collection: RuntimeModelCollection, name: string): string {
  const { modelName } = collection;
  const model = modelOf(collection.ctx.context.contract, collection.namespaceId, modelName);
  const quoted = shown(name).text;
  if (Object.hasOwn(model?.relations ?? {}, name)) {
    return `${quoted} is a relation of ${modelName}, not a field.`;
  }
  if (
    !Object.hasOwn(
      getModelFields(collection.ctx.context.contract, collection.namespaceId, modelName),
      name,
    )
  ) {
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
