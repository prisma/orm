import {
  asNamespaceId,
  type Contract,
  type ContractEnum,
  type JsonValue,
} from '@internal/contract/types';
import type { CodecLookupWithDescriptors, CodecRef } from '@internal/framework-components/codec';
import { codecForRef, readContractValue } from '@internal/framework-components/codec';
import {
  type EnumValueCoordinate,
  enumValueStatementText,
  type ResolvedEnumValueRenameStatement,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { structuredError } from '@internal/utils/structured-error';
import { buildColumnCodecRef } from './contract-to-schema-ir';
import type { SchemaTables } from './schema-tables';
import { isSqlModelStorage, tableControlPolicy } from './statement-planning';
import type { SqlPlannerConflict } from './types';

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
  /** The column's codec, which writes `from` and `to` as the database stores them. */
  readonly codecRef: CodecRef;
  /** Whether the column holds a list of the enum's values. */
  readonly many: boolean;
  readonly from: StoredEnumValue;
  readonly to: StoredEnumValue | undefined;
  /** The rename statement the rewrite carries out, if any. */
  readonly statement: ResolvedEnumValueRenameStatement | undefined;
  /**
   * For a removal the plan asks about, the replacements that would keep its data instead, in the
   * order they run; none when keeping it would merge it with another member's data.
   */
  readonly keepData: readonly StoredValueReplacement[] | undefined;
  /** Whether the value moves in a cycle with other values of the enum, so keeping its data swaps values. */
  readonly swapsValues: boolean;
}

/** One replacement of a stored value by another. */
export interface StoredValueReplacement {
  readonly from: StoredEnumValue;
  readonly to: StoredEnumValue;
}

interface EnumColumn {
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  readonly codecRef: StoredValueRewrite['codecRef'];
  readonly many: boolean;
}

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
        });
      }
    }
  }
  return [...found.values()];
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
    why: `The plan rewrites the rows that hold a removed or renamed enum value, and it compares only string and number values. Rewrite the rows that hold enum value "${text}" yourself, then plan again.`,
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

function cycleRefusal(
  statement: ResolvedEnumValueRenameStatement,
  cycle: readonly StoredChange[],
  enums: EnumComparison,
): SqlPlannerConflict {
  const moves = cycle.map(({ from, to }) => `${enums.text(from)} to ${enums.text(to ?? null)}`);
  const listed = `${moves.slice(0, -1).join(', ')} and ${moves.at(-1)}`;
  return {
    kind: 'statementRefused',
    summary: `Cannot rename enum value "${enumValueStatementText(enums.fromContract, statement.from)}" to "${enumValueStatementText(enums.contract, statement.to)}": the renames move stored values in a cycle, ${listed}, and a rewrite of one would overwrite the other before it is read`,
    why: 'Leave out the renames in the cycle, and write the rewrites by hand in the migration.ts a plan without them writes: rewrite the first value to a value no member stores, then each other value, then that value to its new value, with this.replaceStoredValue({ table, column, from, to }) for each.',
    refusedStatement: statement,
    leaveOut: cycle.flatMap((change) => (change.statement === undefined ? [] : [change.statement])),
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
 * whose field the destination enum types: a rename statement replaces it, and any other change
 * removes it, which the plan asks about, with the replacements that would keep its data. Changes
 * that shift values along are ordered so none overwrites a value another still has to read; rename
 * statements that move values in a cycle are refused, and other changes in a cycle keep their data
 * through a temporary value. With no origin contract, nothing is known to have changed.
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
      const columns = columnsTypedBy(contract, namespaceId, enumName).filter((column) =>
        input.tables.hasColumn(column.namespaceId, column.table, column.column),
      );
      if (columns.length === 0) continue;
      const taken = [
        ...originEnum.members.map(({ value }) => value),
        ...destinationEnum.members.map(({ value }) => value),
      ];
      for (const group of orderChanges(checked)) {
        const refused = group.cycle
          ? group.changes.find(({ statement }) => statement !== undefined)?.statement
          : undefined;
        if (refused !== undefined) return notOk(cycleRefusal(refused, group.changes, enums));
        for (const [change, keepData] of keptData(group, taken, merging)) {
          for (const column of columns) {
            rewrites.push({
              enumValue: change.enumValue,
              ...column,
              from: change.from,
              to: change.statement === undefined ? undefined : change.to,
              statement: change.statement,
              keepData,
              swapsValues: group.cycle,
            });
          }
        }
      }
    }
  }
  return ok(rewrites);
}

/**
 * Each change of a group, in the order it runs, with the replacements that keep the data of a
 * change the plan removes: its value replaced by its new value, unless another member of the
 * origin enum keeps that value, which would merge their data. In a cycle, the first value moves to
 * a temporary value, the rest move around, and the temporary value moves last.
 */
function keptData(
  group: { readonly changes: readonly StoredChange[]; readonly cycle: boolean },
  taken: readonly JsonValue[],
  merging: (to: JsonValue) => unknown,
): readonly (readonly [StoredChange, readonly StoredValueReplacement[] | undefined])[] {
  const moved = ({ from, to }: StoredChange): readonly StoredValueReplacement[] =>
    to === undefined ? [] : [{ from, to }];
  const [first, ...rest] = group.changes;
  if (!group.cycle || first === undefined) {
    return group.changes.map((change) => [
      change,
      change.statement === undefined && change.to !== undefined && merging(change.to) === undefined
        ? moved(change)
        : undefined,
    ]);
  }
  const swap = temporaryValue(first.from, taken);
  const reversed = [...rest].reverse();
  return [
    [first, [{ from: first.from, to: swap }]],
    ...reversed.map((change, index): readonly [StoredChange, readonly StoredValueReplacement[]] => [
      change,
      index === reversed.length - 1
        ? [...moved(change), ...moved({ ...first, from: swap })]
        : moved(change),
    ]),
  ];
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
