import fc from 'fast-check';
import { expect } from 'vitest';
import { commands } from './arbitraries';
import type { Tally } from './capabilities';
import {
  type Command,
  type Filter,
  type ModelShape,
  modelOf,
  type Quantifier,
  type RelationShape,
  relationOf,
  type SchemaShape,
} from './programs';
import { propertyOptions } from './property-options';
import {
  type Aggregates,
  byKey,
  collectionOf,
  comparable,
  conditionOf,
  inAnyOrder,
  type LooseCollection,
  type LooseOrm,
  OrmRunner,
} from './run-on-orm';
import type { Schema } from './schemas';

type ReadCheck =
  | {
      readonly kind: 'include';
      readonly model: string;
      readonly relation: string;
      readonly limit: number | undefined;
    }
  | { readonly kind: 'pages' | 'cursor'; readonly model: string; readonly size: number }
  | {
      readonly kind: 'partition';
      readonly model: string;
      readonly filter: Filter;
      readonly pick: number;
    }
  | {
      readonly kind: 'quantifiers';
      readonly pick: number;
      readonly model: string;
      readonly relation: string;
      readonly filter: Filter;
    }
  | { readonly kind: 'aggregate'; readonly model: string; readonly field: string | undefined }
  | { readonly kind: 'groups'; readonly model: string; readonly field: string };

type Row = Record<string, unknown>;

function fieldFilters(model: ModelShape): fc.Arbitrary<Filter>[] {
  return model.fields
    .filter((field) => field.type.equatable && field.name !== model.discriminator)
    .map((field) =>
      fc.record({
        kind: fc.constant('equals' as const),
        field: fc.constant(field.name),
        value: field.type.values,
      }),
    );
}

function readChecks(schema: SchemaShape): fc.Arbitrary<ReadCheck> {
  return fc.oneof(
    ...schema.models.flatMap((model): fc.Arbitrary<ReadCheck>[] => {
      const name = fc.constant(model.name);
      const summable = model.fields.filter((field) => field.type.summable);
      const groupable = model.fields.filter(
        (field) => field.type.equatable && field.name !== model.discriminator,
      );
      const filters = fieldFilters(model);
      return [
        fc.record({
          kind: fc.constantFrom('pages' as const, 'cursor' as const),
          model: name,
          size: fc.integer({ min: 1, max: 3 }),
        }),
        fc.record({
          kind: fc.constant('aggregate' as const),
          model: name,
          field:
            summable.length === 0
              ? fc.constant(undefined)
              : fc.constantFrom(...summable.map((field) => field.name)),
        }),
        ...(groupable.length === 0
          ? []
          : [
              fc.record({
                kind: fc.constant('groups' as const),
                model: name,
                field: fc.constantFrom(...groupable.map((field) => field.name)),
              }),
            ]),
        ...(filters.length === 0
          ? []
          : [
              fc.record({
                kind: fc.constant('partition' as const),
                pick: fc.nat(),
                model: name,
                filter: fc.oneof(...filters),
              }),
            ]),
        ...model.relations.flatMap((relation): fc.Arbitrary<ReadCheck>[] => {
          const target = fieldFilters(modelOf(schema, relation.to));
          return [
            fc.record({
              kind: fc.constant('include' as const),
              model: name,
              relation: fc.constant(relation.name),
              limit: relation.many
                ? fc.option(fc.integer({ min: 1, max: 2 }), { nil: undefined })
                : fc.constant(undefined),
            }),
            ...(target.length === 0
              ? []
              : [
                  fc.record({
                    kind: fc.constant('quantifiers' as const),
                    pick: fc.nat(),
                    model: name,
                    relation: fc.constant(relation.name),
                    filter: fc.oneof(...target),
                  }),
                ]),
          ];
        }),
      ];
    }),
  );
}

function keyOfRow(model: ModelShape, row: Row): Row {
  return Object.fromEntries(model.key.map((name) => [name, row[name]]));
}

function identity(model: ModelShape, row: Row): string {
  return fc.stringify(comparable(keyOfRow(model, row)));
}

function equalTo(fields: readonly string[], values: readonly unknown[]): Filter {
  return {
    kind: 'and',
    filters: fields.map((field, index) => ({ kind: 'equals', field, value: values[index] })),
  };
}

function related(quantifier: Quantifier, relation: string, filter: Filter): Filter {
  return { kind: 'related', relation, quantifier, filter };
}

