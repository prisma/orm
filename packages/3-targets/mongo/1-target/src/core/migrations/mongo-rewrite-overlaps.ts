import type { ContractWithDomain, JsonValue } from '@internal/contract/types';
import {
  describeMigrationStatement,
  type MigrationPlannerConflict,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { StoredValue } from './migration-factories';
import {
  DataTransformCall,
  DeleteDocumentsCall,
  FillFieldCall,
  FillStoredKeyCall,
  type OpFactoryCall,
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
  readonly value: StoredValue;
}

type Place = KeyPlace | ValuePlace;

/** What an operation's postcheck reads, and what the operation writes. */
interface Access {
  readonly reads: readonly Place[];
  readonly writes: readonly Place[];
}

/** One rewrite of a plan, in the order the plan runs it. */
export interface OrderedRewrite {
  readonly call: OpFactoryCall;
  /** The statements the call carries out. */
  readonly statements: readonly ResolvedMigrationStatement[];
  /** How to make a change of stored values in two migrations; `undefined` for keys and fields. */
  readonly twoMigrationsAdvice: string | undefined;
  /** The field a backfill transform writes; `undefined` for any other call. */
  readonly backfilledField: string | undefined;
}

function key(collection: string, field: string, path: string | undefined = undefined): KeyPlace {
  return {
    kind: 'key',
    collection,
    field,
    path: path === undefined ? undefined : canonicalPath(field, path),
  };
}

function canonicalPath(field: string, path: string): string {
  const parsed = storedKeyPath(field, path);
  return parsed.ok ? jsonPathText(parsed.value.path.steps) : path;
}

function renamedPath(field: string, path: string, to: string): string | undefined {
  const parsed = storedKeyPath(field, path);
  return parsed.ok
    ? jsonPathText([...parsed.value.objects, { kind: 'member', name: to }])
    : undefined;
}

function isStoredValue(value: unknown): value is StoredValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** The stored value an expression the planner writes for a replacement stores. */
function writtenValue(expression: JsonValue): StoredValue | undefined {
  if (isStoredValue(expression)) return expression;
  if (typeof expression !== 'object' || expression === null || Array.isArray(expression)) {
    return undefined;
  }
  const [entry, ...rest] = Object.entries(expression);
  if (entry === undefined || rest.length > 0) return undefined;
  const [operator, operand] = entry;
  if (operator === '$toDecimal' && typeof operand === 'string') return Number(operand);
  return ['$literal', '$toDouble', '$toLong'].includes(operator) && isStoredValue(operand)
    ? operand
    : undefined;
}

function value(
  at: { readonly collection: string; readonly field: string; readonly path?: string | undefined },
  stored: StoredValue,
): ValuePlace {
  return {
    kind: 'value',
    collection: at.collection,
    field: at.field,
    path: at.path === undefined ? undefined : canonicalPath(at.field, at.path),
    value: stored,
  };
}

function accessOf(rewrite: OrderedRewrite): Access {
  const { call } = rewrite;
  if (call instanceof RenameFieldCall) {
    return { reads: [key(call.collection, call.from)], writes: [key(call.collection, call.to)] };
  }
  if (call instanceof UnsetFieldCall) {
    return { reads: [key(call.collection, call.field)], writes: [] };
  }
  if (call instanceof FillFieldCall) {
    return { reads: [], writes: [key(call.collection, call.field)] };
  }
  if (call instanceof DataTransformCall) {
    return {
      reads: [],
      writes:
        rewrite.backfilledField === undefined
          ? []
          : [key(call.collection, rewrite.backfilledField)],
    };
  }
  if (call instanceof RenameStoredKeyCall) {
    const { collection, field, path, to } = call.options;
    const written = renamedPath(field, path, to);
    return {
      reads: [key(collection, field, path)],
      writes: written === undefined ? [] : [key(collection, field, written)],
    };
  }
  if (call instanceof RemoveStoredKeyCall) {
    const { collection, field, path } = call.options;
    return { reads: [key(collection, field, path)], writes: [] };
  }
  if (call instanceof FillStoredKeyCall) {
    const { collection, field, path } = call.options;
    return { reads: [], writes: [key(collection, field, path)] };
  }
  if (call instanceof ReplaceStoredValueCall) {
    const written = writtenValue(call.options.to);
    return {
      reads: [value(call.options, call.options.from)],
      writes: written === undefined ? [] : [value(call.options, written)],
    };
  }
  if (call instanceof RemoveStoredValueCall) {
    return { reads: [value(call.options, call.options.value)], writes: [] };
  }
  if (call instanceof DeleteDocumentsCall) {
    const [entry, ...rest] = Object.entries(call.options.filter);
    return entry !== undefined && rest.length === 0 && isStoredValue(entry[1])
      ? {
          reads: [value({ collection: call.options.collection, field: entry[0] }, entry[1])],
          writes: [],
        }
      : { reads: [], writes: [] };
  }
  return { reads: [], writes: [] };
}

/**
 * Whether a write reaches what a read reads. Filters are not compared: a filter written with the
 * origin's discriminator value and one written with the destination's can select the same documents.
 */
function reaches(write: Place, read: Place): boolean {
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

function isFill(call: OpFactoryCall): boolean {
  return (
    call instanceof FillFieldCall ||
    call instanceof FillStoredKeyCall ||
    call instanceof DataTransformCall
  );
}

interface Overlap {
  readonly writer: OrderedRewrite;
  readonly reader: OrderedRewrite;
  readonly place: Place;
}

function overlapsOf(rewrites: readonly OrderedRewrite[]): readonly Overlap[] {
  const accesses = rewrites.map((rewrite) => ({ rewrite, access: accessOf(rewrite) }));
  return accesses.flatMap((writer) =>
    accesses.flatMap((reader): Overlap[] => {
      if (writer.rewrite.call === reader.rewrite.call) return [];
      const place = writer.access.writes.find((write) =>
        reader.access.reads.some((read) => reaches(write, read)),
      );
      return place === undefined ? [] : [{ writer: writer.rewrite, reader: reader.rewrite, place }];
    }),
  );
}

function adviceOf(overlap: Overlap): string {
  if (isFill(overlap.writer.call) || isFill(overlap.reader.call)) return FILL_ADVICE;
  return overlap.reader.twoMigrationsAdvice ?? overlap.writer.twoMigrationsAdvice ?? RENAME_ADVICE;
}

function distinct<T>(items: readonly T[]): readonly T[] {
  return [...new Set(items)];
}

/**
 * The refusal of a plan in which one operation writes a field, key or value that another operation
 * of the same plan reads: a chain or a swap of renames or replacements, a fill of a key a rename
 * moves away, or a delete of documents whose discriminator value a replacement writes. MongoDB
 * applies a migration's operations one at a time, without a transaction, and a re-run after a later
 * operation stops runs again every operation whose postcheck does not hold, so such an operation
 * would act on what the other wrote. The refusal names the first statement involved, lists the
 * operations, and leaves out every statement involved.
 */
export function overlapRefusal(
  rewrites: readonly OrderedRewrite[],
  contracts: { readonly fromContract: ContractWithDomain; readonly contract: ContractWithDomain },
): MigrationPlannerConflict | undefined {
  const overlaps = overlapsOf(rewrites);
  const [first] = overlaps;
  if (first === undefined) return undefined;
  const involved = rewrites.filter((rewrite) =>
    overlaps.some(({ writer, reader }) => writer === rewrite || reader === rewrite),
  );
  const statements = distinct(involved.flatMap((rewrite) => rewrite.statements));
  const noun = placeNoun(first.place);
  const operations = involved.map(({ call }) => call.label).join('; ');
  const reason = `the migration writes a ${noun} that another of its operations reads (${operations})`;
  const why = `${ONE_AT_A_TIME} An operation that reads a ${noun} another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. ${adviceOf(first)}`;
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
