import fc from 'fast-check';
import { expect } from 'vitest';
import type { Paths } from './paths';
import { seedOfRun } from './property-options';
import { accessor, comparable, type LooseCollection } from './run-on-orm';
import { oneOfEachKeyType, type ScalarType } from './scalar-types';
import { emitContract, type Target } from './schemas';

export interface KeySchema {
  readonly types: readonly ScalarType[];
  readonly tables: readonly string[];
  readonly contractJson: unknown;
}

export function pslOfKeys(types: readonly ScalarType[]): string {
  const models = types.map(
    (type, index) => `model Parent${index} {
  id ${type.psl} @id
  children Child${index}[]
}

model Child${index} {
  id Int @id
  parentId ${type.psl}?
  parent Parent${index}? @relation(fields: [parentId], references: [id])
}`,
  );
  return `// use prisma-8\n\n${models.join('\n\n')}\n`;
}

export function keySchemas(target: Target, rounds: number): KeySchema[] {
  return fc
    .sample(oneOfEachKeyType[target], { seed: seedOfRun(), numRuns: rounds })
    .map((types, round) => ({
      types,
      tables: types.flatMap((_, index) => [`Child${index}`, `Parent${index}`]),
      contractJson: emitContract(
        {
          target,
          psl: pslOfKeys(types),
          shape: { models: [] },
          tables: [],
          features: [],
        },
        `keys-${target}-${process.pid}-${round}`,
      ),
    }));
}

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  if (typeof value !== 'object' || value === null) throw new Error('expected a row');
  return value as Row;
}

function orderedByKey(parents: LooseCollection): LooseCollection | undefined {
  try {
    return parents.orderBy([(row) => accessor(row, 'id').asc()]);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('asc is not a function')) {
      return undefined;
    }
    throw error;
  }
}

async function worksAsKey(
  parents: LooseCollection,
  children: LooseCollection,
  separately: { readonly parents: LooseCollection; readonly children: LooseCollection },
  unmatched: Set<string>,
  clear: () => void | Promise<void>,
  type: ScalarType,
  ordinals: readonly [number, number, number],
): Promise<void> {
  const { distinct } = type;
  if (distinct === undefined) throw new Error(`${type.psl} has no distinct values`);
  const [first, second, third] = ordinals.map(distinct);
  await clear();
  await parents.createAndCount([{ id: first }, { id: second }]);
  await children.createAndCount([{ id: 1, parentId: first }]);

  const found = asRow(await parents.whereUnique({ id: first }).first());
  const key = found['id'];
  const byKeyRead = await parents.whereUnique({ id: key }).first();
  const filtered = await parents.where({ id: key }).all();
  const listed = await parents.where((row) => accessor(row, 'id').in([key])).all();
  const withChildren = asRow(await parents.whereUnique({ id: key }).include('children').first());
  const child = asRow(await children.whereUnique({ id: 1 }).include('parent').first());
  const ordered = orderedByKey(parents);
  const after = ordered === undefined ? [] : await ordered.cursor({ id: key }).all();
  const all = ordered === undefined ? [] : await ordered.all();
  expect(
    comparable({
      byKeyRead,
      filtered,
      listed,
      children: withChildren['children'],
      childForeignKey: child['parentId'],
      parentOfChild: child['parent'],
      rowsAfterCursorAndBefore: all.length - after.length,
    }),
  ).toEqual(
    comparable({
      byKeyRead: found,
      filtered: [found],
      listed: [found],
      children: [{ id: 1, parentId: key }],
      childForeignKey: key,
      parentOfChild: found,
      rowsAfterCursorAndBefore:
        all.findIndex((row) => fc.stringify(row) === fc.stringify(found)) + 1,
    }),
  );

  let included: unknown;
  try {
    included = {
      children: asRow(
        await separately.parents.whereUnique({ id: key }).include('children').first(),
      )['children'],
      parentOfChild: asRow(
        await separately.children.whereUnique({ id: 1 }).include('parent').first(),
      )['parent'],
    };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('cannot be matched')) throw error;
    unmatched.add(type.psl.replace(/\(.*$/, ''));
  }
  if (included !== undefined) {
    expect(comparable(included), 'includes loaded with one query per relation').toEqual(
      comparable({ children: withChildren['children'], parentOfChild: child['parent'] }),
    );
  }

  const moved = asRow(await parents.whereUnique({ id: second }).update({ id: third }));
  expect(comparable(await parents.whereUnique({ id: moved['id'] }).first())).toEqual(
    comparable(moved),
  );
  const deleted = await parents.whereUnique({ id: moved['id'] }).delete();
  expect(comparable(deleted)).toEqual(comparable(moved));
}

export async function keysWork(
  paths: Paths,
  types: readonly ScalarType[],
  runs: number,
): Promise<{ readonly withoutOrdering: string[]; readonly withoutSeparateIncludes: string[] }> {
  const failures: string[] = [];
  const unmatched = new Set<string>();
  const perRelation = paths.varied(['outerReferencesInDerivedTables', 'jsonAggWithoutTruncation']);
  const ordinals = fc
    .uniqueArray(fc.integer({ min: 1, max: 59 }), { minLength: 3, maxLength: 3 })
    .map(([a, b, c]): [number, number, number] => [a ?? 1, b ?? 2, c ?? 3]);
  for (const [index, type] of types.entries()) {
    const parents = paths.reference[`Parent${index}`];
    const children = paths.reference[`Child${index}`];
    const separately = {
      parents: perRelation[`Parent${index}`],
      children: perRelation[`Child${index}`],
    };
    if (
      parents === undefined ||
      children === undefined ||
      separately.parents === undefined ||
      separately.children === undefined
    ) {
      throw new Error('no key models');
    }
    const { parents: parentsSeparately, children: childrenSeparately } = separately;
    try {
      await fc.assert(
        fc.asyncProperty(ordinals, (chosen) =>
          worksAsKey(
            parents,
            children,
            { parents: parentsSeparately, children: childrenSeparately },
            unmatched,
            paths.clear,
            type,
            chosen,
          ),
        ),
        { numRuns: runs, seed: seedOfRun() + index },
      );
    } catch (error) {
      const cause = error instanceof Error ? String(error.cause) : '';
      failures.push(`${type.psl}: ${String(error).slice(0, 300)}\n${cause.slice(0, 900)}`);
    }
  }
  const unordered = types
    .filter((_, index) => {
      const parents = paths.reference[`Parent${index}`];
      return parents !== undefined && orderedByKey(parents) === undefined;
    })
    .map((type) => type.psl);
  expect(failures).toEqual([]);
  return { withoutOrdering: unordered, withoutSeparateIncludes: [...unmatched] };
}
