import fc from 'fast-check';
import { expect } from 'vitest';
import { commands } from './arbitraries';
import type { Tally } from './capabilities';
import {
  type Command,
  type Filter,
  type ModelShape,
  modelOf,
  type NewRelated,
  type NewRow,
  type RelatedChange,
  type RelationShape,
  relationOf,
  type SchemaShape,
} from './programs';
import { propertyOptions } from './property-options';
import {
  collectionOf,
  conditionOf,
  type LooseCollection,
  type LooseOrm,
  OrmRunner,
} from './run-on-orm';
import type { Schema } from './schemas';

type Row = Record<string, unknown>;

class RowMissing extends Error {}

function equalTo(fields: readonly string[], values: readonly unknown[]): Filter {
  return {
    kind: 'and',
    filters: fields.map((field, index) => ({ kind: 'equals', field, value: values[index] })),
  };
}

function assigned(fields: readonly string[], values: readonly unknown[]): Row {
  return Object.fromEntries(fields.map((field, index) => [field, values[index]]));
}

function asRow(value: unknown): Row | undefined {
  return typeof value === 'object' && value !== null ? (value as Row) : undefined;
}

class SeparateWrites {
  readonly #schema: SchemaShape;
  readonly #orm: LooseOrm;

  constructor(schema: SchemaShape, orm: LooseOrm) {
    this.#schema = schema;
    this.#orm = orm;
  }

  #rows(model: ModelShape, variant: string | undefined): LooseCollection {
    return collectionOf(this.#orm, model.name, variant);
  }

