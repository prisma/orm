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
  type MigrationPlannerConflict,
  modelStatementText,
  type ResolvedEnumValueRenameStatement,
  type ResolvedRenameStatement,
} from '@internal/framework-components/control';
import {
  collectionOfModel,
  embeddingModelOf,
  type MongoContract,
  mongoModelsOf,
  ownStoredNamesOf,
  type SelectedVariant,
  selectedVariantOf,
  valueObjectStoredNamesOf,
  variantFilter,
} from '@internal/mongo-contract';
import { bsonTypesOfCodec, codecStoresValue } from '@internal/mongo-contract/data-type';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { notOk, ok, type Result } from '@internal/utils/result';
import { type StoredValue, unrewritableKeyReason } from './migration-factories';
import { collectionControlPolicy } from './mongo-control-policy';
import { modelCoordinates } from './mongo-model-coordinates';
import { joinedList, ONE_AT_A_TIME } from './mongo-plan-text';
import { inTwoSteps } from './mongo-rewrite-overlaps';
import { type ArrivalOf, type PlannedRewrite, rewriteRefusals } from './mongo-rewrite-refusals';
import { renameRefused } from './mongo-storage-renames';
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
export interface EnumValueRewrite<
  Call extends ReplaceStoredValueCall | RemoveStoredValueCall =
    | ReplaceStoredValueCall
    | RemoveStoredValueCall,
> {
  readonly call: Call;
  /** The enum value whose stored value is rewritten, as the origin contract names it. */
  readonly enumValue: EnumValueCoordinate;
  readonly statement: ResolvedEnumValueRenameStatement | undefined;
  /** How to make a change of this enum's stored values in two steps, when one migration cannot make it safely. */
  readonly twoMigrationsAdvice: string;
  /** The variant whose documents the call selects; `undefined` for a root model's documents. */
  readonly variant: SelectedVariant | undefined;
}

/** The stored value rewrites of a plan: replacements, run in the replacement step, and removals, run last. */
export interface EnumValueRewrites {
  readonly replacements: readonly EnumValueReplacement[];
  readonly removals: readonly EnumValueRewrite<RemoveStoredValueCall>[];
}

/** A replacement of one stored value of an enum in one place, with the stored value it writes. */
export interface EnumValueReplacement extends EnumValueRewrite<ReplaceStoredValueCall> {
  readonly writtenValue: StoredValue;
}

/** A place documents hold values of an enum: a root field, or a key at a path inside one. */
interface EnumPlace {
  readonly place: Pick<StoredPlace, 'collection' | 'field' | 'model' | 'variant'>;
  readonly path: string | undefined;
  /** The stored names on the way from the root field to the key, the key included. */
  readonly keys: readonly string[];
  /** Whether the field or key must hold a single value. */
  readonly required: boolean;
  /** Whether the field is its model's discriminator, whose values a variant change rewrites. */
  readonly discriminator: boolean;
  /** Whether the field or key holds a list of the enum's values. */
  readonly many: boolean;
  /** The models whose documents hold the enum at this place, when several root models of one collection type the same field. */
  readonly together: readonly string[];
}

/** What changes for one member of the origin enum: its stored value `from` becomes `to`, or, with no `to`, is removed. */
interface ValueChange {
  readonly enumValue: EnumValueCoordinate;
  readonly from: StoredValue;
  readonly to: StoredValue | undefined;
  readonly statement: ResolvedEnumValueRenameStatement | undefined;
}

interface EnumComparison {
  readonly fromContract: ContractWithDomain;
  readonly contract: MongoContract;
  readonly originEnum: ContractEnum;
  readonly destinationEnum: ContractEnum;
  /** Whether the destination enum's codec stores the value. */
  readonly stores: (value: JsonValue) => boolean;
}

