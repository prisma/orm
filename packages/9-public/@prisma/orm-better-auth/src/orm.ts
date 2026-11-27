import type { Condition, OrmFunctionsOf } from '@prisma/orm-family-sql/orm-client';
import type { CodecTypesBase } from '@prisma/orm-family-sql/relational-core/expression';
import { blindCast } from '@prisma/orm-framework/utils/casts';

export type Row = Record<string, unknown>;

/** The `fns` of a `where` callback, for a contract whose codec and query-operation types are not known here. */
export type WhereFunctions = OrmFunctionsOf<CodecTypesBase, Record<never, never>>;

export interface WhereTools {
  readonly fns: WhereFunctions;
}

/** The model accessor a `where` or `orderBy` callback receives. Its properties are the model's fields. */
export type ModelAccessor = object;

/**
 * The part of an ORM client collection the adapter calls. The adapter reaches collections by run-time model name, so their contract types are not known here.
 */
export interface OrmCollection {
  where(filter: (model: ModelAccessor, tools: WhereTools) => Condition): OrmCollection;
  select(...fields: string[]): OrmCollection;
  orderBy(selector: (model: ModelAccessor) => unknown): OrmCollection;
  limit(count: number): OrmCollection;
  offset(count: number): OrmCollection;
  include(relation: string, refine?: (related: OrmCollection) => OrmCollection): OrmCollection;
  first(): Promise<Row | null>;
  all(): PromiseLike<Row[]>;
  aggregate(
    build: (aggregates: { count(): unknown }) => Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  create(data: Row): Promise<Row>;
  update(data: Row): Promise<Row | null>;
  updateAndCount(data: Row): Promise<number>;
  deleteAndCount(): Promise<number>;
}

const collectionMethods = [
  'where',
  'select',
  'orderBy',
  'limit',
  'offset',
  'include',
  'first',
  'all',
  'aggregate',
  'create',
  'update',
  'updateAndCount',
  'deleteAndCount',
] as const satisfies readonly (keyof OrmCollection)[];

export function isOrmCollection(value: unknown): value is OrmCollection {
  return (
    typeof value === 'object' &&
    value !== null &&
    collectionMethods.every((method) => typeof Reflect.get(value, method) === 'function')
  );
}

/** A property of an ORM client proxy, read by run-time name. */
export function property(target: unknown, name: string): unknown {
  return typeof target === 'object' && target !== null ? Reflect.get(target, name) : undefined;
}

/** Calls a method of an ORM client object by run-time name, or returns `undefined` when it has none. */
export function callMethod(target: unknown, name: string, ...args: unknown[]): unknown {
  const method = property(target, name);
  if (typeof method !== 'function') return undefined;
  return Reflect.apply(method, target, args);
}

export function hasMethod(target: unknown, name: string): boolean {
  return typeof property(target, name) === 'function';
}

/** A filter built by calling the ORM client's field and `fns` methods by run-time name. */
export function asCondition(value: unknown): Condition {
  return blindCast<
    Condition,
    'field and fns methods are called by run-time name, so their filter results arrive untyped; each comes from an ORM client method that returns a filter'
  >(value);
}
