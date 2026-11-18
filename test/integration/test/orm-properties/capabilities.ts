import fc from 'fast-check';
import { expect } from 'vitest';
import { commands } from './arbitraries';
import type { Paths } from './paths';
import {
  type Command,
  depthOfInclude,
  depthOfRow,
  type Filter,
  fieldOf,
  type ModelShape,
  modelOf,
  type NewRelated,
  type RelatedChange,
  relationOf,
  type SchemaShape,
  type Sequence,
  scoped,
  variantOf,
} from './programs';
import { propertyOptions, runsAreOverridden } from './property-options';
import { type LooseOrm, OrmRunner } from './run-on-orm';
import { type Schema, typeNameOf } from './schemas';

export const variations = {
  'without returning': ['returning'],
  'with one query per included relation': [
    'outerReferencesInDerivedTables',
    'jsonAggWithoutTruncation',
  ],
  'without returning and with one query per included relation': [
    'returning',
    'outerReferencesInDerivedTables',
    'jsonAggWithoutTruncation',
  ],
} as const;

export type Variation = keyof typeof variations;

const variationNames = Object.keys(variations) as Variation[];

type Outcome =
  | { readonly status: 'returned'; readonly value: unknown }
  | { readonly status: 'rejected'; readonly code: string }
  | { readonly status: 'refused' };

interface Step {
  readonly step: number;
  readonly command: Command;
  readonly outcome: Outcome;
  readonly tables: Record<string, unknown[]>;
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('kind' in error && error.kind === 'sql_query' && 'sqlState' in error) {
    return `SQLSTATE ${String(error.sqlState)}`;
  }
  return undefined;
}

function relatedOperations(
  schema: SchemaShape,
  model: ModelShape,
  related: Readonly<Record<string, NewRelated | readonly RelatedChange[]>>,
): string[] {
  return Object.entries(related).flatMap(([name, changes]) => {
    const relation = relationOf(model, name);
    const target = modelOf(schema, relation.to);
    return [changes]
      .flat()
      .flatMap((change: NewRelated | RelatedChange) => [
        `${change.kind} through ${relation.kind}`,
        ...(change.kind === 'create'
          ? change.rows.flatMap((row) => relatedOperations(schema, target, row.related))
          : []),
      ]);
  });
}

function writtenValues(command: Command): [string, unknown][] {
  switch (command.kind) {
    case 'create':
      return Object.entries(command.row.scalars);
    case 'createAll':
      return command.rows.flatMap((row) => Object.entries(row));
    case 'update':
    case 'updateAll':
      return Object.entries(command.changes);
    case 'upsert':
      return Object.entries(command.create);
    default:
      return [];
  }
}

function filtersOf(command: Command): Filter[] {
  const filters =
    command.kind === 'update' || command.kind === 'delete'
      ? [command.also]
      : command.kind === 'updateAll' || command.kind === 'deleteAll' || command.kind === 'read'
        ? [command.filter]
        : [];
  return filters.filter((filter) => filter !== undefined);
}

export class Tally {
  readonly #counts = new Map<string, number>();
  readonly #examples = new Map<string, string>();

  add(key: string): void {
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
  }

  count(key: string): number {
    return this.#counts.get(key) ?? 0;
  }

  rejected(label: string, error: unknown): void {
    this.#examples.set(label, String(error).slice(0, 240));
  }

