import type { ContractWithDomain } from '@internal/contract/types';
import {
  describeMigrationStatement,
  type MigrationPlannerConflict,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { SelectedVariant } from '@internal/mongo-contract';
import { InternalError } from '@internal/utils/internal-error';
import type {
  CastFieldCall,
  DataTransformCall,
  DeleteDocumentsCall,
  FillFieldCall,
  FillStoredKeyCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
  RenameFieldCall,
  RenameStoredKeyCall,
  ReplaceStoredValueCall,
  UnsetFieldCall,
} from './op-factory-call';
import { jsonPathText, storedKeyPath } from './stored-key-path';

export const ONE_AT_A_TIME =
  "MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents.";

const RENAME_ADVICE =
  'Make the change in two migrations: first rename the keys or fields to names nothing else uses and apply that; then rename them to their final names.';

const FILL_ADVICE =
  'Make the change in two migrations: first make the rename and apply it, without the new required field; then add the new field.';

const fillAfterRemovalAdvice = (noun: string) =>
  `Make the change in two migrations: first remove the old ${noun} and apply that; then add the new one.`;

const removeBeforeRenameAdvice = (noun: string) =>
  `Make the change in two migrations: first remove the ${noun} whose name the rename takes and apply that; then make the rename.`;

/** A call of the rewrite step of a plan. */
export type RewriteCall =
  | RenameFieldCall
  | CastFieldCall
  | DataTransformCall
  | FillFieldCall
  | UnsetFieldCall
  | RenameStoredKeyCall
  | RemoveStoredKeyCall
  | FillStoredKeyCall
  | ReplaceStoredValueCall
  | RemoveStoredValueCall
  | DeleteDocumentsCall;

/**
 * The discriminator values a call's filter selects documents by: those of one variant, or, for the
 * documents of a root model that lose a field some of its variants store, those holding none of
 * `values`.
 */
export type DiscriminatorFilter =
  | ({ readonly kind: 'variant' } & SelectedVariant)
  | { readonly kind: 'noneOf'; readonly field: string; readonly values: readonly unknown[] };

export function variantDiscriminatorFilter(
  variant: SelectedVariant | undefined,
): DiscriminatorFilter | undefined {
  return variant === undefined ? undefined : { kind: 'variant', ...variant };
}

/** One rewrite of a plan, with what the planner that built it knows about what it reads and writes. */
export interface OrderedRewrite {
  readonly call: RewriteCall;
  /** The statements the call carries out. */
  readonly statements: readonly ResolvedMigrationStatement[];
  /** How to make a change of stored values in two migrations; `undefined` for keys and fields. */
  readonly twoMigrationsAdvice: string | undefined;
  /** The stored value a replacement writes; `undefined` for any other call. */
  readonly writtenValue: unknown;
  /** The stored name of the field a data transform writes; `undefined` for any other call. */
  readonly transformedField: string | undefined;
  /** The discriminator values the call's filter selects documents by; for a delete, the variant whose documents it deletes. */
  readonly discriminatorFilter: DiscriminatorFilter | undefined;
}

/** A field of a collection's documents, or, with a `path`, a key inside one. */
interface KeyPlace {
  readonly kind: 'key';
  readonly collection: string;
  readonly field: string;
  readonly path: string | undefined;
}

/** A stored value of a field, or, with a `path`, of a key inside one. */
interface ValuePlace {
  readonly kind: 'value';
  readonly collection: string;
  readonly field: string;
  readonly path: string | undefined;
  readonly value: unknown;
}

type Place = KeyPlace | ValuePlace;

/** What an operation does to a place: moves what it holds to another, empties it, or writes it. */
type Role = 'moves' | 'empties' | 'writes';

/**
 * What an operation empties, which its postcheck asserts no document holds, what it writes, and
 * what its filter reads to select documents.
 */
interface Access {
  readonly role: Role;
  readonly reads: readonly Place[];
  readonly writes: readonly Place[];
  readonly filterReads: readonly Place[];
}

function key(collection: string, field: string, path: string | undefined = undefined): KeyPlace {
  return {
    kind: 'key',
    collection,
    field,
    path: path === undefined ? undefined : parsedPath(field, path).text,
  };
}

function parsedPath(field: string, path: string) {
  const parsed = storedKeyPath(field, path);
  if (!parsed.ok) {
    throw new InternalError(
      `The planner wrote path "${path}" for field ${field}, which does not parse`,
    );
  }
  return { ...parsed.value, text: jsonPathText(parsed.value.path.steps) };
}

function renamedPath(field: string, path: string, to: string): string {
  return jsonPathText([...parsedPath(field, path).objects, { kind: 'member', name: to }]);
}

function value(
  at: { readonly collection: string; readonly field: string; readonly path?: string | undefined },
  stored: unknown,
): ValuePlace {
  return {
    kind: 'value',
    collection: at.collection,
    field: at.field,
    path: at.path === undefined ? undefined : parsedPath(at.field, at.path).text,
    value: stored,
  };
}

function filterReadsOf(collection: string, filter: DiscriminatorFilter | undefined): Place[] {
  if (filter === undefined) return [];
  const values = filter.kind === 'variant' ? [filter.value] : filter.values;
  return [
    key(collection, filter.field),
    ...values.map((each) => value({ collection, field: filter.field }, each)),
  ];
}

function plannerFact<T>(fact: T | undefined, what: string, call: RewriteCall): T {
  if (fact === undefined) {
    throw new InternalError(`The planner did not say ${what} of ${call.label}`);
  }
  return fact;
}

function accessOf(rewrite: OrderedRewrite): Access {
  const { call } = rewrite;
  const access = (role: Role, collection: string, reads: Place[], writes: Place[]): Access => ({
    role,
    reads,
    writes,
    filterReads: filterReadsOf(collection, rewrite.discriminatorFilter),
  });
  switch (call.factoryName) {
    case 'renameField':
      return access(
        'moves',
        call.collection,
        [key(call.collection, call.from)],
        [key(call.collection, call.to)],
      );
    case 'unsetField':
      return access('empties', call.collection, [key(call.collection, call.field)], []);
    case 'fillField':
      return access('writes', call.collection, [], [key(call.collection, call.field)]);
    case 'castField':
      return access('writes', call.collection, [], [key(call.collection, call.field)]);
    case 'dataTransform': {
      const field = plannerFact(rewrite.transformedField, 'the field written', call);
      return access('writes', call.collection, [], [key(call.collection, field)]);
    }
    case 'renameStoredKey': {
      const { collection, field, path, to } = call.options;
      return access(
        'moves',
        collection,
        [key(collection, field, path)],
        [key(collection, field, renamedPath(field, path, to))],
      );
    }
    case 'removeStoredKey': {
      const { collection, field, path } = call.options;
      return access('empties', collection, [key(collection, field, path)], []);
    }
    case 'fillStoredKey': {
      const { collection, field, path } = call.options;
      return access('writes', collection, [], [key(collection, field, path)]);
    }
    case 'replaceStoredValue': {
      const written = plannerFact(rewrite.writtenValue, 'the value written', call);
      return access(
        'moves',
        call.options.collection,
        [value(call.options, call.options.from)],
        [value(call.options, written)],
      );
    }
    case 'removeStoredValue':
      return access(
        'empties',
        call.options.collection,
        [value(call.options, call.options.value)],
        [],
      );
    case 'deleteDocuments': {
      const deleted = plannerFact(rewrite.discriminatorFilter, 'the variant deleted', call);
      const { collection } = call.options;
      const [field, ...values] = filterReadsOf(collection, deleted);
      return {
        role: 'empties',
        reads: values,
        writes: [],
        filterReads: field === undefined ? [] : [field],
      };
    }
    default: {
      const unmodelled: never = call;
      throw new InternalError(`No reads and writes are known for ${String(unmodelled)}`);
    }
  }
}

function samePlace(write: Place, read: Place): boolean {
  if (
    write.kind !== read.kind ||
    write.collection !== read.collection ||
    write.field !== read.field ||
    write.path !== read.path
  ) {
    return false;
  }
  return write.kind === 'key' || (read.kind === 'value' && write.value === read.value);
}

function placeNoun(place: Place): string {
  if (place.kind === 'value') return 'value';
  return place.path === undefined ? 'field' : 'key';
}

interface Accessed {
  readonly rewrite: OrderedRewrite;
  readonly access: Access;
}

function touchedFieldsOf(accessed: readonly Accessed[]): ReadonlySet<string> {
  return new Set(
    accessed.flatMap(({ access }) =>
      [...access.reads, ...access.writes].flatMap((place) =>
        place.path === undefined ? [`${place.collection}\0${place.field}`] : [],
      ),
    ),
  );
}

/**
 * Whether two operations select documents of different variants by the same discriminator field,
 * in a collection where no operation of the plan changes that field or its values, so that they
 * never act on the same documents.
 */
function selectDifferentVariants(
  a: OrderedRewrite,
  b: OrderedRewrite,
  collection: string,
  touched: ReadonlySet<string>,
): boolean {
  const first = a.discriminatorFilter;
  const second = b.discriminatorFilter;
  return (
    first?.kind === 'variant' &&
    second?.kind === 'variant' &&
    first.field === second.field &&
    first.value !== second.value &&
    !touched.has(`${collection}\0${first.field}`)
  );
}

interface Overlap {
  readonly writer: Accessed;
  readonly reader: Accessed;
  readonly place: Place;
}

function overlapsOf(accessed: readonly Accessed[]): readonly Overlap[] {
  const touched = touchedFieldsOf(accessed);
  return accessed.flatMap((writer) =>
    accessed.flatMap((reader): Overlap[] => {
      if (writer.rewrite.call === reader.rewrite.call) return [];
      const place = writer.access.writes.find(
        (write) =>
          reader.access.reads.some((read) => samePlace(write, read)) &&
          !selectDifferentVariants(writer.rewrite, reader.rewrite, write.collection, touched),
      );
      return place === undefined ? [] : [{ writer, reader, place }];
    }),
  );
}

function adviceOf(overlap: Overlap): string {
  const noun = placeNoun(overlap.place);
  if (overlap.place.kind === 'value') {
    return (
      overlap.reader.rewrite.twoMigrationsAdvice ??
      overlap.writer.rewrite.twoMigrationsAdvice ??
      RENAME_ADVICE
    );
  }
  const writer = overlap.writer.access.role;
  const reader = overlap.reader.access.role;
  if (writer === 'writes') {
    return reader === 'empties' ? fillAfterRemovalAdvice(noun) : FILL_ADVICE;
  }
  return reader === 'empties' ? removeBeforeRenameAdvice(noun) : RENAME_ADVICE;
}

/** Whether `before` must run before `after`, because `before` writes what `after`'s filter reads, or `after` empties what `before`'s filter reads. */
function filterNeedsFirst(before: Accessed, after: Accessed): boolean {
  return (
    before !== after &&
    (before.access.writes.some((write) =>
      after.access.filterReads.some((read) => samePlace(write, read)),
    ) ||
      after.access.reads.some((emptied) =>
        before.access.filterReads.some((read) => samePlace(emptied, read)),
      ))
  );
}

/**
 * The rewrites in the order given, except that an operation whose filter reads a field or value
 * runs after any operation that writes it and before any operation that empties it, so the filter
 * selects the documents it was written for. Run again after a later operation stops, such an
 * operation finds the documents as its postcheck expects.
 */
export function inFilterOrder(rewrites: readonly OrderedRewrite[]): readonly OrderedRewrite[] {
  const pending = rewrites.map((rewrite) => ({ rewrite, access: accessOf(rewrite) }));
  const ordered: OrderedRewrite[] = [];
  while (pending.length > 0) {
    const next =
      pending.find((each) => !pending.some((other) => filterNeedsFirst(other, each))) ?? pending[0];
    if (next === undefined) break;
    ordered.push(next.rewrite);
    pending.splice(pending.indexOf(next), 1);
  }
  return ordered;
}

/** The first pair in which an operation runs before another that must run first, because of what their filters read. */
function filterConflictOf(
  accessed: readonly Accessed[],
): { readonly earlier: Accessed; readonly later: Accessed } | undefined {
  for (const [index, later] of accessed.entries()) {
    const earlier = accessed.slice(0, index).find((each) => filterNeedsFirst(later, each));
    if (earlier !== undefined) return { earlier, later };
  }
  return undefined;
}

function distinct<T>(items: readonly T[]): readonly T[] {
  return [...new Set(items)];
}

function refusal(
  involved: readonly OrderedRewrite[],
  reason: string,
  why: string,
  contracts: { readonly fromContract: ContractWithDomain; readonly contract: ContractWithDomain },
): MigrationPlannerConflict {
  const statements = distinct(involved.flatMap((rewrite) => rewrite.statements));
  const [refused] = statements;
  if (refused === undefined) {
    return { kind: 'unsupportedOperation', summary: `Cannot plan the migration: ${reason}`, why };
  }
  return {
    kind: 'statementRefused',
    summary: `Cannot ${describeMigrationStatement(refused, contracts.fromContract, contracts.contract)}: ${reason}`,
    why,
    refusedStatement: refused,
    leaveOut: statements,
  };
}

/**
 * The refusal of a plan in which one operation writes a field, key or value that another operation
 * of the same plan empties: a chain or a swap of renames or replacements, a fill of a key a rename
 * moves away, a rename onto a name whose field the plan removes, or a delete of documents whose
 * discriminator value a replacement writes. MongoDB applies a migration's operations one at a
 * time, without a transaction, and a re-run after a later operation stops runs again every
 * operation whose postcheck does not hold, so such an operation would act on what the other wrote.
 * Two operations that select different variants by a discriminator field the plan does not change
 * never meet. Also refused: an operation whose filter reads what an earlier operation empties or a
 * later one writes, an order `inFilterOrder` could not avoid. The refusal names the first statement
 * involved, lists the operations, and leaves out every statement involved.
 */
export function overlapRefusal(
  rewrites: readonly OrderedRewrite[],
  contracts: { readonly fromContract: ContractWithDomain; readonly contract: ContractWithDomain },
): MigrationPlannerConflict | undefined {
  const accessed = rewrites.map((rewrite) => ({ rewrite, access: accessOf(rewrite) }));
  const overlaps = overlapsOf(accessed);
  const [first] = overlaps;
  if (first !== undefined) {
    const involved = rewrites.filter((rewrite) =>
      overlaps.some(
        ({ writer, reader }) => writer.rewrite === rewrite || reader.rewrite === rewrite,
      ),
    );
    const noun = placeNoun(first.place);
    const operations = involved.map(({ call }) => call.label).join('; ');
    return refusal(
      involved,
      `the migration writes a ${noun} that another of its operations reads (${operations})`,
      `${ONE_AT_A_TIME} An operation that reads a ${noun} another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. ${adviceOf(first)}`,
      contracts,
    );
  }
  const conflict = filterConflictOf(accessed);
  if (conflict === undefined) return undefined;
  const involved = [conflict.earlier.rewrite, conflict.later.rewrite];
  return refusal(
    involved,
    `the filter of one of its operations reads what another changes (${involved.map(({ call }) => call.label).join('; ')})`,
    `An operation selects its documents by its filter when it runs, so it must run after the operations that write what its filter reads and before those that empty it, and these operations need both. Make the change in two migrations: first only "${conflict.later.rewrite.call.label}" and apply that; then the rest.`,
    contracts,
  );
}