function sameValue(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isStoredValue(value: JsonValue): value is StoredValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Whether the field takes the enum's values: a model field names the enum, and a value object field its storage value set, which has the enum's name. */
function typedBy(
  field: ContractField | ContractValueObjectField,
  namespaceId: string,
  enumName: string,
): boolean {
  const ref = field.valueSet;
  return (
    ref !== undefined &&
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
    const discriminator =
      model.discriminator === undefined ? undefined : storedNames[model.discriminator.field];
    for (const [storedName, field] of typed) {
      places.push({
        place: { collection, field: storedName, model: coordinate, variant },
        path: undefined,
        keys: [storedName],
        required: isRequired(field),
        discriminator: storedName === discriminator,
        many: field.many !== undefined && field.many !== false,
        together: [coordinate.model],
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
          discriminator: false,
          many: field.many !== undefined && field.many !== false,
          together: [place.model.model],
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

function isBooleanEnum(enums: EnumComparison): boolean {
  return enums.originEnum.members.some(({ value }) => typeof value === 'boolean');
}

const NO_THIRD_BOOLEAN =
  'A boolean enum has no third value to move a stored value to, so the change cannot be split into two steps.';

/** How to make a change of the enum's stored values that one migration cannot make safely. */
function enumTwoMigrationsAdvice(enums: EnumComparison): string {
  return isBooleanEnum(enums)
    ? booleanSwapAdvice(true)
    : inTwoSteps(
        'move every value they swap or chain to a stored value the enum does not use',
        'move them to their final values',
      );
}

/**
 * Why a boolean enum whose two values trade places is refused with no route: there is no third
 * value to move through, and a swap has no state a check can read, so no migration that makes it
 * can run again after a stop. As on SQL, no hand-written rewrite of the values is offered.
 */
function booleanSwapAdvice(withStatements: boolean): string {
  return `${NO_THIRD_BOOLEAN} A swap of the two values cannot be made so that a migration that stops part way can run again to finish, so keep the stored values of this enum in the contract${withStatements ? ', and leave out the statements that rename values of this enum' : ''}.`;
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
  change: Pick<ValueChange, 'enumValue' | 'statement'> & {
    readonly to?: JsonValue | undefined;
    readonly from?: JsonValue;
  },
  reason: string,
  why: string,
): MigrationPlannerConflict {
  const { statement } = change;
  if (statement === undefined && change.to !== undefined) {
    return renameRefused(
      undefined,
      `Cannot change the stored value of ${enumValueText(enums.fromContract, change.enumValue)} from ${JSON.stringify(change.from)} to ${JSON.stringify(change.to)}: ${reason}`,
      why,
    );
  }
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
  change: ComparedChange,
  stored: JsonValue,
): MigrationPlannerConflict {
  return refused(
    enums,
    change,
    `its stored value ${JSON.stringify(stored)} is not a string, a number or a boolean`,
    `The plan matches stored enum values by equality, and MongoDB's equality on an object depends on the order of its keys and on a list matches lists that contain it, so the plan cannot change the stored values of this enum; ${keepAdvice(enums, change)}.`,
  );
}

/** How to leave a change of an enum's stored values out of the plan: keep the contract as the origin stores it. */
function keepAdvice(enums: EnumComparison, change: ComparedChange): string {
  if (change.statement !== undefined) {
    return `give "${enumValueStatementText(enums.contract, change.statement.to)}" the stored value ${JSON.stringify(change.from)}, or leave out this statement and keep the enum value`;
  }
  return change.to === undefined
    ? 'keep the enum value in the contract'
    : `keep its stored value ${JSON.stringify(change.from)} in the contract`;
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

function unlistedRefusal(
  enums: EnumComparison,
  change: ValueChange,
  unlisted: UnlistedPlace,
): MigrationPlannerConflict {
  const where = `field "${unlisted.field}" of collection "${unlisted.collection}"`;
  const keep = keepAdvice(enums, change);
  const cannot = `The plan cannot change the stored values of this enum while ${where} holds them, so ${keep}.`;
  return unlisted.reach.kind === 'containsItself'
    ? refused(
        enums,
        change,
        `${where} holds it inside "${unlisted.reach.type}", which contains itself, so the documents can hold it at any depth`,
        `The plan rewrites a stored value at every path from a field to it, and a type that contains itself has no last path. ${cannot}`,
      )
    : refused(
        enums,
        change,
        `${where} holds a ${unlisted.reach.kind} of value objects`,
        `The plan rewrites a stored value only in a field that holds it, a value object, a list of them, or an embedded model. ${cannot}`,
      );
}

/** A change of a member that keeps its name, with its new stored value. */
type MemberMove = ValueChange & { readonly to: StoredValue };

function valueText(value: StoredValue): string {
  return JSON.stringify(value);
}

function enumNameText(enums: EnumComparison, value: EnumValueCoordinate): string {
  return modelStatementText(enums.fromContract, {
    namespaceId: value.namespaceId,
    model: value.enum,
  });
}

function memberText(enums: EnumComparison, value: EnumValueCoordinate): string {
  return `"${enumValueStatementText(enums.fromContract, value)}"`;
}

/** How a refusal names a member's new stored value when no statement asks for it. */
function changeText(enums: EnumComparison, change: MemberMove): string {
  return `Cannot change the stored value of enum value ${memberText(enums, change.enumValue)} from ${valueText(change.from)} to ${valueText(change.to)}`;
}

/** A value the enum's codec stores and no member of either enum stores, of the kind of `value`: the next whole number, else the smallest unused one, else a marked string; undefined when the codec stores none of them. */
function temporaryValue(
  enums: EnumComparison,
  value: StoredValue,
  taken: readonly JsonValue[],
): StoredValue | undefined {
  const free = (candidate: StoredValue) =>
    enums.stores(candidate) && !taken.some((stored) => sameValue(stored, candidate));
  const tries = Array.from({ length: taken.length + 1 }, (_, index) => index);
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value))) {
    const asValue = (whole: number): StoredValue =>
      typeof value === 'number' ? whole : String(whole);
    const numbers = taken.flatMap((stored) => {
      const number = typeof stored === 'string' ? Number(stored) : stored;
      return typeof number === 'number' && Number.isFinite(number) ? [number] : [];
    });
    const next = numbers.length === 0 ? 0 : Math.floor(Math.max(...numbers)) + 1;
    const whole = [next, ...tries].find(
      (candidate) => Number.isSafeInteger(candidate) && free(asValue(candidate)),
    );
    if (whole !== undefined) return asValue(whole);
  }
  return tries.map((index) => `prisma_swap_${index + 1}`).find(free);
}

/**
 * The members that keep their names and move stored values along a chain or around a cycle, each
 * group with whether it is a cycle. A change that moves to a value no other change frees is alone.
 */
function linkedMoves(
  moves: readonly MemberMove[],
): readonly { readonly moves: readonly MemberMove[]; readonly cycle: boolean }[] {
  const bySource = new Map(moves.map((move) => [JSON.stringify(move.from), move]));
  const placed = new Set<MemberMove>();
  const groups: { readonly moves: readonly MemberMove[]; readonly cycle: boolean }[] = [];
  const startsOf = moves.filter(
    (move) => !moves.some((other) => other !== move && sameValue(other.to, move.from)),
  );
  for (const start of [...startsOf, ...moves]) {
    if (placed.has(start)) continue;
    const path: MemberMove[] = [];
    let cycle = false;
    for (
      let move: MemberMove | undefined = start;
      move !== undefined && !placed.has(move);
      move = bySource.get(JSON.stringify(move.to))
    ) {
      if (path.includes(move)) {
        cycle = true;
        break;
      }
      path.push(move);
    }
    for (const move of path) placed.add(move);
    groups.push({ moves: path, cycle });
  }
  return groups;
}

const CYCLE_WHY =
  'The plan rewrites a changed stored value in every document that holds it, one value at a time, so when values trade places, whichever is rewritten first overwrites the other before it is read.';

const CHAIN_WHY = `${ONE_AT_A_TIME} A rewrite of a value that another rewrite of the same migration writes would act on what that one wrote when the migration runs again after a later operation stops.`;

/**
 * The route through stored values no member stores, which works on both commands: a plan that
 * gives each member whose new value another member of the group still holds a value nothing
 * stores, and the others their new values, then a plan that gives the first ones their new values.
 */
function movesTwoPlans(
  enums: EnumComparison,
  moves: readonly MemberMove[],
  taken: readonly JsonValue[],
): string {
  const reserved: JsonValue[] = [...taken];
  const steps = moves.map((move) => {
    const waits = moves.some((other) => other !== move && sameValue(other.from, move.to));
    const through = waits ? temporaryValue(enums, move.to, reserved) : undefined;
    if (through !== undefined) reserved.push(through);
    return { move, waits, through };
  });
  const first = steps.map(({ move, waits, through }) => {
    const member = memberText(enums, move.enumValue);
    if (!waits) return `give ${member} the stored value ${valueText(move.to)}`;
    const example = through === undefined ? '' : `, such as ${valueText(through)}`;
    return `give ${member} a stored value no member stores${example}`;
  });
  const second = steps.flatMap(({ move, waits }) =>
    waits
      ? [`give ${memberText(enums, move.enumValue)} the stored value ${valueText(move.to)}`]
      : [],
  );
  return `Make the change in two plans: first ${first.join('; ')}; and plan and apply that; then ${second.join('; ')}; and plan again.`;
}

/** Members that keep their names and move stored values in a cycle, or along a chain, which MongoDB cannot rewrite in one migration. */
function movesRefusal(
  enums: EnumComparison,
  moves: readonly MemberMove[],
  cycle: boolean,
  taken: readonly JsonValue[],
): MigrationPlannerConflict {
  const [first] = moves;
  const members = joinedList(moves.map(({ enumValue }) => memberText(enums, enumValue)));
  const listed = joinedList(moves.map(({ from, to }) => `${valueText(from)} to ${valueText(to)}`));
  const enumName = first === undefined ? '' : enumNameText(enums, first.enumValue);
  return renameRefused(
    undefined,
    cycle
      ? `Cannot change the stored values of enum "${enumName}": enum values ${members} move stored values in a cycle, ${listed}, and a rewrite of one would overwrite the other before it is read`
      : `Cannot change the stored values of enum "${enumName}": enum values ${members} move stored values along a chain, ${listed}, and a rewrite of one would write a value another still has to read`,
    `${cycle ? CYCLE_WHY : CHAIN_WHY} ${isBooleanEnum(enums) ? booleanSwapAdvice(false) : movesTwoPlans(enums, moves, taken)}`,
  );
}

/** A member that keeps its name and takes the stored value `to`, which `holder` keeps in the origin enum, so their data would merge. */
function memberMergingRefusal(
  enums: EnumComparison,
  move: MemberMove,
  holder: string,
): MigrationPlannerConflict {
  const member = memberText(enums, move.enumValue);
  const holderText = memberText(enums, { ...move.enumValue, member: holder });
  const holderFlag = enumValueStatementText(enums.fromContract, {
    ...move.enumValue,
    member: holder,
  });
  return renameRefused(
    undefined,
    `${changeText(enums, move)}: the origin enum stores ${valueText(move.to)} as enum value ${holderText}`,
    `A changed stored value is rewritten in every document that holds it, so the documents of ${member} would hold ${valueText(move.to)} as the documents of ${holderText} do, and their data would merge. Make the change in two plans: first remove enum value ${holderText}, and plan and apply that; then give ${member} the stored value ${valueText(move.to)}, and plan again. The first plan asks about the documents that hold ${valueText(move.to)}. If you answer it with --delete ${holderFlag}, a required field cannot lose its value: before that plan applies, delete those documents in the database, or set them to ${valueText(move.from)} there to merge their data with the data of ${member} on purpose.`,
  );
}

/**
 * The refusal of the first change of a member that keeps its name and that MongoDB cannot make in
 * one migration: one that takes the stored value another member of the origin keeps, whether the
 * destination keeps that member or removes it (a merge), or one of members that move values along
 * a chain or around a cycle. A group
 * that involves a statement is left to the statement refusals and the overlap check.
 */
function memberMovesRefusal(
  enums: EnumComparison,
  changes: readonly ValueChange[],
  taken: readonly JsonValue[],
): MigrationPlannerConflict | undefined {
  const moves = changes.flatMap((change): MemberMove[] =>
    change.statement === undefined && change.to !== undefined ? [{ ...change, to: change.to }] : [],
  );
  for (const move of moves) {
    const holder = enums.originEnum.members.find(
      ({ name, value }) => name !== move.enumValue.member && sameValue(value, move.to),
    );
    if (holder === undefined) continue;
    if (!changes.some(({ enumValue }) => enumValue.member === holder.name)) {
      return memberMergingRefusal(enums, move, holder.name);
    }
  }
  const replacing = changes.filter(({ to }) => to !== undefined);
  for (const group of linkedMoves(moves)) {
    if (group.moves.length < 2) continue;
    const involvesStatement = replacing.some(
      (change) =>
        change.statement !== undefined &&
        group.moves.some(
          (move) =>
            (change.to !== undefined && sameValue(change.to, move.from)) ||
            sameValue(change.from, move.to),
        ),
    );
    if (involvesStatement) continue;
    return movesRefusal(enums, group.moves, group.cycle, taken);
  }
  return undefined;
}

/** The input the stored value rewrites read. */
export interface EnumValueInput {
  readonly statements: readonly ResolvedRenameStatement[];
  readonly fromContract: ContractWithDomain | null;
  readonly contract: MongoContract;
  /** The schema the plan starts from, with each renamed collection under its new name. */
  readonly schema: MongoSchemaIR;
  readonly lookups: TypeLookups;
  /** How a model that blocks a rewrite arrives in its collection, for the refusal's earlier-migration route; `undefined` without an origin contract. */
  readonly arrivalOf: ArrivalOf | undefined;
}

/**
 * The rewrites of stored enum values a plan makes, as SQL plans them. Enums are compared by the
 * stored value of each member (see `valueChanges`). A changed value is rewritten at every place the
 * destination's documents hold the enum: a rename statement replaces it, and any other change
 * removes it, which the plan asks about, with the replacements that would keep its data. Rename
 * statements that merge two values, or leave a value another member stores, are refused; the
 * planner refuses swaps and chains for the whole plan (see `overlapRefusal`). A rename in a
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
  const replacements: EnumValueReplacement[] = [];
  const removals: EnumValueRewrite<RemoveStoredValueCall>[] = [];
  const conflicts: MigrationPlannerConflict[] = [];
  for (const [namespaceId, namespace] of Object.entries(fromContract.domain?.namespaces ?? {})) {
    for (const [enumName, originEnum] of Object.entries(namespace.enum ?? {})) {
      const destinationEnum = contract.domain?.namespaces[namespaceId]?.enum?.[enumName];
      if (destinationEnum === undefined) continue;
      const enums: EnumComparison = {
        fromContract,
        contract,
        originEnum,
        destinationEnum,
        stores: (value) => codecStoresValue(destinationEnum.codecId, value, input.lookups),
      };
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

/** One place for each field or key several root models of one collection type alike, with every model whose documents hold it. */
function placesTogether(places: readonly EnumPlace[]): readonly EnumPlace[] {
  const byPlace = new Map<string, EnumPlace>();
  for (const each of places) {
    const key = JSON.stringify([
      each.place.collection,
      each.place.field,
      each.path ?? null,
      each.place.variant ?? null,
    ]);
    const known = byPlace.get(key);
    byPlace.set(
      key,
      known === undefined
        ? each
        : {
            ...known,
            required: known.required || each.required,
            together: [...known.together, ...each.together],
          },
    );
  }
  return [...byPlace.values()];
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
  const live = placesTogether(
    places.value.filter(({ place }) => input.schema.collection(place.collection) !== undefined),
  );
  const managed = live.filter(
    ({ place }) => collectionControlPolicy(contract, place.collection) === 'managed',
  );
  const taken = [
    ...originEnum.members.map(({ value }) => value),
    ...destinationEnum.members.map(({ value }) => value),
  ];
  const conflicts = placeRefusals(enums, checked, live, input);
  if (conflicts.length > 0) return notOk(conflicts);
  const moved = managed.length === 0 ? undefined : memberMovesRefusal(enums, checked, taken);
  if (moved !== undefined) return notOk([moved]);
  const advice = enumTwoMigrationsAdvice(enums);
  const bsonTypes = bsonTypesOfCodec(destinationEnum.codecId, input.lookups) ?? [];
  const replacements: EnumValueReplacement[] = [];
  const removals: EnumValueRewrite<RemoveStoredValueCall>[] = [];
  for (const change of checked) {
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
      if (change.to !== undefined) {
        if (change.statement === undefined && enumPlace.discriminator) continue;
        replacements.push({
          call: new ReplaceStoredValueCall({
            ...at,
            from: change.from,
            to: valueExpression(change.to, bsonTypes),
          }),
          enumValue: change.enumValue,
          statement: change.statement,
          twoMigrationsAdvice: advice,
          writtenValue: change.to,
          variant: enumPlace.place.variant,
        });
        continue;
      }
      removals.push({
        call: new RemoveStoredValueCall(
          {
            ...at,
            value: change.from,
            ...(enumPlace.required ? { required: true } : {}),
            enumValue: enumValueCoordinateJson(change.enumValue),
          },
          { importsReplacement: enumPlace.required },
        ),
        enumValue: change.enumValue,
        statement: undefined,
        twoMigrationsAdvice: advice,
        variant: enumPlace.place.variant,
      });
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
      change.to === undefined ? 'removeStoredValue' : 'replaceStoredValue';
    for (const { place, keys, together } of places) {
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
            `${unrewritableKeyReason(unrewritable)}, so the plan cannot rewrite the value there. Rewrite it in the database yourself, or ${change.statement !== undefined ? 'leave out this statement' : change.to === undefined ? 'keep the enum value in the contract' : `keep its stored value ${JSON.stringify(change.from)} in the contract`}.`,
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
          storedKey: { key: enumValueText(enums.fromContract, change.enumValue), together },
          keepAdvice: change.statement === undefined ? keepAdvice(enums, change) : undefined,
          renameStatement: change.statement,
        },
        input.contract,
        rewriteCollectionOf(input.schema, place.collection),
        input.arrivalOf,
      )) {
        push(conflict);
      }
    }
  }
  return conflicts;
}