function aimed(filter: Filter, rows: readonly Row[], pick: number): Filter {
  const row = rows[pick % Math.max(rows.length, 1)];
  if (filter.kind !== 'equals' || row === undefined || pick % 4 === 0) return filter;
  return { ...filter, value: row[filter.field] };
}

async function rowsOf(collection: LooseCollection | PromiseLike<unknown[]>): Promise<Row[]> {
  const rows = 'all' in collection ? await collection.all() : await collection;
  return rows as Row[];
}

function linkedTo(
  schema: SchemaShape,
  parent: ModelShape,
  relation: RelationShape,
  row: Row,
): Filter | undefined {
  const target = modelOf(schema, relation.to);
  if (relation.foreignKey !== undefined) {
    const values = relation.foreignKey.map((name) => row[name]);
    return values.some((value) => value === null) ? undefined : equalTo(target.key, values);
  }
  const key = parent.key.map((name) => row[name]);
  if (relation.inverse === undefined) return undefined;
  const inverse = relationOf(target, relation.inverse);
  return inverse.foreignKey === undefined
    ? related('some', inverse.name, equalTo(parent.key, key))
    : equalTo(inverse.foreignKey, key);
}

async function check(schema: SchemaShape, orm: LooseOrm, read: ReadCheck): Promise<number> {
  const model = modelOf(schema, read.model);
  const collection = collectionOf(orm, model.name, undefined);
  const where = (filter: Filter) => collection.where(conditionOf(filter, model));
  switch (read.kind) {
    case 'include': {
      const relation = relationOf(model, read.relation);
      const target = modelOf(schema, relation.to);
      const targets = collectionOf(orm, target.name, undefined);
      const refine = (rows: LooseCollection) => {
        const ordered = relation.many ? byKey(rows, target) : rows;
        return read.limit === undefined ? ordered : ordered.limit(read.limit);
      };
      const parents = await rowsOf(byKey(collection.include(relation.name, refine), model));
      for (const parent of parents) {
        const link = linkedTo(schema, model, relation, parent);
        const separate =
          link === undefined ? [] : await rowsOf(refine(targets.where(conditionOf(link, target))));
        expect({
          parent: keyOfRow(model, parent),
          included: comparable(parent[relation.name]),
        }).toEqual({
          parent: keyOfRow(model, parent),
          included: comparable(relation.many ? separate : (separate[0] ?? null)),
        });
      }
      return parents.length;
    }
    case 'pages': {
      const all = await rowsOf(byKey(collection, model));
      const paged: Row[] = [];
      for (let offset = 0; offset <= all.length; offset += read.size) {
        paged.push(...(await rowsOf(byKey(collection, model).limit(read.size).offset(offset))));
      }
      expect(paged.map(comparable)).toEqual(all.map(comparable));
      return all.length;
    }
    case 'cursor': {
      const all = await rowsOf(byKey(collection, model));
      const paged = await rowsOf(byKey(collection, model).limit(read.size));
      while (paged.length < all.length + read.size) {
        const last = paged.at(-1);
        if (last === undefined) break;
        const next = await rowsOf(
          byKey(collection, model).cursor(keyOfRow(model, last)).limit(read.size),
        );
        if (next.length === 0) break;
        paged.push(...next);
      }
      expect(paged.map(comparable)).toEqual(all.map(comparable));
      return all.length;
    }
    case 'partition': {
      const filter = aimed(read.filter, await rowsOf(collection), read.pick);
      const nullable =
        filter.kind === 'equals' && model.fields.some((f) => f.name === filter.field && f.nullable);
      const parts = [
        await rowsOf(where(filter)),
        await rowsOf(where({ kind: 'not', filter })),
        nullable && filter.kind === 'equals' && filter.value !== null
          ? await rowsOf(where({ kind: 'isNull', field: filter.field }))
          : [],
      ];
      const all = await rowsOf(collection);
      expect({
        rows: inAnyOrder(parts.flat()),
        distinct: new Set(parts.flat().map((row) => identity(model, row))).size,
      }).toEqual({ rows: inAnyOrder(all), distinct: all.length });
      return parts[0]?.length ?? 0;
    }
    case 'quantifiers': {
      const target = modelOf(schema, relationOf(model, read.relation).to);
      const filter = aimed(
        read.filter,
        await rowsOf(collectionOf(orm, target.name, undefined)),
        read.pick,
      );
      const every = await rowsOf(where(related('every', read.relation, filter)));
      const noneNot = await rowsOf(where(related('none', read.relation, { kind: 'not', filter })));
      const some = await rowsOf(where(related('some', read.relation, filter)));
      const none = await rowsOf(where(related('none', read.relation, filter)));
      const all = await rowsOf(collection);
      expect({
        every: inAnyOrder(every),
        someAndNone: inAnyOrder([...some, ...none]),
      }).toEqual({ every: inAnyOrder(noneNot), someAndNone: inAnyOrder(all) });
      return some.length;
    }
    case 'aggregate': {
      const { field } = read;
      const all = await rowsOf(collection);
      const values =
        field === undefined ? [] : all.map((row) => row[field]).filter((v) => v !== null);
      const numbers = values.map((value) => BigInt(String(value)));
      const aggregated = await collection.aggregate((aggregate: Aggregates) => ({
        count: aggregate.count(),
        ...(field === undefined
          ? {}
          : { sum: aggregate.sum(field), min: aggregate.min(field), max: aggregate.max(field) }),
      }));
      const asBigInt = (value: unknown) => (value === null ? null : BigInt(String(value)));
      const extreme = (pick: (a: bigint, b: bigint) => boolean) =>
        numbers.length === 0 ? null : numbers.reduce((a, b) => (pick(a, b) ? a : b));
      expect({
        count: Number(aggregated['count']),
        ...(field === undefined
          ? {}
          : {
              sum: asBigInt(aggregated['sum']),
              min: asBigInt(aggregated['min']),
              max: asBigInt(aggregated['max']),
            }),
      }).toEqual({
        count: all.length,
        ...(field === undefined
          ? {}
          : {
              sum: numbers.length === 0 ? null : numbers.reduce((a, b) => a + b),
              min: extreme((a, b) => a < b),
              max: extreme((a, b) => a > b),
            }),
      });
      return all.length;
    }
    case 'groups': {
      const all = await rowsOf(collection);
      const counted = new Map<string, { value: unknown; count: number }>();
      for (const row of all) {
        const value = comparable(row[read.field]);
        const group = counted.get(fc.stringify(value)) ?? { value, count: 0 };
        counted.set(fc.stringify(value), { value, count: group.count + 1 });
      }
      const grouped = await collection
        .groupBy(read.field)
        .aggregate((aggregate: Aggregates) => ({ count: aggregate.count() }));
      expect(
        inAnyOrder(
          grouped.map((group) => ({ value: group[read.field], count: Number(group['count']) })),
        ),
      ).toEqual(inAnyOrder([...counted.values()]));
      return counted.size;
    }
  }
}

