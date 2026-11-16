import {
  asNamespaceId,
  type ContractEnum,
  type ContractField,
  type ContractValueObjectField,
  type ContractWithDomain,
  type JsonValue,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import type { TypeLookups } from '@internal/framework-components/codec';
import {
  type EnumValueCoordinate,
  enumValueCoordinateJson,
  enumValueStatementText,
  type KeepDataEdit,
  type MigrationPlannerConflict,
  type ResolvedEnumValueRenameStatement,
  type ResolvedRenameStatement,
} from '@internal/framework-components/control';
import {
  collectionOfModel,
  embeddingModelOf,
  type MongoContract,
  mongoModelsOf,
  ownStoredNamesOf,
  selectedVariantOf,
  valueObjectStoredNamesOf,
  variantFilter,
} from '@internal/mongo-contract';
import { bsonTypesOfCodec } from '@internal/mongo-contract/data-type';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { notOk, ok, type Result } from '@internal/utils/result';
import { type StoredValue, unrewritableKeyReason } from './migration-factories';
import { type PlannedRewrite, rewriteRefusals } from './mongo-rewrite-refusals';
import { collectionControlPolicy, modelCoordinates } from './mongo-statement-planning';
import { rewriteCollectionOf } from './mongo-stored-key-planning';
import {
  type StoredPlace,
  type StoredType,
  storedPlacesOf,
  type UnlistedPlace,
} from './mongo-stored-places';
import { RemoveStoredValueCall, ReplaceStoredValueCall } from './op-factory-call';
import { jsonPathText } from './stored-key-path';

/** A rewrite of one stored value of an enum in one place, with the enum value and the statement it carries out. */
export interface EnumValueRewrite {
  readonly call: ReplaceStoredValueCall | RemoveStoredValueCall;
  /** The enum value whose stored value is rewritten, as the origin contract names it. */
  readonly enumValue: EnumValueCoordinate;
  readonly statement: ResolvedEnumValueRenameStatement | undefined;
  /** For a removal the plan asks about, the edit to `migration.ts` that keeps its data instead. */
  readonly keepDataEdit: KeepDataEdit | undefined;
}

/** The stored value rewrites of a plan: replacements, run in the replacement step, and removals, run last. */
export interface EnumValueRewrites {
  readonly replacements: readonly EnumValueRewrite[];
  readonly removals: readonly EnumValueRewrite[];
}

/** A place documents hold values of an enum: a root field, or a key at a path inside one. */
interface EnumPlace {
  readonly place: Pick<StoredPlace, 'collection' | 'field' | 'model' | 'variant'>;
  readonly path: string | undefined;
  /** The stored names on the way from the root field to the key, the key included. */
  readonly keys: readonly string[];
  /** Whether the field or key must hold a single value. */
  readonly required: boolean;
}

/** What changes for one member of the origin enum: its stored value `from` becomes `to`, or, with no `to`, is removed. */
interface ValueChange {
  readonly enumValue: EnumValueCoordinate;
  readonly from: StoredValue;
  readonly to: StoredValue | undefined;
  readonly statement: ResolvedEnumValueRenameStatement | undefined;
}

interface Replacement {
  readonly from: StoredValue;
  readonly to: StoredValue;
}

interface EnumComparison {
  readonly fromContract: ContractWithDomain;
  readonly contract: MongoContract;
  readonly originEnum: ContractEnum;
  readonly destinationEnum: ContractEnum;
}

function sameValue(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isStoredValue(value: JsonValue): value is StoredValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function typedBy(
  field: ContractField | ContractValueObjectField,
  namespaceId: string,
  enumName: string,
): boolean {
  const ref = field.valueSet;
  return (
    ref !== undefined &&
    ref.entityKind === 'enum' &&
    ref.spaceId === undefined &&
    ref.namespaceId === namespaceId &&
    ref.entityName === enumName
  );
}

/** A field the enum types, by its stored name. */
type TypedField = readonly [storedName: string, field: ContractField | ContractValueObjectField];

function isRequired(field: ContractField | ContractValueObjectField): boolean {
  return !field.nullable && (field.many === undefined || field.many === false);
}

/**
 * Every place the destination's documents hold values of the enum: each root field of a root model
 * or variant it types, and each key of a value object or an embedded model it types, at every path
 * the documents hold that type.
 */
function placesOfEnum(
  contract: MongoContract,
  namespaceId: string,
  enumName: string,
): Result<readonly EnumPlace[], UnlistedPlace> {
  const places: EnumPlace[] = [];
  const nestedTypes: { readonly type: StoredType; readonly fields: readonly TypedField[] }[] = [];
  for (const coordinate of modelCoordinates(contract)) {
    const model = mongoModelsOf(contract.domain, coordinate.namespaceId)[coordinate.model];
    if (model === undefined) continue;
    const storedNames = ownStoredNamesOf(model);
    const typed = Object.entries(model.fields).flatMap(([name, field]): TypedField[] => {
      const storedName = storedNames[name];
      return storedName !== undefined && typedBy(field, namespaceId, enumName)
        ? [[storedName, field]]
        : [];
    });
    if (typed.length === 0) continue;
    if (embeddingModelOf(contract.domain, coordinate) !== undefined) {
      nestedTypes.push({ type: { kind: 'embeddedModel', model: coordinate }, fields: typed });
      continue;
    }
    const collection = collectionOfModel(contract.domain, coordinate);
    if (collection === undefined) continue;
    const variant = selectedVariantOf(contract.domain, coordinate);
    for (const [storedName, field] of typed) {
      places.push({
        place: { collection, field: storedName, model: coordinate, variant },
        path: undefined,
        keys: [storedName],
        required: isRequired(field),
      });
    }
  }
  for (const { coordinate, valueObject } of valueObjectsWithCoordinates(contract.storage)) {
    const storedNames = valueObjectStoredNamesOf(valueObject);
    const typed = Object.entries(valueObject.fields).flatMap(([name, field]): TypedField[] => {
      const storedName = storedNames[name];
      return storedName !== undefined && typedBy(field, namespaceId, enumName)
        ? [[storedName, field]]
        : [];
    });
    if (typed.length > 0) {
      nestedTypes.push({ type: { kind: 'valueObject', valueObject: coordinate }, fields: typed });
    }
  }
  const placesOf = storedPlacesOf(contract);
  for (const { type, fields } of nestedTypes) {
    const found = placesOf(type);
    if (!found.ok) return notOk(found.failure);
    for (const { steps, ...place } of found.value) {
      for (const [storedName, field] of fields) {
        const path = [...steps, { kind: 'member', name: storedName } as const];
        places.push({
          place,
          path: jsonPathText(path),
          keys: [
            place.field,
            ...path.flatMap((step) => (step.kind === 'member' ? [step.name] : [])),
          ],
          required: isRequired(field),
        });
      }
    }
  }
  return ok(places);
}

/** A change of a member's stored value, before its values are checked to be ones the plan can match. */
interface ComparedChange {
  readonly enumValue: EnumValueCoordinate;
  readonly from: JsonValue;
  readonly to: JsonValue | undefined;
  readonly statement: ResolvedEnumValueRenameStatement | undefined;
}

/**
 * What changes for each member of the origin enum, as SQL compares enums: a rename statement gives
 * a member the stored value of the member it names; a member the destination has under the same
 * name takes that member's stored value; a member the destination lacks is kept when the
 * destination still stores its value, and otherwise its value is removed.
 */
function valueChanges(
  enums: EnumComparison,
  enumValueOf: (member: string) => EnumValueCoordinate,
  statementOf: (member: string) => ResolvedEnumValueRenameStatement | undefined,
): readonly ComparedChange[] {
  return enums.originEnum.members.flatMap((member): ComparedChange[] => {
    const enumValue = enumValueOf(member.name);
    const statement = statementOf(member.name);
    const named = statement?.to.member ?? member.name;
    const target = enums.destinationEnum.members.find(({ name }) => name === named);
    if (target !== undefined) {
      return sameValue(target.value, member.value)
        ? []
        : [{ enumValue, from: member.value, to: target.value, statement }];
    }
    if (statement !== undefined) return [];
    if (enums.destinationEnum.members.some(({ value }) => sameValue(value, member.value)))
      return [];
    return [{ enumValue, from: member.value, to: undefined, statement: undefined }];
  });
}

/** Orders the changes so each runs before the change that writes its old value; a cycle comes out as its changes from the first around. */
function orderChanges(
  changes: readonly ValueChange[],
): readonly { readonly changes: readonly ValueChange[]; readonly cycle: boolean }[] {
  const bySource = new Map(changes.map((change) => [JSON.stringify(change.from), change]));
  const placed = new Set<ValueChange>();
  const groups: { readonly changes: readonly ValueChange[]; readonly cycle: boolean }[] = [];
  for (const start of changes) {
    if (placed.has(start)) continue;
    const path: ValueChange[] = [];
    let cycle = false;
    for (
      let change: ValueChange | undefined = start;
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

/** A value no member of either enum stores, of the kind of `value`. */
function temporaryValue(value: StoredValue, taken: readonly JsonValue[]): StoredValue {
  if (typeof value === 'boolean') return value;
  const numbers = taken.flatMap((stored) => (typeof stored === 'number' ? [stored] : []));
  if (typeof value === 'number') {
    return numbers.length === 0 ? 0 : Math.floor(Math.max(...numbers)) + 1;
  }
  let candidate = 'prisma_swap';
  while (taken.some((stored) => sameValue(stored, candidate))) candidate = `${candidate}_`;
  return candidate;
}

/**
 * Each change of a group, in the order it runs, with the replacements that keep the data of a change
 * the plan removes: its value replaced by its new value, unless another member keeps that value. In a
 * cycle, the first value moves to a temporary value, the rest move around, and the temporary value
 * moves last.
 */
function keptData(
  group: { readonly changes: readonly ValueChange[]; readonly cycle: boolean },
  taken: readonly JsonValue[],
  merging: (to: StoredValue) => unknown,
): readonly (readonly [ValueChange, readonly Replacement[] | undefined])[] {
  const moved = ({ from, to }: Pick<ValueChange, 'from' | 'to'>): readonly Replacement[] =>
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
    ...reversed.map((change, index): readonly [ValueChange, readonly Replacement[]] => [
      change,
      index === reversed.length - 1
        ? [...moved(change), ...moved({ from: swap, to: first.to })]
        : moved(change),
    ]),
  ];
}

/** The expression that writes a stored value with the BSON type the enum's codec stores. */
function valueExpression(value: StoredValue, bsonTypes: readonly string[]): JsonValue {
  if (typeof value === 'string') return { $literal: value };
  if (typeof value === 'boolean') return value;
  if (bsonTypes.includes('double')) return { $toDouble: value };
  if (bsonTypes.includes('long')) return { $toLong: value };
  if (bsonTypes.includes('decimal')) return { $toDecimal: String(value) };
  return value;
}

function enumValueText(contract: ContractWithDomain, value: EnumValueCoordinate): string {
  return `enum value "${enumValueStatementText(contract, value)}"`;
}

function refused(
  enums: EnumComparison,
  change: Pick<ValueChange, 'enumValue' | 'statement'>,
  reason: string,
  why: string,
): MigrationPlannerConflict {
  const { statement } = change;
  if (statement === undefined) {
    return {
      kind: 'fieldRemovalRefused',
      summary: `Cannot remove ${enumValueText(enums.fromContract, change.enumValue)}: ${reason}`,
      why,
    };
  }
  return {
    kind: 'statementRefused',
    summary: `Cannot rename ${enumValueText(enums.fromContract, statement.from)} to "${enumValueStatementText(enums.contract, statement.to)}": ${reason}`,
    why,
    refusedStatement: statement,
  };
}

function unsupportedValueRefusal(
  enums: EnumComparison,
  change: Pick<ValueChange, 'enumValue' | 'statement'>,
  stored: JsonValue,
): MigrationPlannerConflict {
  return refused(
    enums,
    change,
    `its stored value ${JSON.stringify(stored)} is not a string, a number or a boolean`,
    `The plan matches stored enum values by equality, and MongoDB's equality on an object depends on the order of its keys and on a list matches lists that contain it. Rewrite the documents that hold ${enumValueText(enums.fromContract, change.enumValue)} in a dataTransform operation of migration.ts, then plan again.`,
  );
}

function stillStoredRefusal(
  enums: EnumComparison,
  statement: ResolvedEnumValueRenameStatement,
  stored: StoredValue,
  holder: string,
): MigrationPlannerConflict {
  const holderText = enumValueStatementText(enums.contract, { ...statement.to, member: holder });
  return refused(
    enums,
    { enumValue: statement.from, statement },
    `the destination enum still stores ${JSON.stringify(stored)}, as enum value "${holderText}"`,
    `A rename changes the stored value in every document that holds it, so the documents that hold ${JSON.stringify(stored)} for "${holderText}" would change too. Leave out this statement.`,
  );
}

function mergingRefusal(
  enums: EnumComparison,
  statement: ResolvedEnumValueRenameStatement,
  from: StoredValue,
  to: StoredValue,
  holder: string,
): MigrationPlannerConflict {
  const holderText = enumValueStatementText(enums.fromContract, {
    ...statement.from,
    member: holder,
  });
  return refused(
    enums,
    { enumValue: statement.from, statement },
    `the origin enum already stores ${JSON.stringify(to)}, as enum value "${holderText}"`,
    `A rename changes ${JSON.stringify(from)} to ${JSON.stringify(to)} in every document that holds it, which merges its data with the data of "${holderText}". Leave out this statement. To merge them on purpose, plan the change with migration plan and write replaceStoredValue(...) in the migration.ts it writes.`,
  );
}

function cycleRefusal(
  enums: EnumComparison,
  statement: ResolvedEnumValueRenameStatement,
  cycle: readonly ValueChange[],
): MigrationPlannerConflict {
  const moves = cycle.map(
    ({ from, to }) => `${JSON.stringify(from)} to ${JSON.stringify(to ?? null)}`,
  );
  const listed = `${moves.slice(0, -1).join(', ')} and ${moves.at(-1)}`;
  return {
    ...refused(
      enums,
      { enumValue: statement.from, statement },
      `the renames move stored values in a cycle, ${listed}, and a rewrite of one would overwrite the other before it is read`,
      'Leave out the renames in the cycle, and write the rewrites by hand in the migration.ts a plan without them writes: replace the first value with a value no member stores, then each other value, then that value with its new value, with replaceStoredValue({ collection, field, from, to }) for each.',
    ),
    leaveOut: cycle.flatMap((change) => (change.statement === undefined ? [] : [change.statement])),
  };
}

function unlistedRefusal(
  enums: EnumComparison,
  change: Pick<ValueChange, 'enumValue' | 'statement'>,
  unlisted: UnlistedPlace,
): MigrationPlannerConflict {
  const where = `field "${unlisted.field}" of collection "${unlisted.collection}"`;
  return unlisted.reach.kind === 'containsItself'
    ? refused(
        enums,
        change,
        `${where} holds it inside "${unlisted.reach.type}", which contains itself, so the documents can hold it at any depth`,
        `The plan rewrites a stored value at every path from a field to it, and a type that contains itself has no last path. Rewrite ${where} in a dataTransform operation of migration.ts.`,
      )
    : refused(
        enums,
        change,
        `${where} holds a ${unlisted.reach.kind} of value objects`,
        `The plan rewrites a stored value only in a field that holds it, a value object, a list of them, or an embedded model. Rewrite ${where} in a dataTransform operation of migration.ts.`,
      );
}

/** The input the stored value rewrites read. */
export interface EnumValueInput {
  readonly statements: readonly ResolvedRenameStatement[];
  readonly fromContract: ContractWithDomain | null;
  readonly contract: MongoContract;
  /** The schema the plan starts from, with each renamed collection under its new name. */
  readonly schema: MongoSchemaIR;
  readonly lookups: TypeLookups;
}

/**
 * The rewrites of stored enum values a plan makes, as SQL plans them. Enums are compared by the
 * stored value of each member (see `valueChanges`). A changed value is rewritten at every place the
 * destination's documents hold the enum: a rename statement replaces it, and any other change
 * removes it, which the plan asks about, with the replacements that would keep its data. Changes are
 * ordered so none overwrites a value another still has to read; rename statements that move values
 * in a cycle, merge two values, or leave a value another member stores are refused. A rename in a
 * collection whose control policy is not `managed` is refused, and a removal there is left out. With
 * no origin contract, nothing is known to have changed.
 */
export function planEnumValueRewrites(
  input: EnumValueInput,
): Result<EnumValueRewrites, readonly MigrationPlannerConflict[]> {
  const { fromContract, contract } = input;
  if (fromContract === null) return ok({ replacements: [], removals: [] });
  const valueRenames = input.statements.filter(
    (statement): statement is ResolvedEnumValueRenameStatement => statement.entity === 'enumValue',
  );
  const replacements: EnumValueRewrite[] = [];
  const removals: EnumValueRewrite[] = [];
  const conflicts: MigrationPlannerConflict[] = [];
  for (const [namespaceId, namespace] of Object.entries(fromContract.domain?.namespaces ?? {})) {
    for (const [enumName, originEnum] of Object.entries(namespace.enum ?? {})) {
      const destinationEnum = contract.domain?.namespaces[namespaceId]?.enum?.[enumName];
      if (destinationEnum === undefined) continue;
      const enums: EnumComparison = { fromContract, contract, originEnum, destinationEnum };
      const found = planEnum(enums, namespaceId, enumName, valueRenames, input);
      if (!found.ok) {
        conflicts.push(...found.failure);
        continue;
      }
      replacements.push(...found.value.replacements);
      removals.push(...found.value.removals);
    }
  }
  return conflicts.length > 0 ? notOk(conflicts) : ok({ replacements, removals });
}

function planEnum(
  enums: EnumComparison,
  namespaceId: string,
  enumName: string,
  valueRenames: readonly ResolvedEnumValueRenameStatement[],
  input: EnumValueInput,
): Result<EnumValueRewrites, readonly MigrationPlannerConflict[]> {
  const { originEnum, destinationEnum, contract } = enums;
  const raw = valueChanges(
    enums,
    (member) => ({ namespaceId: asNamespaceId(namespaceId), enum: enumName, member }),
    (member) =>
      valueRenames.find(
        (rename) =>
          rename.from.namespaceId === namespaceId &&
          rename.from.enum === enumName &&
          rename.from.member === member,
      ),
  );
  const checked: ValueChange[] = [];
  for (const change of raw) {
    if (!isStoredValue(change.from)) {
      return notOk([unsupportedValueRefusal(enums, change, change.from)]);
    }
    if (change.to !== undefined && !isStoredValue(change.to)) {
      return notOk([unsupportedValueRefusal(enums, change, change.to)]);
    }
    checked.push({ ...change, from: change.from, to: change.to });
  }
  const changedFrom = (value: JsonValue) => checked.some(({ from }) => sameValue(from, value));
  const changedTo = (value: JsonValue) =>
    checked.some(({ to }) => to !== undefined && sameValue(to, value));
  const merging = (to: StoredValue) =>
    originEnum.members.find(({ value }) => sameValue(value, to) && !changedFrom(value));
  for (const { statement, from, to } of checked) {
    if (statement === undefined || to === undefined) continue;
    const holder = destinationEnum.members.find(({ value }) => sameValue(value, from));
    if (holder !== undefined && !changedTo(from)) {
      return notOk([stillStoredRefusal(enums, statement, from, holder.name)]);
    }
    const merged = merging(to);
    if (merged !== undefined) {
      return notOk([mergingRefusal(enums, statement, from, to, merged.name)]);
    }
  }
  if (checked.length === 0) return ok({ replacements: [], removals: [] });
  const groups = orderChanges(checked);
  for (const group of groups) {
    const statement = group.cycle
      ? group.changes.find((change) => change.statement !== undefined)?.statement
      : undefined;
    if (statement !== undefined) return notOk([cycleRefusal(enums, statement, group.changes)]);
  }
  const places = placesOfEnum(contract, namespaceId, enumName);
  if (!places.ok) {
    const [first] = checked;
    return first === undefined
      ? ok({ replacements: [], removals: [] })
      : notOk([
          unlistedRefusal(
            enums,
            checked.find((change) => change.statement !== undefined) ?? first,
            places.failure,
          ),
        ]);
  }
  const live = places.value.filter(
    ({ place }) => input.schema.collection(place.collection) !== undefined,
  );
  const conflicts = placeRefusals(enums, checked, live, input);
  if (conflicts.length > 0) return notOk(conflicts);
  const bsonTypes = bsonTypesOfCodec(destinationEnum.codecId, input.lookups) ?? [];
  const taken = [
    ...originEnum.members.map(({ value }) => value),
    ...destinationEnum.members.map(({ value }) => value),
  ];
  const replacements: EnumValueRewrite[] = [];
  const removals: EnumValueRewrite[] = [];
  for (const group of groups) {
    for (const [change, keepData] of keptData(group, taken, merging)) {
      const removed = change.statement === undefined;
      for (const enumPlace of live) {
        const policy = collectionControlPolicy(contract, enumPlace.place.collection);
        if (policy !== 'managed') continue;
        const at = {
          collection: enumPlace.place.collection,
          field: enumPlace.place.field,
          ...(enumPlace.path === undefined ? {} : { path: enumPlace.path }),
          ...(enumPlace.place.variant === undefined
            ? {}
            : { filter: variantFilter(enumPlace.place.variant) }),
        };
        const replacementCall = (replacement: Replacement) =>
          new ReplaceStoredValueCall({
            ...at,
            from: replacement.from,
            to: valueExpression(replacement.to, bsonTypes),
          });
        if (!removed && change.to !== undefined) {
          replacements.push({
            call: replacementCall({ from: change.from, to: change.to }),
            enumValue: change.enumValue,
            statement: change.statement,
            keepDataEdit: undefined,
          });
          continue;
        }
        const call = new RemoveStoredValueCall({
          ...at,
          value: change.from,
          ...(enumPlace.required ? { required: true } : {}),
          enumValue: enumValueCoordinateJson(change.enumValue),
        });
        removals.push({
          call,
          enumValue: change.enumValue,
          statement: undefined,
          keepDataEdit:
            keepData === undefined
              ? undefined
              : {
                  remove: call.renderTypeScript(),
                  replaceWith: keepData
                    .map((replacement) => replacementCall(replacement).renderTypeScript())
                    .join(', '),
                  ...(group.cycle ? { swapsValues: true } : {}),
                },
        });
      }
    }
  }
  return ok({ replacements, removals });
}

/** The refusals of the places a change rewrites: keys MongoDB cannot rewrite, unmanaged collections for a rename, time-series and shared collections. */
function placeRefusals(
  enums: EnumComparison,
  changes: readonly ValueChange[],
  places: readonly EnumPlace[],
  input: EnumValueInput,
): readonly MigrationPlannerConflict[] {
  const conflicts: MigrationPlannerConflict[] = [];
  const seen = new Set<string>();
  const push = (conflict: MigrationPlannerConflict) => {
    const key = JSON.stringify([conflict.kind, conflict.summary]);
    if (seen.has(key)) return;
    seen.add(key);
    conflicts.push(conflict);
  };
  for (const change of changes) {
    const kind: PlannedRewrite['kind'] =
      change.statement === undefined ? 'removeStoredValue' : 'replaceStoredValue';
    for (const { place, keys } of places) {
      const policy = collectionControlPolicy(input.contract, place.collection);
      if (policy !== 'managed') {
        if (change.statement !== undefined) {
          push(
            refused(
              enums,
              change,
              `collection "${place.collection}" has control policy "${policy}"`,
              'Statements rename only collections, and fields of collections, whose control policy is "managed". Make the change in the database yourself and leave out this statement.',
            ),
          );
        }
        continue;
      }
      const unrewritable = keys.find((key) => unrewritableKeyReason(key) !== undefined);
      if (unrewritable !== undefined) {
        push(
          refused(
            enums,
            change,
            `the stored name "${unrewritable}" cannot be rewritten`,
            `${unrewritableKeyReason(unrewritable)}, so the plan cannot rewrite the value there. Rewrite it in the database yourself, or ${change.statement === undefined ? 'keep the enum value in the contract' : 'leave out this statement'}.`,
          ),
        );
        continue;
      }
      for (const conflict of rewriteRefusals(
        {
          kind,
          collection: place.collection,
          field: place.field,
          variant: place.variant,
          model: place.model,
          storedKey: {
            key: enumValueText(enums.fromContract, change.enumValue),
            together: [],
          },
        },
        input.contract,
        rewriteCollectionOf(input.schema, place.collection),
      )) {
        push(
          change.statement === undefined
            ? conflict
            : { ...conflict, refusedStatement: change.statement },
        );
      }
    }
  }
  return conflicts;
}