  get report(): string {
    const counts = [...this.#counts].sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify(
      { counts: Object.fromEntries(counts), rejections: Object.fromEntries(this.#examples) },
      null,
      1,
    );
  }

  record(
    schema: SchemaShape,
    initial: Record<string, unknown[]>,
    steps: readonly Step[],
    variation: Variation,
  ): void {
    this.add(`compared ${variation}`);
    let before = fc.stringify(initial);
    for (const { command, outcome, tables } of steps) {
      const after = fc.stringify(tables);
      const model = modelOf(schema, command.model);
      if (outcome.status === 'rejected') this.add(`${command.kind} rejected ${outcome.code}`);
      if (outcome.status === 'refused') this.add(`${command.kind} refused`);
      if (outcome.status === 'returned') {
        const changed = after !== before;
        this.add(`${command.kind} ${changed ? 'changed' : 'unchanged'}`);
        const included = depthOfInclude(command.shape.include);
        if (included > 0) {
          this.add(`${command.kind} include depth ${Math.min(included, 3)}`);
          this.add(`${command.kind} include ${variation}`);
        }
        if (command.shape.select !== undefined) this.add(`${command.kind} select`);
        if (command.kind === 'create') {
          this.add(`create depth ${Math.min(depthOfRow(command.row), 4)}`);
        }
        for (const filter of filtersOf(command)) {
          if (filter.kind !== 'related') continue;
          const through = relationOf(model, filter.relation).kind;
          this.add(`${filter.quantifier} related through ${through}`);
        }
        if (changed) {
          this.add(`${command.kind} on ${model.keyKind} key`);
          const variant =
            command.variant === undefined ? undefined : variantOf(model, command.variant);
          if (variant !== undefined) {
            this.add(
              `${command.kind} on a variant in ${variant.ownTable ? 'its own' : 'the base'} table`,
            );
          }
          const written = scoped(model, command.variant);
          for (const [name, value] of writtenValues(command)) {
            if (value !== null) this.add(`stored ${typeNameOf(fieldOf(written, name).type)}`);
          }
          const related =
            command.kind === 'create'
              ? command.row.related
              : command.kind === 'update'
                ? command.related
                : {};
          for (const operation of relatedOperations(schema, model, related)) this.add(operation);
        }
      }
      before = after;
    }
  }
}

export interface Comparison {
  readonly schema: Schema;
  readonly generatedKeys: boolean;
  readonly runs: number;
  readonly seed: number;
  readonly tally: Tally;
}

export async function sameOnBothPaths(paths: Paths, comparison: Comparison): Promise<void> {
  const { shape } = comparison.schema;
  const runner = new OrmRunner(shape);
  const { tally } = comparison;
  for (const feature of comparison.schema.features) tally.add(`schema with ${feature}`);

  let returnedRows: unknown;

  async function attempt(orm: LooseOrm, command: Command): Promise<Outcome> {
    try {
      const { value, rows } = await runner.runKeepingRows(orm, command);
      returnedRows = rows;
      return { status: 'returned', value };
    } catch (error) {
      const code = codeOf(error);
      if (code === undefined) {
        throw new Error(
          `a command failed outside the ORM and the database: ${fc.stringify(command)}`,
          { cause: error },
        );
      }
      tally.rejected(`${command.kind} ${code}`, error);
      return code === 'ORM.CAPABILITY_MISSING' && orm !== paths.reference
        ? { status: 'refused' }
        : { status: 'rejected', code };
    }
  }

  async function trace(
    orm: LooseOrm,
    sequence: readonly Command[],
    skipped: ReadonlySet<number>,
  ): Promise<Step[]> {
    const steps: Step[] = [];
    for (const [step, command] of sequence.entries()) {
      const outcome: Outcome = skipped.has(step)
        ? { status: 'refused' }
        : await attempt(orm, command);
      if (outcome.status === 'returned') {
        const { returned, read } = await runner.readBack(orm, command, returnedRows);
        expect(
          { step, command, read },
          'a returned row differs from the row read by its key straight after',
        ).toEqual({ step, command, read: returned });
        if (read.length > 0) tally.add(`${command.kind} read back`);
      }
      steps.push({ step, command, outcome, tables: await runner.readTables(orm) });
    }
    return steps;
  }

  async function prepared(sequence: Sequence): Promise<Record<string, unknown[]>> {
    await paths.clear();
    for (const command of sequence.existing) await attempt(paths.reference, command);
    return runner.readTables(paths.reference);
  }

  const varied = new Map(
    variationNames.map((name) => [name, paths.varied(variations[name])] as const),
  );

  await fc.assert(
    fc.asyncProperty(
      commands({ schema: shape, generatedKeys: comparison.generatedKeys }),
      fc.constantFrom(...variationNames),
      async (sequence, variation) => {
        const other = varied.get(variation);
        if (other === undefined) throw new Error(`no ORM ${variation}`);
        await prepared(sequence);
        const onVaried = await trace(other, sequence.following, new Set());
        const refused = new Set(
          onVaried.filter(({ outcome }) => outcome.status === 'refused').map(({ step }) => step),
        );
        const initial = await prepared(sequence);
        const onReference = await trace(paths.reference, sequence.following, refused);
        expect({ path: variation, steps: onVaried }).toEqual({
          path: variation,
          steps: onReference,
        });
        tally.record(shape, initial, onReference, variation);
      },
    ),
    propertyOptions(comparison.runs, comparison.seed),
  );
}

export function expectExercised(tally: Tally, exercised: readonly string[]): void {
  if (runsAreOverridden()) return;
  expect(
    exercised.filter((key) => tally.count(key) === 0),
    `what happened: ${tally.report}`,
  ).toEqual([]);
}