function coded(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error && typeof error.code === 'string') ||
      ('kind' in error && error.kind === 'sql_query'))
  );
}

export interface ReadComparison {
  readonly schema: Schema;
  readonly generatedKeys: boolean;
  readonly runs: number;
  readonly seed: number;
  readonly tally: Tally;
}

export async function readsAgree(
  orm: LooseOrm,
  clear: () => void | Promise<void>,
  comparison: ReadComparison,
): Promise<void> {
  const { shape } = comparison.schema;
  const runner = new OrmRunner(shape);
  const { tally } = comparison;

  async function quietly(command: Command): Promise<void> {
    try {
      await runner.run(orm, command);
    } catch (error) {
      if (!coded(error)) throw error;
    }
  }

  await fc.assert(
    fc.asyncProperty(
      commands({ schema: shape, generatedKeys: comparison.generatedKeys }),
      fc.array(readChecks(shape), { minLength: 3, maxLength: 6 }),
      async (sequence, reads) => {
        await clear();
        for (const command of [...sequence.existing, ...sequence.following]) {
          if (command.kind !== 'read') await quietly(command);
        }
        for (const read of reads) {
          let rows: number;
          try {
            rows = await check(shape, orm, read);
          } catch (error) {
            if (!coded(error)) throw error;
            tally.add(`${read.kind} rejected`);
            tally.rejected(`${read.kind} on ${read.model}`, error);
            continue;
          }
          tally.add(`${read.kind} ${rows > 0 ? 'with rows' : 'without rows'}`);
          if ('relation' in read) {
            tally.add(
              `${read.kind} through ${relationOf(modelOf(shape, read.model), read.relation).kind}`,
            );
          }
        }
      },
    ),
    propertyOptions(comparison.runs, comparison.seed),
  );
}

export const exercisedByReads: readonly string[] = [
  'include with rows',
  'pages with rows',
  'cursor with rows',
  'partition with rows',
  'quantifiers with rows',
  'aggregate with rows',
  'groups with rows',
  'include through 1:n',
  'include through n:1',
  'include through n:m',
  'quantifiers through 1:n',
  'quantifiers through n:m',
];