  #where(model: ModelShape, variant: string | undefined, filters: readonly Filter[]) {
    return this.#rows(model, variant).where(conditionOf({ kind: 'and', filters }, model));
  }

  async #existing(model: ModelShape, variant: string | undefined, key: Row): Promise<Row> {
    const found = asRow(await this.#rows(model, variant).whereUnique(key).first());
    if (found === undefined) throw new RowMissing(`${model.name} has no row ${fc.stringify(key)}`);
    return found;
  }

  async #linkedRow(relation: RelationShape, related: NewRelated): Promise<Row> {
    const target = modelOf(this.#schema, relation.to);
    if (related.kind === 'connect') {
      const [key] = related.keys;
      if (key === undefined) throw new Error('connect without a key');
      return this.#existing(target, related.variant, key);
    }
    const [row] = related.rows;
    if (row === undefined) throw new Error('create without a row');
    return this.create(target, related.variant, row, {});
  }

  async create(
    model: ModelShape,
    variant: string | undefined,
    row: NewRow,
    link: Row,
  ): Promise<Row> {
    const scalars: Row = { ...row.scalars, ...link };
    const later: [RelationShape, NewRelated][] = [];
    for (const [name, related] of Object.entries(row.related)) {
      const relation = relationOf(model, name);
      if (relation.foreignKey === undefined) {
        later.push([relation, related]);
        continue;
      }
      const target = modelOf(this.#schema, relation.to);
      const linked = await this.#linkedRow(relation, related);
      Object.assign(
        scalars,
        assigned(
          relation.foreignKey,
          target.key.map((field) => linked[field]),
        ),
      );
    }
    const created = asRow(await this.#rows(model, variant).create(scalars));
    if (created === undefined) throw new Error(`create on ${model.name} returned no row`);
    for (const [relation, related] of later) await this.#change(model, created, relation, related);
    return created;
  }

  async #change(
    model: ModelShape,
    row: Row,
    relation: RelationShape,
    change: RelatedChange,
  ): Promise<void> {
    const target = modelOf(this.#schema, relation.to);
    const key = model.key.map((field) => row[field]);
    const filters = 'filter' in change && change.filter !== undefined ? [change.filter] : [];
    const { through } = relation;
    if (through !== undefined) {
      const junction = modelOf(this.#schema, through.model);
      const linkOf = (other: Row) => ({
        ...assigned(through.near, key),
        ...assigned(
          through.far,
          target.key.map((field) => other[field]),
        ),
      });
      const linked: Filter = {
        kind: 'related',
        relation: relation.inverse ?? '',
        quantifier: 'some',
        filter: equalTo(model.key, key),
      };
      switch (change.kind) {
        case 'create':
        case 'connect': {
          const others =
            change.kind === 'create'
              ? await this.#created(target, change.variant, change.rows)
              : await this.#found(target, change.variant, change.keys);
          for (const other of others) {
            const link = linkOf(other);
            const present = await this.#rows(junction, undefined).whereUnique(link).first();
            if (present === null) await this.#rows(junction, undefined).create(link);
          }
          return;
        }
        case 'disconnect':
          for (const other of await this.#found(target, change.variant, change.keys ?? [])) {
            await this.#rows(junction, undefined).whereUnique(linkOf(other)).delete();
          }
          return;
        case 'updateAll':
          if (Object.keys(change.changes).length === 0) return;
          await this.#where(target, change.variant, [linked, ...filters]).updateAndCount(
            change.changes,
          );
          return;
        case 'deleteAll':
          await this.#where(target, change.variant, [linked, ...filters]).deleteAndCount();
          return;
      }
    }
    const inverse = relationOf(target, relation.inverse ?? '');
    const foreignKey = inverse.foreignKey ?? [];
    const linked = equalTo(foreignKey, key);
    const link = assigned(foreignKey, key);
    const unlink = assigned(
      foreignKey,
      foreignKey.map(() => null),
    );
    switch (change.kind) {
      case 'create':
        for (const child of change.rows) await this.create(target, change.variant, child, link);
        return;
      case 'connect':
        for (const other of change.keys) {
          await this.#rows(target, change.variant).whereUnique(other).update(link);
        }
        return;
      case 'disconnect':
        if (change.keys === undefined) {
          await this.#where(target, change.variant, [linked]).updateAndCount(unlink);
          return;
        }
        for (const other of change.keys) {
          await this.#rows(target, change.variant)
            .whereUnique(other)
            .where(conditionOf(linked, target))
            .update(unlink);
        }
        return;
      case 'updateAll':
        if (Object.keys(change.changes).length === 0) return;
        await this.#where(target, change.variant, [linked, ...filters]).updateAndCount(
          change.changes,
        );
        return;
      case 'deleteAll':
        await this.#where(target, change.variant, [linked, ...filters]).deleteAndCount();
        return;
    }
  }

  async #created(
    model: ModelShape,
    variant: string | undefined,
    rows: readonly NewRow[],
  ): Promise<Row[]> {
    const created: Row[] = [];
    for (const row of rows) created.push(await this.create(model, variant, row, {}));
    return created;
  }

  async #found(
    model: ModelShape,
    variant: string | undefined,
    keys: readonly Row[],
  ): Promise<Row[]> {
    const found: Row[] = [];
    for (const key of keys) found.push(await this.#existing(model, variant, key));
    return found;
  }

  async update(command: Extract<Command, { kind: 'update' }>): Promise<void> {
    const model = modelOf(this.#schema, command.model);
    const keyed = this.#rows(model, command.variant).whereUnique(command.key);
    const filtered =
      command.also === undefined ? keyed : keyed.where(conditionOf(command.also, model));
    const current = asRow(await filtered.first());
    if (current === undefined) return;
    const changes: Row = { ...command.changes };
    const later: [RelationShape, RelatedChange][] = [];
    for (const [name, relatedChanges] of Object.entries(command.related)) {
      const relation = relationOf(model, name);
      const { foreignKey } = relation;
      if (foreignKey === undefined) {
        for (const change of relatedChanges) later.push([relation, change]);
        continue;
      }
      const target = modelOf(this.#schema, relation.to);
      for (const change of relatedChanges) {
        if (change.kind === 'create' || change.kind === 'connect') {
          const linked = await this.#linkedRow(relation, change);
          Object.assign(
            changes,
            assigned(
              foreignKey,
              target.key.map((field) => linked[field]),
            ),
          );
        } else {
          Object.assign(
            changes,
            assigned(
              foreignKey,
              foreignKey.map(() => null),
            ),
          );
        }
      }
    }
    const key = Object.fromEntries(model.key.map((field) => [field, current[field]]));
    const updated =
      Object.keys(changes).length === 0
        ? current
        : asRow(await this.#rows(model, command.variant).whereUnique(key).update(changes));
    if (updated === undefined) throw new Error(`update on ${model.name} returned no row`);
    for (const [relation, change] of later) await this.#change(model, updated, relation, change);
  }

  async run(command: Command): Promise<void> {
    if (command.kind === 'update') return this.update(command);
    if (command.kind !== 'create') throw new Error(`${command.kind} has no nested writes`);
    await this.create(modelOf(this.#schema, command.model), command.variant, command.row, {});
  }
}

function codeOf(error: unknown): string | undefined {
  if (error instanceof RowMissing) return 'row missing';
  if (!(error instanceof Error)) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('kind' in error && error.kind === 'sql_query' && 'sqlState' in error) {
    return `SQLSTATE ${String(error.sqlState)}`;
  }
  return undefined;
}

function operationsOf(schema: SchemaShape, command: Command): string[] {
  const model = modelOf(schema, command.model);
  const related =
    command.kind === 'create'
      ? Object.entries(command.row.related).map(([name, change]) => [name, [change]] as const)
      : command.kind === 'update'
        ? Object.entries(command.related)
        : [];
  return related.flatMap(([name, changes]) =>
    changes.map((change) => `${change.kind} through ${relationOf(model, name).kind}`),
  );
}

export interface NestedComparison {
  readonly schema: Schema;
  readonly runs: number;
  readonly seed: number;
  readonly tally: Tally;
}

export async function nestedEqualsSeparate(
  orm: LooseOrm,
  clear: () => void | Promise<void>,
  comparison: NestedComparison,
): Promise<void> {
  const { shape } = comparison.schema;
  const runner = new OrmRunner(shape);
  const separate = new SeparateWrites(shape, orm);
  const { tally } = comparison;

  async function attempt(label: string, run: () => Promise<unknown>): Promise<string | undefined> {
    try {
      await run();
      return undefined;
    } catch (error) {
      const code = codeOf(error);
      if (code === undefined) throw error;
      tally.rejected(`${label} ${code}`, error);
      return code;
    }
  }

  async function prepared(before: readonly Command[]): Promise<void> {
    await clear();
    for (const command of before) {
      if (command.kind !== 'read') await attempt('before', () => runner.run(orm, command));
    }
  }

  await fc.assert(
    fc.asyncProperty(
      commands({ schema: shape, generatedKeys: false }),
      async ({ existing, following, nested }) => {
        const before = [...existing, ...following];
        await prepared(before);
        const nestedCode = await attempt('nested', () => runner.run(orm, nested));
        const afterNested = await runner.readTables(orm);
        if (
          nestedCode?.startsWith('ORM.RELATION_MUTATION') ||
          nestedCode?.startsWith('ORM.OPERATION')
        ) {
          tally.add('nested refused');
          return;
        }
        await prepared(before);
        const separateCode = await attempt('separate', () => separate.run(nested));
        const afterSeparate = await runner.readTables(orm);
        const both = nestedCode === undefined && separateCode === undefined;
        expect(
          { rejected: separateCode !== undefined, tables: both ? afterSeparate : 'not compared' },
          `nested write ${fc.stringify(nested)} gave ${nestedCode ?? 'rows'}, the separate writes gave ${separateCode ?? 'rows'}`,
        ).toEqual({
          rejected: nestedCode !== undefined,
          tables: both ? afterNested : 'not compared',
        });
        if (nestedCode !== undefined) {
          tally.add('both rejected');
          return;
        }
        tally.add(`${nested.kind} with nested writes`);
        for (const operation of operationsOf(shape, nested)) tally.add(operation);
      },
    ),
    propertyOptions(comparison.runs, comparison.seed),
  );
}

export const exercisedByNestedWrites: readonly string[] = [
  'create with nested writes',
  'update with nested writes',
  'both rejected',
  'create through 1:n',
  'create through n:1',
  'create through n:m',
  'connect through 1:n',
  'connect through n:1',
  'connect through n:m',
  'disconnect through 1:n',
  'disconnect through n:1',
  'disconnect through n:m',
  'updateAll through 1:n',
  'updateAll through n:m',
  'deleteAll through 1:n',
  'deleteAll through n:m',
];
