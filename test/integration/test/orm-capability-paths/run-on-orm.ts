import fc from 'fast-check';
import {
  type Command,
  type Filter,
  type IncludeTree,
  type ModelShape,
  modelOf,
  type NewRelated,
  type NewRow,
  type RelatedChange,
  relationOf,
  type SchemaShape,
  type Shape,
} from './programs';

interface Accessor {
  eq(value: unknown): unknown;
  isNull(): unknown;
  in(values: readonly unknown[]): unknown;
  asc(): unknown;
  some(matching?: (row: RowAccessor) => unknown): unknown;
  none(matching?: (row: RowAccessor) => unknown): unknown;
  every(matching: (row: RowAccessor) => unknown): unknown;
}

type RowAccessor = Record<string, Accessor>;
type Condition = Record<string, unknown> | ((row: RowAccessor) => unknown);

interface RelationMutator {
  variant(value: string): RelationMutator;
  where(condition: Condition): RelationMutator;
  create(rows: readonly unknown[]): unknown;
  connect(keys: readonly unknown[]): unknown;
  disconnect(keys?: readonly unknown[]): unknown;
  updateAll(changes: unknown): unknown;
  deleteAll(): unknown;
}

export interface LooseCollection {
  variant(value: string): LooseCollection;
  where(condition: Condition): LooseCollection;
  whereUnique(key: unknown): LooseCollection;
  include(
    relation: string,
    refine?: (related: LooseCollection) => LooseCollection,
  ): LooseCollection;
  select(...fields: string[]): LooseCollection;
  orderBy(by: readonly ((row: RowAccessor) => unknown)[]): LooseCollection;
  limit(count: number): LooseCollection;
  all(): PromiseLike<unknown[]>;
  create(data: unknown): Promise<unknown>;
  createAll(rows: readonly unknown[]): PromiseLike<unknown[]>;
  createAndCount(rows: readonly unknown[]): Promise<number>;
  update(data: unknown): Promise<unknown>;
  updateAll(data: unknown): PromiseLike<unknown[]>;
  updateAndCount(data: unknown): Promise<number>;
  delete(): Promise<unknown>;
  deleteAll(): PromiseLike<unknown[]>;
  deleteAndCount(): Promise<number>;
  upsert(input: unknown): Promise<unknown>;
}

export type LooseOrm = Record<string, LooseCollection>;

function accessor(row: RowAccessor, name: string): Accessor {
  const found = row[name];
  if (found === undefined) throw new Error(`the ORM offers no field or relation ${name}`);
  return found;
}

function collectionOf(orm: LooseOrm, model: string, variant: string | undefined): LooseCollection {
  const collection = orm[model];
  if (collection === undefined) throw new Error(`the ORM offers no model ${model}`);
  return variant === undefined ? collection : collection.variant(variant);
}

function matching(filter: Filter): (row: RowAccessor) => unknown {
  switch (filter.kind) {
    case 'equals':
      return (row) =>
        filter.value === null
          ? accessor(row, filter.field).isNull()
          : accessor(row, filter.field).eq(filter.value);
    case 'isNull':
      return (row) => accessor(row, filter.field).isNull();
    case 'in':
      return (row) => accessor(row, filter.field).in(filter.values);
    case 'related': {
      const inner = filter.filter === undefined ? undefined : matching(filter.filter);
      return (row) => {
        const related = accessor(row, filter.relation);
        if (inner !== undefined) return related[filter.quantifier](inner);
        return filter.quantifier === 'none' ? related.none() : related.some();
      };
    }
  }
}

function conditionOf(filter: Filter, model: ModelShape): Condition {
  const ofModel =
    filter.kind === 'equals' && model.fields.some(({ name }) => name === filter.field);
  return ofModel ? { [filter.field]: filter.value } : matching(filter);
}

function comparable(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date || value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(comparable);
  const tag = Object.prototype.toString.call(value);
  if (tag.startsWith('[object Temporal.')) return { [tag]: String(value) };
  return Object.fromEntries(
    Object.entries(value).map(([name, inner]) => [name, comparable(inner)]),
  );
}

function inAnyOrder(rows: readonly unknown[]): unknown[] {
  return rows
    .map(comparable)
    .sort((left, right) => fc.stringify(left).localeCompare(fc.stringify(right)));
}

function ofVariant(mutator: RelationMutator, variant: string | undefined): RelationMutator {
  return variant === undefined ? mutator : mutator.variant(variant);
}

export class OrmRunner {
  readonly #schema: SchemaShape;

  constructor(schema: SchemaShape) {
    this.#schema = schema;
  }

