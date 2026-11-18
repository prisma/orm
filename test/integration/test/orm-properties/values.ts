import fc from 'fast-check';
import { expect } from 'vitest';
import type { Paths } from './paths';
import { seedOfRun } from './property-options';
import { accessor, comparable, type LooseCollection } from './run-on-orm';
import { oneOfEachScalarType, type ScalarType } from './scalar-types';
import { emitContract, type Target } from './schemas';

export interface ValueSchema {
  readonly types: readonly ScalarType[];
  readonly contractJson: unknown;
}

export function valueSchemas(target: Target, rounds: number): ValueSchema[] {
  const seed = seedOfRun();
  return fc.sample(oneOfEachScalarType[target], { seed, numRuns: rounds }).map((types, round) => {
    const fields = types.map((type, index) => `  value${index} ${type.psl}?`);
    const psl = `// use prisma-8\n\nmodel Probe {\n  id Int @id\n${fields.join('\n')}\n}\n`;
    return {
      types,
      contractJson: emitContract(
        { target, psl, shape: { models: [] }, tables: ['Probe'], features: [] },
        `values-${target}-${process.pid}-${round}`,
      ),
    };
  });
}

function refusedByCodec(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error && typeof error.code === 'string') ||
      ('kind' in error && error.kind === 'sql_query'))
  );
}

function fieldOfRow(row: unknown, field: string): unknown {
  if (typeof row !== 'object' || row === null) throw new Error(`no row holds ${field}`);
  return (row as Record<string, unknown>)[field];
}

async function roundTrips(
  probe: LooseCollection,
  clear: () => void | Promise<void>,
  field: string,
  type: ScalarType,
  value: unknown,
): Promise<'stored' | 'refused'> {
  await clear();
  let created: unknown;
  try {
    created = await probe.select('id', field).create({ id: 1, [field]: value });
  } catch (error) {
    if (refusedByCodec(error)) return 'refused';
    throw error;
  }
  const first = await probe.whereUnique({ id: 1 }).select('id', field).first();
  expect({ returnedByCreate: comparable(created) }).toEqual({
    returnedByCreate: comparable(first),
  });

  const stored = fieldOfRow(first, field);
  await probe.createAndCount([{ id: 2, [field]: stored }]);
  const second = await probe.whereUnique({ id: 2 }).select('id', field).first();
  expect({ storedAgain: comparable(fieldOfRow(second, field)) }).toEqual({
    storedAgain: comparable(stored),
  });

  if (type.equatable && stored !== null) {
    const ids = async (rows: PromiseLike<unknown[]>) =>
      (await rows).map((row) => fieldOfRow(row, 'id')).sort();
    expect({
      foundByObject: await ids(
        probe
          .where({ [field]: stored })
          .select('id')
          .all(),
      ),
      foundByCallback: await ids(
        probe
          .where((row) => accessor(row, field).eq(stored))
          .select('id')
          .all(),
      ),
    }).toEqual({ foundByObject: [1, 2], foundByCallback: [1, 2] });
  }
  return 'stored';
}

export async function valuesRoundTrip(
  paths: Paths,
  types: readonly ScalarType[],
  runs: number,
): Promise<void> {
  const probe = paths.reference['Probe'];
  if (probe === undefined) throw new Error('the ORM offers no model Probe');
  const failures: string[] = [];
  const neverStored: string[] = [];
  for (const [index, type] of types.entries()) {
    let stored = 0;
    try {
      await fc.assert(
        fc.asyncProperty(type.values, async (value) => {
          const result = await roundTrips(probe, paths.clear, `value${index}`, type, value);
          if (result === 'stored') stored += 1;
        }),
        { numRuns: runs, seed: seedOfRun() + index },
      );
    } catch (error) {
      const cause = error instanceof Error ? String(error.cause) : '';
      failures.push(`${type.psl}: ${String(error).slice(0, 400)}\n${cause.slice(0, 900)}`);
      continue;
    }
    if (stored === 0) neverStored.push(type.psl);
  }
  expect({ failures, neverStored }).toEqual({ failures: [], neverStored: [] });
}
