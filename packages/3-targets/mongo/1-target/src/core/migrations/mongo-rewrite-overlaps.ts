import type { ContractWithDomain } from '@internal/contract/types';
import {
  describeMigrationStatement,
  type MigrationPlannerConflict,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { SelectedVariant } from '@internal/mongo-contract';
import { InternalError } from '@internal/utils/internal-error';
import type { FieldRename } from './mongo-storage-renames';
import { type UnansweredChange, unansweredChangesAdvice } from './mongo-unanswered-changes';
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

/** Advice to make a change as two changes to the contract, the first applied before the second is made. */
export function inTwoSteps(first: string, second: string): string {
  return `Make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: first ${first}; then ${second}.`;
}

const RENAME_ADVICE = inTwoSteps(
  'rename the keys or fields to names nothing else uses',
  'rename them to their final names',
);

const FILL_ADVICE = inTwoSteps(
  'make the rename, without the new required field',
  'add the new field',
);

const fillAfterRemovalAdvice = (noun: string) =>
  inTwoSteps(`remove the old ${noun}`, 'add the new one');

const removeBeforeRenameAdvice = (noun: string) =>
  inTwoSteps(`remove the ${noun} whose name the rename takes`, 'make the rename');

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

type RewriteCallNamed<Name extends RewriteCall['factoryName']> = Extract<
  RewriteCall,
  { readonly factoryName: Name }
>;

interface Selecting {
  /** The discriminator values the call's filter selects documents by. */
  readonly discriminatorFilter: DiscriminatorFilter | undefined;
}

/** What the planner that built a call knows about what it reads and writes, beyond the call itself. */
interface FactsByCall {
  readonly replaceStoredValue: Selecting & {
    /** The stored value the replacement writes. */
    readonly writtenValue: unknown;
  };
  readonly dataTransform: Selecting & {
    /** The stored name of the field the data transform writes. */
    readonly transformedField: string;
  };
  readonly deleteDocuments: {
    /** The variant whose documents the delete deletes. */
    readonly deletedVariant: SelectedVariant;
  };
}

type FactsOf<Name extends RewriteCall['factoryName']> = Name extends keyof FactsByCall
  ? FactsByCall[Name]
  : Selecting;

/** One rewrite of a plan, keyed by its call's kind, with the facts that kind needs. */
export type OrderedRewrite = {
  readonly [Name in RewriteCall['factoryName']]: {
    readonly kind: Name;
    readonly call: RewriteCallNamed<Name>;
    /** The statements the call carries out. */
    readonly statements: readonly ResolvedMigrationStatement[];
    /** How to make a change of stored values in two steps; `undefined` for keys and fields. */
    readonly twoMigrationsAdvice: string | undefined;
    /** The change the call makes when no statement carries it; `undefined` when a statement does, or the call answers no question. */
    readonly unanswered: UnansweredChange | undefined;
  } & FactsOf<Name>;
}[RewriteCall['factoryName']];

/** An `OrderedRewrite` without what the planner adds to every call: the statements, the advice and the unanswered change. */
export type RewriteFacts = OrderedRewrite extends infer Each
  ? Each extends OrderedRewrite
    ? Omit<Each, 'statements' | 'twoMigrationsAdvice' | 'unanswered'>
    : never
  : never;

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
  readonly empties: readonly Place[];
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

function accessOf(rewrite: OrderedRewrite): Access {
  if (rewrite.kind === 'deleteDocuments') {
    const { collection } = rewrite.call.options;
    const { field, value: deleted } = rewrite.deletedVariant;
    return {
      role: 'empties',
      empties: [value({ collection, field }, deleted)],
      writes: [],
      filterReads: [key(collection, field)],
    };
  }
  const selecting = (
    role: Role,
    collection: string,
    empties: Place[],
    writes: Place[],
  ): Access => ({
    role,
    empties,
    writes,
    filterReads: filterReadsOf(collection, rewrite.discriminatorFilter),
  });
  switch (rewrite.kind) {
    case 'renameField': {
      const { collection, from, to } = rewrite.call;
      return selecting('moves', collection, [key(collection, from)], [key(collection, to)]);
    }
    case 'unsetField': {
      const { collection, field } = rewrite.call;
      return selecting('empties', collection, [key(collection, field)], []);
    }
    case 'fillField':
    case 'castField': {
      const { collection, field } = rewrite.call;
      return selecting('writes', collection, [], [key(collection, field)]);
    }
    case 'dataTransform': {
      const { collection } = rewrite.call;
      return selecting('writes', collection, [], [key(collection, rewrite.transformedField)]);
    }
    case 'renameStoredKey': {
      const { collection, field, path, to } = rewrite.call.options;
      return selecting(
        'moves',
        collection,
        [key(collection, field, path)],
        [key(collection, field, renamedPath(field, path, to))],
      );
    }
    case 'removeStoredKey': {
      const { collection, field, path } = rewrite.call.options;
      return selecting('empties', collection, [key(collection, field, path)], []);
    }
    case 'fillStoredKey': {
      const { collection, field, path } = rewrite.call.options;
      return selecting('writes', collection, [], [key(collection, field, path)]);
    }
    case 'replaceStoredValue': {
      const { options } = rewrite.call;
      return selecting(
        'moves',
        options.collection,
        [value(options, options.from)],
        [value(options, rewrite.writtenValue)],
      );
    }
    case 'removeStoredValue': {
      const { options } = rewrite.call;
      return selecting('empties', options.collection, [value(options, options.value)], []);
    }
    default: {
      const unmodelled: never = rewrite;
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
      [...access.empties, ...access.writes].flatMap((place) =>
        place.path === undefined ? [`${place.collection}\0${place.field}`] : [],
      ),
    ),
  );
}

function discriminatorFilterOf(rewrite: OrderedRewrite): DiscriminatorFilter | undefined {
  return rewrite.kind === 'deleteDocuments'
    ? { kind: 'variant', ...rewrite.deletedVariant }
    : rewrite.discriminatorFilter;
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
  const first = discriminatorFilterOf(a);
  const second = discriminatorFilterOf(b);
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
          reader.access.empties.some((emptied) => samePlace(write, emptied)) &&
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
      after.access.empties.some((emptied) =>
        before.access.filterReads.some((read) => samePlace(emptied, read)),
      ))
  );
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

