import {
  asNamespaceId,
  type Contract,
  type ContractEnum,
  type ContractValueObjectField,
  type JsonValue,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import type { CodecLookupWithDescriptors, CodecRef } from '@internal/framework-components/codec';
import { codecForRef, readContractValue } from '@internal/framework-components/codec';
import {
  type EnumValueCoordinate,
  enumValueStatementText,
  modelStatementText,
  type ResolvedEnumValueRenameStatement,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { invariant } from '@internal/utils/assertions';
import { notOk, ok, type Result } from '@internal/utils/result';
import { structuredError } from '@internal/utils/structured-error';
import { buildColumnCodecRef } from './contract-to-schema-ir';
import { jsonPathText } from './json-path';
import { isSqlModelStorage, tableControlPolicy } from './model-storage';
import { joinedList } from './plan-text';
import type { SchemaTables } from './schema-tables';
import type { SqlPlannerConflict } from './types';
import { type UnlistedValueObjectPlace, valueObjectPlaces } from './value-object-field-planning';

/** A stored value of an enum: the only values a rewrite compares and writes. */
export type StoredEnumValue = string | number;

/**
 * One column's rewrite of one stored value of an enum: `to` replaces `from`, or, when `to` is
 * absent, `from` is removed. The column is named as the destination contract stores it.
 */
export interface StoredValueRewrite {
  /** The enum value whose stored value is rewritten, as the origin contract names it. */
  readonly enumValue: EnumValueCoordinate;
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  /** The column's codec, which writes `from` and `to` as the database stores them; none for a member inside JSON, whose value is compared as a JSON value. */
  readonly codecRef: CodecRef | undefined;
  /** Whether the column holds a list of the enum's values. */
  readonly many: boolean;
  /** The member of a value object inside the column's JSON that holds the value, if any. */
  readonly member: StoredValueMember | undefined;
  readonly from: StoredEnumValue;
  readonly to: StoredEnumValue | undefined;
  /** The rename statement the rewrite carries out, if any. */
  readonly statement: ResolvedEnumValueRenameStatement | undefined;
}

/** One replacement of a stored value by another. */
export interface StoredValueReplacement {
  readonly from: StoredEnumValue;
  readonly to: StoredEnumValue;
}

/** A member of a value object, inside the JSON of a column, that the enum types. */
export interface StoredValueMember {
  /** The RFC 9535 path from the column's value to the member, ending at `[*]` for a list member. */
  readonly path: string;
  /** Whether the member takes JSON `null`, which a removal then writes. */
  readonly nullable: boolean;
}

type EnumColumn = Pick<
  StoredValueRewrite,
  'namespaceId' | 'table' | 'column' | 'codecRef' | 'many' | 'member'
>;

function sameValue(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function enumOf(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  name: string,
): ContractEnum | undefined {
  return contract.domain.namespaces[namespaceId]?.enum?.[name];
}

/** The columns of the destination whose fields the enum types, in managed tables. */
function columnsTypedBy(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  enumName: string,
): readonly EnumColumn[] {
  const found = new Map<string, EnumColumn>();
  for (const namespace of Object.values(contract.domain.namespaces)) {
    for (const model of Object.values(namespace.models)) {
      const { storage } = model;
      if (!isSqlModelStorage(storage)) continue;
      for (const [fieldName, field] of Object.entries(model.fields)) {
        const ref = field.valueSet;
        if (
          ref === undefined ||
          ref.plane !== 'domain' ||
          ref.entityKind !== 'enum' ||
          ref.spaceId !== undefined ||
          ref.namespaceId !== namespaceId ||
          ref.entityName !== enumName
        ) {
          continue;
        }
        const column = storage.fields[fieldName]?.column;
        if (column === undefined) continue;
        const stored =
          contract.storage.namespaces[storage.namespaceId]?.entries.table?.[storage.table]?.columns[
            column
          ];
        if (stored === undefined) continue;
        const location = { namespaceId: storage.namespaceId, table: storage.table };
        if (tableControlPolicy(contract, location) !== 'managed') continue;
        found.set(JSON.stringify([storage.namespaceId, storage.table, column]), {
          ...location,
          column,
          codecRef: buildColumnCodecRef(stored, undefined),
          many: stored.many !== false && stored.many !== undefined,
          member: undefined,
        });
      }
    }
  }
  return [...found.values()];
}

function isMany(many: ContractValueObjectField['many']): boolean {
  return many !== undefined && many !== false;
}

/**
 * The members of value objects, in the destination's columns, that the enum's storage value set
 * types: each column and path where the destination stores the value object.
 */
function membersTypedBy(
  contract: Contract<SqlStorage>,
  placesOf: ReturnType<typeof valueObjectPlaces>,
  namespaceId: string,
  enumName: string,
): Result<readonly EnumColumn[], UnlistedValueObjectPlace> {
  const found: EnumColumn[] = [];
  for (const { coordinate, valueObject } of valueObjectsWithCoordinates(contract.storage)) {
    const typed = Object.entries(valueObject.fields).filter(
      ([, field]) =>
        field.valueSet !== undefined &&
        field.valueSet.spaceId === undefined &&
        field.valueSet.namespaceId === namespaceId &&
        field.valueSet.entityName === enumName,
    );
    if (typed.length === 0) continue;
    const places = placesOf(coordinate);
    if (!places.ok) return places;
    for (const [name, field] of typed) {
      for (const { steps, ...place } of places.value) {
        found.push({
          ...place,
          codecRef: undefined,
          many: false,
          member: {
            path: jsonPathText([
              ...steps,
              { kind: 'member', name },
              ...(isMany(field.many) ? [{ kind: 'wildcard' } as const] : []),
            ]),
            nullable: field.nullable,
          },
        });
      }
    }
  }
  return ok(found);
}

function enumText(enums: EnumComparison, value: EnumValueCoordinate): string {
  return modelStatementText(enums.fromContract, {
    namespaceId: value.namespaceId,
    model: value.enum,
  });
}

/** How a refusal names a change that no statement asks for: the removal of a value, or a member's new stored value. */
function changeText(enums: EnumComparison, change: StoredChange): string {
  const member = enumValueStatementText(enums.fromContract, change.enumValue);
  return change.to === undefined
    ? `Cannot remove enum value "${member}"`
    : `Cannot change the stored value of enum value "${member}" from ${enums.text(change.from)} to ${enums.text(change.to)}`;
}

function unlistedRefusal(
  contract: Contract<SqlStorage>,
  enums: EnumComparison,
  changes: readonly StoredChange[],
  { column, reach }: UnlistedValueObjectPlace,
): SqlPlannerConflict {
  const where = `column "${column.column}" of "${column.table}"`;
  const reason =
    reach.kind === 'containsItself'
      ? `${where} holds it inside value object "${reach.valueObject}", which contains itself, so the JSON can hold it at any depth`
      : `${where} holds a ${reach.kind} of value objects`;
  const why =
    reach.kind === 'containsItself'
      ? 'The plan rewrites an enum value inside JSON at every path from a column to its member, and a value object that contains itself has no last path.'
      : 'The plan rewrites an enum value inside JSON only in a column that holds a value object or a list of them.';
  const [first] = changes;
  invariant(first !== undefined, 'an enum with no changed value plans no rewrite to refuse');
  const routes = `Keep the members and stored values of enum "${enumText(enums, first.enumValue)}" as the origin contract has them, and plan again.`;
  const statement = changes.find((change) => change.statement !== undefined)?.statement;
  if (statement === undefined) {
    return {
      kind: 'unsupportedOperation',
      summary: `${changeText(enums, first)}: ${reason}`,
      why: `${why} ${routes}`,
    };
  }
  return {
    kind: 'statementRefused',
    summary: `Cannot rename enum value "${enumValueStatementText(enums.fromContract, statement.from)}" to "${enumValueStatementText(contract, statement.to)}": ${reason}`,
    why: `${why} ${routes}`,
    refusedStatement: statement,
  };
}

function isStoredEnumValue(value: JsonValue): value is StoredEnumValue {
  return typeof value === 'string' || typeof value === 'number';
}

type CodecSource = Pick<CodecLookupWithDescriptors, 'descriptorFor'>;

/** A stored value as messages write it: a number without quotes, as the enum's codec reads it. */
function valueText(value: JsonValue, codec: StoredValueCodec): string {
  const built = codecForRef(codec.codecs, codec.codecRef);
  if (built === undefined) return JSON.stringify(value);
  try {
    const read: unknown = readContractValue(built, value, codec.codecRef.typeParams);
    return typeof read === 'number' || typeof read === 'bigint'
      ? String(read)
      : JSON.stringify(value);
  } catch {
    return JSON.stringify(value);
  }
}

function unsupportedValue(
  contract: Contract<SqlStorage>,
  value: EnumValueCoordinate,
  stored: JsonValue,
): SqlPlannerConflict {
  const text = enumValueStatementText(contract, value);
  return {
    kind: 'unsupportedOperation',
    summary: `Cannot rewrite enum value "${text}": its stored value ${JSON.stringify(stored)} is not a string or a number`,
    why: `The plan rewrites the rows that hold a removed, renamed or changed enum value, and it compares only string and number values. Rewrite the rows that hold enum value "${text}" yourself, then plan again.`,
  };
}

/** What changes for one member of the origin enum: its stored value `from` becomes `to`, or, with no `to`, is removed. */
interface ValueChange<TValue extends JsonValue = JsonValue> {
  readonly enumValue: EnumValueCoordinate;
  readonly from: TValue;
  readonly to: TValue | undefined;
  readonly statement: ResolvedEnumValueRenameStatement | undefined;
}

type StoredChange = ValueChange<StoredEnumValue>;

interface EnumComparison {
  readonly fromContract: Contract<SqlStorage>;
  readonly contract: Contract<SqlStorage>;
  readonly originEnum: ContractEnum;
  readonly destinationEnum: ContractEnum;
  readonly text: (value: JsonValue) => string;
}

function stillStoredRefusal(
  statement: ResolvedEnumValueRenameStatement,
  enums: EnumComparison,
  stored: JsonValue,
  holder: string,
): SqlPlannerConflict {
  const holderText = enumValueStatementText(enums.contract, { ...statement.to, member: holder });
  const value = enums.text(stored);
  return {
    kind: 'statementRefused',
    summary: `Cannot rename enum value "${enumValueStatementText(enums.fromContract, statement.from)}" to "${enumValueStatementText(enums.contract, statement.to)}": the destination enum still stores ${value}, as enum value "${holderText}"`,
    why: `A rename changes the stored value in every row that holds it, so the rows that hold ${value} for "${holderText}" would change too. Leave out this statement.`,
    refusedStatement: statement,
  };
}

function mergingRefusal(
  statement: ResolvedEnumValueRenameStatement,
  enums: EnumComparison,
  from: JsonValue,
  to: JsonValue,
  holder: string,
): SqlPlannerConflict {
  const holderText = enumValueStatementText(enums.fromContract, {
    ...statement.from,
    member: holder,
  });
  return {
    kind: 'statementRefused',
    summary: `Cannot rename enum value "${enumValueStatementText(enums.fromContract, statement.from)}" to "${enumValueStatementText(enums.contract, statement.to)}": the origin enum already stores ${enums.text(to)}, as enum value "${holderText}"`,
    why: `A rename changes ${enums.text(from)} to ${enums.text(to)} in every row that holds it, which merges its data with the data of "${holderText}". Leave out this statement. To merge them on purpose, plan the change with migration plan and write this.replaceStoredValue(...) in the migration.ts it writes.`,
    refusedStatement: statement,
  };
}

/** A change of a cycle: every value in a cycle moves to another. */
type CycleMove = StoredChange & { readonly to: StoredEnumValue };

function cycleMoves(cycle: readonly StoredChange[]): readonly [CycleMove, ...CycleMove[]] {
  const moves = cycle.map((change) => {
    const { to } = change;
    invariant(to !== undefined, 'a cycle of stored values moves each value to another');
    return { ...change, to };
  });
  const [first, ...rest] = moves;
  invariant(first !== undefined, 'a cycle has a change');
  return [first, ...rest];
}

/** The enum value a change gives its new stored value, as the destination contract names it. */
function destinationMemberText(enums: EnumComparison, change: StoredChange): string {
  return change.statement === undefined
    ? enumValueStatementText(enums.fromContract, change.enumValue)
    : enumValueStatementText(enums.contract, change.statement.to);
}

const CYCLE_WHY =
  'The plan rewrites a changed stored value in every row that holds it, one value after another, and no order of the rewrites moves values in a cycle.';

/**
 * The route through a stored value no member stores, which works on both commands: a plan that
 * gives the first enum value of the cycle that value and the others their new ones, so their
 * rewrites form a chain, then a plan that gives the first its new value.
 */
function cycleTwoPlans(
  moves: readonly [CycleMove, ...CycleMove[]],
  enums: EnumComparison,
  swap: StoredEnumValue,
): string {
  const [first, ...rest] = moves;
  const withStatements = moves.some(({ statement }) => statement !== undefined);
  const others = joinedList(
    rest.map(
      (move) => `"${destinationMemberText(enums, move)}" the stored value ${enums.text(move.to)}`,
    ),
  );
  const member = `"${destinationMemberText(enums, first)}"`;
  return `Make the change in two plans: first give ${member} a stored value no member stores, such as ${enums.text(swap)}, and give ${others}, and plan and apply that${withStatements ? ' with the same statements' : ''}; then give ${member} the stored value ${enums.text(first.to)}, and plan again${withStatements ? ' without them' : ''}.`;
}

function cycleRefusal(
  statement: ResolvedEnumValueRenameStatement,
  cycle: readonly StoredChange[],
  enums: EnumComparison,
  taken: readonly JsonValue[],
): SqlPlannerConflict {
  const moves = cycleMoves(cycle);
  const swap = temporaryValue(moves[0].from, taken);
  const listed = joinedList(
    moves.map(({ from, to }) => `${enums.text(from)} to ${enums.text(to)}`),
  );
  return {
    kind: 'statementRefused',
    summary: `Cannot rename enum value "${enumValueStatementText(enums.fromContract, statement.from)}" to "${enumValueStatementText(enums.contract, statement.to)}": the renames move stored values in a cycle, ${listed}, and a rewrite of one would overwrite the other before it is read`,
    why: `${CYCLE_WHY} ${cycleTwoPlans(moves, enums, swap)}`,
    refusedStatement: statement,
  };
}

/** A member that keeps its name and takes the stored value `to`, which `holder` keeps in the origin enum, so their data would merge. */
function changeMergingRefusal(
  change: StoredChange,
  to: StoredEnumValue,
  holder: string,
  enums: EnumComparison,
): SqlPlannerConflict {
  const member = enumValueStatementText(enums.fromContract, change.enumValue);
  const holderText = enumValueStatementText(enums.fromContract, {
    ...change.enumValue,
    member: holder,
  });
  const fromText = enums.text(change.from);
  const toText = enums.text(to);
  return {
    kind: 'unsupportedOperation',
    summary: `${changeText(enums, change)}: the origin enum stores ${toText} as enum value "${holderText}"`,
    why: `A changed stored value is rewritten in every row that holds it, so the rows of "${member}" would hold ${toText} as the rows of "${holderText}" do, and their data would merge. Make the change in two plans: first remove enum value "${holderText}", and plan and apply that; then give "${member}" the stored value ${toText}, and plan again. The first plan asks about the rows that hold ${toText}. If you answer it with --delete ${holderText}, a column that takes no NULL cannot keep those rows: before that plan applies, delete them in the database, or set them to ${fromText} there to merge their data with the data of "${member}" on purpose.`,
  };
}

/** Members that keep their names and move stored values in a cycle. */
function changeCycleRefusal(
  cycle: readonly StoredChange[],
  enums: EnumComparison,
  taken: readonly JsonValue[],
): SqlPlannerConflict {
  const moves = cycleMoves(cycle);
  const [first] = moves;
  const swap = temporaryValue(first.from, taken);
  const members = moves.map(
    ({ enumValue }) => `"${enumValueStatementText(enums.fromContract, enumValue)}"`,
  );
  return {
    kind: 'unsupportedOperation',
    summary: `Cannot change the stored values of enum "${enumText(enums, first.enumValue)}": enum values ${joinedList(members)} move stored values in a cycle, ${joinedList(moves.map(({ from, to }) => `${enums.text(from)} to ${enums.text(to)}`))}, and a rewrite of one would overwrite the other before it is read`,
    why: `${CYCLE_WHY} ${cycleTwoPlans(moves, enums, swap)}`,
  };
}

/**
 * What changes for each member of the origin enum. A rename statement gives a member the stored
 * value of the member it names. A member the destination has under the same name takes that
 * member's stored value, even when another member had it before. A member the destination lacks is
 * kept when the destination still stores its value, under another name; otherwise its value is
 * removed.
 */
function valueChanges(
  enums: EnumComparison,
  enumValueOf: (member: string) => EnumValueCoordinate,
  statementOf: (member: string) => ResolvedEnumValueRenameStatement | undefined,
): readonly ValueChange[] {
  const changes: ValueChange[] = [];
  for (const member of enums.originEnum.members) {
    const enumValue = enumValueOf(member.name);
    const statement = statementOf(member.name);
    const named = statement?.to.member ?? member.name;
    const target = enums.destinationEnum.members.find(({ name }) => name === named);
    if (target !== undefined) {
      if (!sameValue(target.value, member.value)) {
        changes.push({ enumValue, from: member.value, to: target.value, statement });
      }
      continue;
    }
    if (statement !== undefined) continue;
    if (enums.destinationEnum.members.some(({ value }) => sameValue(value, member.value))) continue;
    changes.push({ enumValue, from: member.value, to: undefined, statement: undefined });
  }
  return changes;
}

/**
 * Orders the changes so each runs before the change that writes its old value: in a chain, the
 * last value moves first. A cycle has no such order; it comes out as the changes in it, from the
 * first change of the origin enum's order around.
 */
function orderChanges(
  changes: readonly StoredChange[],
): readonly { readonly changes: readonly StoredChange[]; readonly cycle: boolean }[] {
  const bySource = new Map(changes.map((change) => [JSON.stringify(change.from), change]));
  const placed = new Set<StoredChange>();
  const groups: { readonly changes: readonly StoredChange[]; readonly cycle: boolean }[] = [];
  for (const start of changes) {
    if (placed.has(start)) continue;
    const path: StoredChange[] = [];
    let cycle = false;
    for (
      let change: StoredChange | undefined = start;
      change !== undefined && !placed.has(change);
      change = change.to === undefined ? undefined : bySource.get(JSON.stringify(change.to))
    ) {
      if (path.includes(change)) {
        cycle = true;
        break;
      }
      path.push(change);
    }
    for (const change of path) placed.add(change);
    groups.push(cycle ? { changes: path, cycle } : { changes: [...path].reverse(), cycle });
  }
  return groups;
}

/** A value no member of either enum stores, of the kind of `value`: the next whole number, or a marked string. */
function temporaryValue(value: StoredEnumValue, taken: readonly JsonValue[]): StoredEnumValue {
  const numbers = taken.flatMap((stored) => {
    const number = typeof stored === 'string' ? Number(stored) : stored;
    return typeof number === 'number' && Number.isFinite(number) ? [number] : [];
  });
  const nextWholeNumber = numbers.length === 0 ? 0 : Math.floor(Math.max(...numbers)) + 1;
  if (typeof value === 'number') return nextWholeNumber;
  if (/^-?\d+$/.test(value)) return String(nextWholeNumber);
  let candidate = 'prisma_swap';
  while (taken.some((stored) => sameValue(stored, candidate))) candidate = `${candidate}_`;
  return candidate;
}

/**
 * The rewrites of stored enum values a plan makes. Enums are compared by the stored value of each
 * member (see `valueChanges`). A changed value is rewritten in every column, in the working schema,
 * whose field the destination enum types: a rename statement, or a member that keeps its name,
 * replaces it, and a removed member's value is removed, which the plan asks about. Changes that
 * shift values along are ordered so none overwrites a value another still has to read. Changes that
 * move values in a cycle, or into a value another member of the origin enum keeps, are refused.
 * With no origin contract, nothing is known to have changed.
 */
export function planEnumValueRewrites(input: {
  readonly statements: readonly ResolvedMigrationStatement[];
  readonly fromContract: Contract<SqlStorage> | null;
  readonly contract: Contract<SqlStorage>;
  readonly tables: SchemaTables;
  /** The stack's codecs, which read stored values for messages. */
  readonly codecs: CodecSource;
}): Result<readonly StoredValueRewrite[], SqlPlannerConflict> {
  const { fromContract, contract } = input;
  if (fromContract === null) return ok([]);
  const renamedNamespaces = new Map<string, string>();
  const valueRenames: ResolvedEnumValueRenameStatement[] = [];
  for (const statement of input.statements) {
    if (statement.kind !== 'rename') continue;
    if (statement.entity === 'namespace') renamedNamespaces.set(statement.from, statement.to);
    if (statement.entity === 'enumValue') valueRenames.push(statement);
  }
  const placesOf = valueObjectPlaces(contract, input.tables);
  const rewrites: StoredValueRewrite[] = [];
  for (const [originNamespace, namespace] of Object.entries(fromContract.domain.namespaces)) {
    for (const [enumName, originEnum] of Object.entries(namespace.enum ?? {})) {
      const namespaceId = renamedNamespaces.get(originNamespace) ?? originNamespace;
      const destinationEnum = enumOf(contract, namespaceId, enumName);
      if (destinationEnum === undefined) continue;
      const codec: StoredValueCodec = {
        codecRef: { codecId: destinationEnum.codecId },
        codecs: input.codecs,
      };
      const enums: EnumComparison = {
        fromContract,
        contract,
        originEnum,
        destinationEnum,
        text: (value) => valueText(value, codec),
      };
      const changes = valueChanges(
        enums,
        (member) => ({ namespaceId: asNamespaceId(originNamespace), enum: enumName, member }),
        (member) =>
          valueRenames.find(
            (rename) =>
              rename.from.namespaceId === originNamespace &&
              rename.from.enum === enumName &&
              rename.from.member === member,
          ),
      );
      const checked: StoredChange[] = [];
      for (const change of changes) {
        const { from, to } = change;
        if (!isStoredEnumValue(from))
          return notOk(unsupportedValue(fromContract, change.enumValue, from));
        if (to !== undefined && !isStoredEnumValue(to))
          return notOk(unsupportedValue(fromContract, change.enumValue, to));
        checked.push({ ...change, from, to });
      }
      const changedFrom = (value: JsonValue) => checked.some(({ from }) => sameValue(from, value));
      const changedTo = (value: JsonValue) =>
        checked.some(({ to }) => to !== undefined && sameValue(to, value));
      const merging = (to: JsonValue) =>
        originEnum.members.find(({ value }) => sameValue(value, to) && !changedFrom(value));
      for (const { statement, from, to } of checked) {
        if (statement === undefined || to === undefined) continue;
        const holder = destinationEnum.members.find(({ value }) => sameValue(value, from));
        if (holder !== undefined && !changedTo(from)) {
          return notOk(stillStoredRefusal(statement, enums, from, holder.name));
        }
        const merged = merging(to);
        if (merged !== undefined) {
          return notOk(mergingRefusal(statement, enums, from, to, merged.name));
        }
      }
      if (checked.length === 0) continue;
      const members = membersTypedBy(contract, placesOf, namespaceId, enumName);
      if (!members.ok) return notOk(unlistedRefusal(contract, enums, checked, members.failure));
      const columns = [
        ...columnsTypedBy(contract, namespaceId, enumName).filter((column) =>
          input.tables.hasColumn(column.namespaceId, column.table, column.column),
        ),
        ...members.value,
      ];
      if (columns.length === 0) continue;
      const taken = [
        ...originEnum.members.map(({ value }) => value),
        ...destinationEnum.members.map(({ value }) => value),
      ];
      for (const change of checked) {
        if (change.statement !== undefined || change.to === undefined) continue;
        const merged = merging(change.to);
        if (merged !== undefined) {
          return notOk(changeMergingRefusal(change, change.to, merged.name, enums));
        }
      }
      for (const group of orderChanges(checked)) {
        if (group.cycle) {
          const refused = group.changes.find(({ statement }) => statement !== undefined)?.statement;
          return notOk(
            refused === undefined
              ? changeCycleRefusal(group.changes, enums, taken)
              : cycleRefusal(refused, group.changes, enums, taken),
          );
        }
        for (const change of group.changes) {
          for (const column of columns) {
            rewrites.push({
              enumValue: change.enumValue,
              ...column,
              from: change.from,
              to: change.to,
              statement: change.statement,
            });
          }
        }
      }
    }
  }
  return ok(rewrites);
}

/** The codec of the column a stored value is in, and the stack's codecs, which build it. */
export interface StoredValueCodec {
  readonly codecRef: CodecRef;
  readonly codecs: Pick<CodecLookupWithDescriptors, 'descriptorFor'>;
}

/**
 * The value the database stores for `value`, a stored value as the contract writes it: the column's
 * codec reads it as a value of its data type and writes it with `toWire`, as a literal default is
 * written. With no codec, or one the stack does not have, the value is used as written.
 */
export async function encodeStoredValue(
  value: StoredEnumValue,
  codec: StoredValueCodec | undefined,
): Promise<StoredEnumValue> {
  if (codec === undefined) return value;
  const built = codecForRef(codec.codecs, codec.codecRef);
  if (built === undefined) return value;
  const wire: unknown = await built.toWire(
    readContractValue(built, value, codec.codecRef.typeParams),
    {},
  );
  if (typeof wire === 'string' || typeof wire === 'number') return wire;
  if (typeof wire === 'bigint') return wire.toString();
  throw structuredError(
    'CONTRACT.ARGUMENT_INVALID',
    `Codec ${codec.codecRef.codecId} writes the stored value ${JSON.stringify(value)} as neither a string nor a number, which a migration cannot compare`,
    { meta: { what: 'stored value', codecId: codec.codecRef.codecId } },
  );
}
