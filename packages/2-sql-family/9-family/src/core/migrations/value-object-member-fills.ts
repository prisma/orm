import {
  asNamespaceId,
  type Contract,
  type ContractValueObject,
  type ContractValueObjectField,
  type JsonValue,
  valueObjectAt,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import {
  type MigrationOperationPolicy,
  type ResolvedMigrationStatement,
  type ResolvedValueObjectFieldBackfillStatement,
  type ValueObjectFieldCoordinate,
  valueObjectFieldStatementText,
} from '@internal/framework-components/control';
import { declaredJsonType } from '@internal/sql-contract/codec-json-type';
import type { SqlStorage } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { jsonPathText } from './json-path';
import type { SchemaTables } from './schema-tables';
import type { SqlPlannerConflict } from './types';
import { UnfilledValue } from './unfilled-value';
import {
  type ValueObjectPlace,
  type ValueObjectRef,
  valueObjectPlaces,
} from './value-object-field-planning';

/**
 * One column's fill of a required value object field: the key at `path` is set to `value` in every
 * object that lacks it or holds JSON `null` there. The field, column and path are named as the
 * destination contract names them.
 */
export interface StoredKeyFill {
  readonly valueObjectField: ValueObjectFieldCoordinate;
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  /** The RFC 9535 path from the column's value to the key. */
  readonly path: string;
  /** The value the user writes for a backfill statement, or a temporary value. */
  readonly value: JsonValue | UnfilledValue;
  /** The backfill statement the fill carries out, if any. */
  readonly statement: ResolvedValueObjectFieldBackfillStatement | undefined;
}

/**
 * What a plan does for a required value object field that no backfill statement names: `refuse`
 * names the statement that would fill it, and `temporaryValue` fills it with one temporary value
 * when its codec has one.
 */
export type UnnamedMemberFill = 'refuse' | 'temporaryValue';

/**
 * A policy that allows `data` operations plans a migration whose `migration.ts` the user can fill,
 * so it refuses; any other, as `db update` runs, fills a temporary value, as it does for a new
 * required column.
 */
export function unnamedMemberFillOf(policy: MigrationOperationPolicy): UnnamedMemberFill {
  return policy.allowedOperationClasses.includes('data') ? 'refuse' : 'temporaryValue';
}

const TEMPORARY_JSON_VALUES: Readonly<Record<string, JsonValue>> = {
  string: '',
  number: 0,
  boolean: false,
  object: {},
  array: [],
};

/**
 * The temporary value of a member, as JSON: an empty list for a list, and for a scalar the empty
 * value of the JSON type its codec declares. A member that holds a value object or an enum value has
 * none, since no one value stands for every object or member.
 */
function temporaryValueOf(
  field: ContractValueObjectField,
  codecs: Pick<CodecLookupWithDescriptors, 'descriptorFor'>,
): JsonValue | undefined {
  const { type } = field;
  if (type.kind !== 'scalar' || field.valueSet !== undefined) return undefined;
  if (field.many !== undefined && field.many !== false) return [];
  const descriptor = codecs.descriptorFor(type.codecId);
  const jsonType = descriptor === undefined ? undefined : declaredJsonType(descriptor);
  return jsonType === undefined ? undefined : TEMPORARY_JSON_VALUES[jsonType];
}

interface RequiredMember {
  readonly valueObjectField: ValueObjectFieldCoordinate;
  readonly target: ValueObjectRef;
  readonly field: ContractValueObjectField;
  readonly statement: ResolvedValueObjectFieldBackfillStatement | undefined;
}

function sameField(left: ValueObjectFieldCoordinate, right: ValueObjectFieldCoordinate): boolean {
  return (
    left.namespaceId === right.namespaceId &&
    left.valueObject === right.valueObject &&
    left.field === right.field
  );
}

/** The fields each value object of both contracts makes required: new to the destination, or optional in the origin. */
function requiredMembers(
  fromContract: Contract<SqlStorage>,
  contract: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[],
): readonly RequiredMember[] {
  const originNamespaces = new Map<string, string>();
  const renamedFrom = new Map<string, ValueObjectFieldCoordinate>();
  const backfills: ResolvedValueObjectFieldBackfillStatement[] = [];
  for (const statement of statements) {
    if (statement.kind === 'backfill' && statement.entity === 'valueObjectField') {
      backfills.push(statement);
    }
    if (statement.kind !== 'rename') continue;
    if (statement.entity === 'namespace') originNamespaces.set(statement.to, statement.from);
    if (statement.entity === 'valueObjectField') {
      renamedFrom.set(JSON.stringify(statement.to), statement.from);
    }
  }
  const members: RequiredMember[] = [];
  for (const { coordinate, valueObject } of valueObjectsWithCoordinates(contract.storage)) {
    const origin: ContractValueObject | undefined = valueObjectAt(fromContract.storage, {
      ...coordinate,
      namespaceId: originNamespaces.get(coordinate.namespaceId) ?? coordinate.namespaceId,
    });
    if (origin === undefined) continue;
    for (const [name, field] of Object.entries(valueObject.fields)) {
      if (field.nullable) continue;
      const valueObjectField = {
        namespaceId: asNamespaceId(coordinate.namespaceId),
        valueObject: coordinate.entityName,
        field: name,
      };
      const originName = renamedFrom.get(JSON.stringify(valueObjectField))?.field ?? name;
      const originField = Object.hasOwn(origin.fields, originName)
        ? origin.fields[originName]
        : undefined;
      if (originField !== undefined && !originField.nullable) continue;
      members.push({
        valueObjectField,
        target: coordinate,
        field,
        statement: backfills.find((backfill) => sameField(backfill.field, valueObjectField)),
      });
    }
  }
  return members;
}

function placeText(place: ValueObjectPlace): string {
  return `at path ${JSON.stringify(jsonPathText(place.steps))} in column "${place.column}" of "${place.table}"`;
}

function needsValue(
  member: RequiredMember,
  place: ValueObjectPlace,
  text: string,
  why: string,
): SqlPlannerConflict {
  return {
    kind: 'nullabilityConflict',
    summary: `Value object field "${text}" is required, and existing objects ${placeText(place)} may have no value for it`,
    why,
    location: {
      namespaceId: place.namespaceId,
      entityKind: 'table',
      entityName: place.table,
      column: place.column,
    },
    meta: { valueObjectField: member.valueObjectField },
  };
}

function unlisted(text: string, column: string, table: string, reason: string): SqlPlannerConflict {
  return {
    kind: 'unsupportedOperation',
    summary: `Cannot fill value object field "${text}": column "${column}" of "${table}" holds ${reason}`,
    why: `The plan fills a key at every path from a column to its value object, and it cannot list the paths in such a column. Write the value into the JSON of column "${column}" of "${table}" yourself, then plan again.`,
  };
}

const REACH_REASONS = {
  containsItself: 'it inside a value object that contains itself',
  union: 'a union of value objects',
  dictionary: 'a dictionary of value objects',
} as const;

/**
 * The fills of value object fields a plan makes. A field of a value object that both contracts have
 * is filled when the destination makes it required and the origin lacks it or makes it optional. A
 * backfill statement fills it with a value the user writes in `migration.ts`. Without one,
 * `unnamed` decides: `refuse` names the statement, and `temporaryValue` fills a scalar member whose
 * codec has a temporary value and refuses any other. Each fill acts on every column of the working
 * schema whose field holds the value object, at every path to its objects, nested or in lists, as
 * the destination names them. A column that holds the value object where its paths cannot be listed
 * is refused. With no origin contract, nothing is known to have changed.
 */
export function planValueObjectMemberFills(input: {
  readonly statements: readonly ResolvedMigrationStatement[];
  readonly fromContract: Contract<SqlStorage> | null;
  readonly contract: Contract<SqlStorage>;
  readonly tables: SchemaTables;
  readonly codecs: Pick<CodecLookupWithDescriptors, 'descriptorFor'>;
  readonly unnamed: UnnamedMemberFill;
}): Result<readonly StoredKeyFill[], SqlPlannerConflict> {
  const { fromContract, contract } = input;
  if (fromContract === null) return ok([]);
  const members = requiredMembers(fromContract, contract, input.statements);
  if (members.length === 0) return ok([]);
  const placesOf = valueObjectPlaces(contract, input.tables);
  const fills: StoredKeyFill[] = [];
  for (const member of members) {
    const text = valueObjectFieldStatementText(contract, member.valueObjectField);
    const places = placesOf(member.target);
    if (!places.ok) {
      const { column, reach } = places.failure;
      return notOk(unlisted(text, column.column, column.table, REACH_REASONS[reach.kind]));
    }
    const [first] = places.value;
    if (first === undefined) continue;
    const value =
      member.statement !== undefined
        ? new UnfilledValue(`${text}:value`)
        : input.unnamed === 'temporaryValue'
          ? temporaryValueOf(member.field, input.codecs)
          : undefined;
    if (value === undefined) {
      return notOk(
        needsValue(
          member,
          first,
          text,
          input.unnamed === 'refuse'
            ? `Add --backfill ${text} to write the value the plan fills them with.`
            : `db update cannot choose a value for a field that holds a value object or an enum value, or whose codec has no temporary value. Plan a migration with prisma migration plan --backfill ${text} instead, and write the value in its migration.ts.`,
        ),
      );
    }
    for (const place of places.value) {
      fills.push({
        valueObjectField: member.valueObjectField,
        namespaceId: place.namespaceId,
        table: place.table,
        column: place.column,
        path: jsonPathText([
          ...place.steps,
          { kind: 'member', name: member.valueObjectField.field },
        ]),
        value,
        statement: member.statement,
      });
    }
  }
  return ok(fills);
}