  #newRelated(model: ModelShape, name: string, mutator: RelationMutator, related: NewRelated) {
    const scope = ofVariant(mutator, related.variant);
    if (related.kind === 'connect') return scope.connect(related.keys);
    const target = modelOf(this.#schema, relationOf(model, name).to);
    return scope.create(related.rows.map((row) => this.#createInput(target, row)));
  }

  #createInput(model: ModelShape, row: NewRow): Record<string, unknown> {
    return {
      ...row.scalars,
      ...Object.fromEntries(
        Object.entries(row.related).map(([name, related]) => [
          name,
          (mutator: RelationMutator) => this.#newRelated(model, name, mutator, related),
        ]),
      ),
    };
  }

  #relatedChange(
    model: ModelShape,
    name: string,
    mutator: RelationMutator,
    change: RelatedChange,
  ): unknown {
    if (change.kind === 'create' || change.kind === 'connect') {
      return this.#newRelated(model, name, mutator, change);
    }
    const scope = ofVariant(mutator, change.variant);
    const target = modelOf(this.#schema, relationOf(model, name).to);
    if (change.kind === 'disconnect') {
      return change.keys === undefined ? scope.disconnect() : scope.disconnect(change.keys);
    }
    const filtered =
      change.filter === undefined ? scope : scope.where(conditionOf(change.filter, target));
    return change.kind === 'updateAll' ? filtered.updateAll(change.changes) : filtered.deleteAll();
  }

  #byKey(collection: LooseCollection, model: ModelShape): LooseCollection {
    return collection.orderBy(
      model.key.map((name) => (row: RowAccessor) => accessor(row, name).asc()),
    );
  }

  #including(collection: LooseCollection, model: ModelShape, tree: IncludeTree): LooseCollection {
    return Object.entries(tree).reduce((current, [name, included]) => {
      const relation = relationOf(model, name);
      const target = modelOf(this.#schema, relation.to);
      return current.include(name, (related) => {
        const filtered =
          included.filter === undefined
            ? related
            : related.where(conditionOf(included.filter, target));
        const ordered = relation.many ? this.#byKey(filtered, target) : filtered;
        const limited = included.limit === undefined ? ordered : ordered.limit(included.limit);
        return this.#including(limited, target, included.include);
      });
    }, collection);
  }

  #shaped(collection: LooseCollection, model: ModelShape, shape: Shape): LooseCollection {
    const included = this.#including(collection, model, shape.include);
    return shape.select === undefined ? included : included.select(...shape.select);
  }

  async run(orm: LooseOrm, command: Command): Promise<unknown> {
    return comparable(await this.#run(orm, command));
  }

  async #run(orm: LooseOrm, command: Command): Promise<unknown> {
    const model = modelOf(this.#schema, command.model);
    const collection = collectionOf(orm, command.model, command.variant);
    const shape = (target: LooseCollection) => this.#shaped(target, model, command.shape);
    switch (command.kind) {
      case 'create':
        return shape(collection).create(this.#createInput(model, command.row));
      case 'createAll':
        return command.counted
          ? collection.createAndCount(command.rows)
          : inAnyOrder(await shape(collection).createAll(command.rows));
      case 'update': {
        const keyed = collection.whereUnique(command.key);
        const target =
          command.also === undefined ? keyed : keyed.where(conditionOf(command.also, model));
        return shape(target).update({
          ...command.changes,
          ...Object.fromEntries(
            Object.entries(command.related).map(([name, changes]) => [
              name,
              (mutator: RelationMutator) => {
                const operations = changes.map((change) =>
                  this.#relatedChange(model, name, mutator, change),
                );
                return relationOf(model, name).many ? operations : operations[0];
              },
            ]),
          ),
        });
      }
      case 'updateAll': {
        const target = collection.where(conditionOf(command.filter, model));
        return command.counted
          ? target.updateAndCount(command.changes)
          : inAnyOrder(await shape(target).updateAll(command.changes));
      }
      case 'delete': {
        const keyed = collection.whereUnique(command.key);
        const target =
          command.also === undefined ? keyed : keyed.where(conditionOf(command.also, model));
        return shape(target).delete();
      }
      case 'deleteAll': {
        const target = collection.where(conditionOf(command.filter, model));
        return command.counted
          ? target.deleteAndCount()
          : inAnyOrder(await shape(target).deleteAll());
      }
      case 'upsert':
        return shape(collection).upsert({
          create: command.create,
          update: command.update,
          conflictOn: Object.fromEntries(
            command.conflictOn.map((name) => [name, command.create[name]]),
          ),
        });
      case 'read': {
        const filtered =
          command.filter === undefined
            ? collection
            : collection.where(conditionOf(command.filter, model));
        const ordered = this.#byKey(filtered, model);
        const limited = command.limit === undefined ? ordered : ordered.limit(command.limit);
        return shape(limited).all();
      }
    }
  }

  async readTables(orm: LooseOrm): Promise<Record<string, unknown[]>> {
    const tables: Record<string, unknown[]> = {};
    for (const model of this.#schema.models) {
      tables[model.name] = inAnyOrder(await collectionOf(orm, model.name, undefined).all());
      for (const variant of model.variants) {
        tables[`${model.name}/${variant.value}`] = inAnyOrder(
          await collectionOf(orm, model.name, variant.value).all(),
        );
      }
    }
    return tables;
  }
}