function refusal(
  involved: readonly OrderedRewrite[],
  reason: string,
  why: string,
  contracts: { readonly fromContract: ContractWithDomain; readonly contract: ContractWithDomain },
): MigrationPlannerConflict {
  const [refused] = involved.flatMap((rewrite) => rewrite.statements);
  if (refused === undefined) {
    return { kind: 'unsupportedOperation', summary: `Cannot plan the migration: ${reason}`, why };
  }
  return {
    kind: 'statementRefused',
    summary: `Cannot ${describeMigrationStatement(refused, contracts.fromContract, contracts.contract)}: ${reason}`,
    why,
    refusedStatement: refused,
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
 * later one writes, which the planner's order of the rewrites does not avoid. The refusal names the first statement
 * involved and lists the operations. It does not offer to leave the statements out and write the
 * operations by hand, since one hand-written migration would meet the same re-run. When an operation
 * involved makes a change no statement answers, and a statement could keep the data of a removal,
 * the refusal leads with the plan's unanswered changes and the statements that keep their data, and
 * ends with the route that works when every answer is `--delete`, which the planner cannot see.
 */
export function overlapRefusal(
  rewrites: readonly OrderedRewrite[],
  contracts: {
    readonly fromContract: ContractWithDomain;
    readonly contract: ContractWithDomain;
    /** The statements the plan carries out. */
    readonly statements: readonly ResolvedMigrationStatement[];
    /** The field renames the plan makes, those of its statements and those no statement asks for. */
    readonly fieldRenames: readonly FieldRename[];
  },
): MigrationPlannerConflict | undefined {
  const accessed = rewrites.map((rewrite) => ({ rewrite, access: accessOf(rewrite) }));
  const why = (involved: readonly OrderedRewrite[], reason: string, advice: string) => {
    const unanswered = involved.some(({ unanswered }) => unanswered !== undefined)
      ? unansweredChangesAdvice(
          rewrites.flatMap(({ unanswered }) => (unanswered === undefined ? [] : [unanswered])),
          contracts,
        )
      : undefined;
    return unanswered === undefined
      ? `${reason} ${advice}`
      : `${unanswered} ${reason} If every answer is --delete, the plan stays as it is: ${advice.charAt(0).toLowerCase()}${advice.slice(1)}`;
  };
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
      why(
        involved,
        `${ONE_AT_A_TIME} An operation that reads a ${noun} another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops.`,
        adviceOf(first),
      ),
      contracts,
    );
  }
  const conflict = filterConflictOf(accessed);
  if (conflict === undefined) return undefined;
  const involved = [conflict.earlier.rewrite, conflict.later.rewrite];
  return refusal(
    involved,
    `the filter of one of its operations reads what another changes (${involved.map(({ call }) => call.label).join('; ')})`,
    why(
      involved,
      'One of these operations finds its documents by what another changes, and the order the plan needs runs it on the wrong side of that change.',
      inTwoSteps(
        `make only the part of the change that "${conflict.later.rewrite.call.label}" carries out`,
        'the rest',
      ),
    ),
    contracts,
  );
}
