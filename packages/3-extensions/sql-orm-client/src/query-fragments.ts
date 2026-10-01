import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type Direction,
  isOrderByDirection,
  type OrderByItem,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import type { Collection } from './collection';
import { modelOf, resolveFieldToColumn } from './collection-contract';
import type { HasRow, HasState, Step } from './collection-types';
import { hasTrait, resolveColumn } from './column-codec';
import { ormError } from './orm-errors';
import type {
  CollectionModelName,
  DefaultModelRow,
  IsUnion,
  Orderable,
  OrderableFieldName,
} from './types';

type OneModelName<TContract extends Contract<SqlStorage>, ModelName> =
  IsUnion<ModelName> extends true
    ? 'modelStep takes one model name, not a union of names'
    : CollectionModelName<TContract>;

/**
 * A collection of `ModelName` that neither `select` nor `variant` has narrowed: its rows have every field of the model, and it is not narrowed to a variant.
 */
export interface UnnarrowedCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends CollectionModelName<TContract>,
> extends HasRow<DefaultModelRow<TContract, ModelName>>,
    HasState<{ readonly variantName: undefined }> {
  readonly modelName: ModelName;
}

/** A step made by `modelStep`: it takes an unnarrowed collection of the model and returns the body's result. */
export type ModelStep<
  TContract extends Contract<SqlStorage>,
  ModelName extends CollectionModelName<TContract>,
  Result,
> = Step<UnnarrowedCollection<TContract, ModelName>, Result>;

/**
 * Define a step for one model that may change the row, such as a shared `select` and `include`. The body is typed once against the model's plain collection; the step accepts any collection of that model that `select` and `variant` have not narrowed.
 *
 * ```ts
 * const summary = modelStep<Contract, 'Post'>()((posts) => posts.select('id', 'title').include('user'));
 * db.User.include('posts', (posts) => posts.pipe(summary));
 * ```
 */
export function modelStep<
  TContract extends Contract<SqlStorage>,
  ModelName extends OneModelName<TContract, ModelName>,
>() {
  return <Result>(
    body: Step<Collection<TContract, ModelName>, Result>,
  ): ModelStep<TContract, ModelName, Result> =>
    (collection) =>
      body(
        blindCast<
          Collection<TContract, ModelName>,
          'an unnarrowed collection of this model has the methods of its plain collection'
        >(collection),
      );
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
