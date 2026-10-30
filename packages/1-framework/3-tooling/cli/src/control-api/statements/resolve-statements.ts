import { isDeepStrictEqual } from 'node:util';
import {
  type ApplicationDomainNamespace,
  asNamespaceId,
  type ContractEnum,
  type ContractField,
  type ContractFieldType,
  type ContractModelBase,
  type ContractValueObject,
  type ContractWithDomain,
  type StorageBase,
  valueObjectAt,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import {
  type EnumValueCoordinate,
  type FieldCoordinate,
  fieldStatementText,
  type ModelCoordinate,
  modelDisplayName,
  modelStatementText,
  type ResolvedMigrationStatement,
  type ValueObjectFieldCoordinate,
  valueObjectFieldStatementText,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  errorStatementInvalid,
  errorStatementOriginUnknown,
  errorStatementUnresolved,
} from '../../utils/cli-errors';
import { parseConsentStatement } from './parse-consent';
import { type ParsedFieldStatement, parseFieldStatement } from './parse-field-statement';
import {
  mixedSidesFix,
  type ParsedRename,
  parseRenameStatement,
  type StatementSide,
} from './parse-rename';
import { statementFlag } from './statement-flag';
import { ENTITY_WORDS, type StatementText } from './statement-text';
import { variantValue } from './variants';

/**
 * The origin contract statements resolve against, or where the command looked
 * for it without finding it.
 */
export type StatementOrigin =
  | { readonly kind: 'contract'; readonly contract: ContractWithDomain }
  | {
      readonly kind: 'missing';
      readonly hash: string | null;
      readonly snapshotDirectory: string;
      /** Why the snapshot that exists for `hash` could not be read; `undefined` when there is none. */
      readonly unreadable: string | undefined;
    };

/**
 * `origin` and `destination` are the application contract space's contracts;
 * names that exist only in an extension space never resolve.
 */
export interface ResolveStatementsInput {
  /** The statements as the user wrote them, in the order given. */
  readonly statements: readonly StatementText[];
  readonly origin: StatementOrigin;
  readonly destination: ContractWithDomain;
}

type Side = 'old' | 'new';

interface NamedContract {
  readonly name: 'origin' | 'destination';
  readonly contract: ContractWithDomain;
}

interface FoundModel {
  readonly coordinate: ModelCoordinate;
  readonly model: ContractModelBase;
}

interface Refusal {
  readonly reason: string;
  readonly fix: string;
  /** Set when a field's model has no origin counterpart: the model, as the destination names it. */
  readonly modelWithoutCounterpart?: string;
  /** Set when the name is a value object's rather than a model's: the value object's name. */
  readonly valueObject?: string;
}

type ModelLookup =
  | ({ readonly kind: 'found' } & FoundModel)
  | ({ readonly kind: 'missing' | 'refused' } & Refusal);

interface ModelReading extends FoundModel {
  readonly entity: 'model';
}

interface FieldReading {
  readonly entity: 'field';
  readonly coordinate: FieldCoordinate;
  readonly model: ContractModelBase;
  readonly destinationModel: ModelCoordinate | undefined;
}

interface EnumValueReading {
  readonly entity: 'enumValue';
  readonly coordinate: EnumValueCoordinate;
  /** The members of the enum on the side the reading is of. */
  readonly members: readonly string[];
}

interface ValueObjectFieldReading {
  readonly entity: 'valueObjectField';
  readonly coordinate: ValueObjectFieldCoordinate;
  /** The fields of the value object on the side the reading is of. */
  readonly fields: readonly string[];
}

type SideReading = ModelReading | FieldReading | EnumValueReading | ValueObjectFieldReading;

interface FoundEnum {
  readonly namespaceId: string;
  readonly members: readonly string[];
}

type EnumLookup =
  | ({ readonly kind: 'found' } & FoundEnum)
  | ({ readonly kind: 'missing' | 'refused' } & Refusal);

interface FoundValueObject {
  readonly namespaceId: string;
  readonly valueObject: ContractValueObject;
}

type ValueObjectLookup =
  | ({ readonly kind: 'found' } & FoundValueObject)
  | ({ readonly kind: 'missing' | 'refused' } & Refusal);

interface ResolutionState {
  readonly origin: NamedContract;
  readonly destination: NamedContract;
  readonly originOfRenamedModel: Map<string, ModelCoordinate>;
  /** The origin field of each renamed field, keyed by the field as the destination names it. */
  readonly originOfRenamedField: Map<string, FieldCoordinate>;
  /** The origin field of each renamed value object field, keyed by the field as the destination names it. */
  readonly originOfRenamedValueObjectField: Map<string, ValueObjectFieldCoordinate>;
  /** The origin id of each renamed namespace, keyed by its destination id. */
  readonly originOfRenamedNamespace: Map<string, string>;
  readonly renamedFrom: Set<string>;
  readonly renamedTo: Set<string>;
  /** Each field a convert or backfill statement names, keyed by its verb and the field. */
  readonly fieldStatements: Set<string>;
}

const NAMESPACE_RENAMES = 'namespace';
const ENUM_VALUE_RENAMES = 'enumValue';
const VALUE_OBJECT_FIELD_RENAMES = 'valueObjectField';
const MODEL_RENAMES = 'model';
const FIELD_RENAMES = 'field';
const LISTED_LIMIT = 20;

const CHECK_NAMES_FIX =
  'The old name must exist in the origin contract and not in the destination contract, and the new name the other way round. Names match exactly, including case.';
const STORED_NAME_ONLY =
  'If only the stored name changed (@map or @@map), a statement cannot state that in this release, and a plan without it drops and creates what the model or field is stored in, with its data. With migration plan, edit the planned migration.ts to rename the stored name instead of dropping and creating it. With db update, rename it in the database yourself first, then run db update, which then finds nothing that loses data.';
const VALUE_OBJECT_FIX = 'Leave value objects and their fields out of the statements.';
const REPEATED_NAME_FIX =
  'Give each model, field or enum value at most one statement, and each new name to one model, field or enum value only.';

function qualifiedModel(coordinate: ModelCoordinate): string {
  return modelDisplayName(coordinate);
}

function displayName(namespaceId: string, name: string): string {
  return modelDisplayName({ namespaceId: asNamespaceId(namespaceId), model: name });
}

function qualifiedField(coordinate: FieldCoordinate): string {
  return `${qualifiedModel(coordinate)}.${coordinate.field}`;
}

/** An enum as a contract names it in messages: with its namespace only when the contract has several. */
function enumText(contract: NamedContract, namespaceId: string, name: string): string {
  return modelStatementText(contract.contract, {
    namespaceId: asNamespaceId(namespaceId),
    model: name,
  });
}

function qualifiedEnumValue(coordinate: EnumValueCoordinate): string {
  return `${displayName(coordinate.namespaceId, coordinate.enum)}.${coordinate.member}`;
}

function qualifiedValueObjectField(coordinate: ValueObjectFieldCoordinate): string {
  return `${displayName(coordinate.namespaceId, coordinate.valueObject)}.${coordinate.field}`;
}

function listed(names: readonly string[]): string {
  if (names.length === 0) return '(none)';
  const sorted = [...names].sort();
  const shown = sorted.slice(0, LISTED_LIMIT).join(', ');
  return sorted.length > LISTED_LIMIT ? `${shown} and ${sorted.length - LISTED_LIMIT} more` : shown;
}

function sentence(reason: string): string {
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
}

function unresolved(statement: StatementText, refusal: Refusal): CliStructuredError {
  return errorStatementUnresolved(statement, sentence(refusal.reason), refusal.fix);
}

function modelIn(
  namespace: ApplicationDomainNamespace,
  name: string,
): ContractModelBase | undefined {
  return Object.hasOwn(namespace.models, name) ? namespace.models[name] : undefined;
}

function hasValueObject(
  storage: Pick<StorageBase, 'namespaces'>,
  namespaceId: string,
  name: string,
): boolean {
  return (
    valueObjectAt(storage, {
      plane: 'storage',
      namespaceId,
      entityKind: 'valueObject',
      entityName: name,
    }) !== undefined
  );
}

function modelAt(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): ContractModelBase | undefined {
  const namespaces = contract.domain.namespaces;
  const namespace = Object.hasOwn(namespaces, coordinate.namespaceId)
    ? namespaces[coordinate.namespaceId]
    : undefined;
  return namespace === undefined ? undefined : modelIn(namespace, coordinate.model);
}

function fieldNames(model: ContractModelBase): readonly string[] {
  return [...Object.keys(model.fields), ...Object.keys(model.relations)];
}

function hasField(model: ContractModelBase, field: string): boolean {
  return Object.hasOwn(model.fields, field) || Object.hasOwn(model.relations, field);
}

function missing(reason: string): Refusal {
  return { reason, fix: CHECK_NAMES_FIX };
}

function valueObjectRefusal(name: string): Refusal {
  return {
    reason: `"${name}" is a value object, and value object renames are not supported in this release`,
    fix: VALUE_OBJECT_FIX,
    valueObject: name,
  };
}

function lookupModelInNamespace(
  contract: NamedContract,
  namespaceId: string,
  namespace: ApplicationDomainNamespace,
  name: string,
): ModelLookup {
  const model = modelIn(namespace, name);
  if (model !== undefined) {
    return {
      kind: 'found',
      coordinate: { namespaceId: asNamespaceId(namespaceId), model: name },
      model,
    };
  }
  if (hasValueObject(contract.contract.storage, namespaceId, name)) {
    return { kind: 'refused', ...valueObjectRefusal(displayName(namespaceId, name)) };
  }
  return {
    kind: 'missing',
    ...missing(
      `the ${contract.name} contract has no model "${name}" in namespace "${namespaceId}" (models there: ${listed(Object.keys(namespace.models))})`,
    ),
  };
}

function modelNames(contract: NamedContract): readonly string[] {
  return Object.entries(contract.contract.domain.namespaces).flatMap(([id, namespace]) =>
    Object.keys(namespace.models).map((model) => displayName(id, model)),
  );
}

function lookupModel(
  contract: NamedContract,
  namespaceId: string | undefined,
  name: string,
): ModelLookup {
  const namespaces = contract.contract.domain.namespaces;
  if (namespaceId !== undefined) {
    const namespace = Object.hasOwn(namespaces, namespaceId) ? namespaces[namespaceId] : undefined;
    if (namespace === undefined) {
      const named = Object.keys(namespaces).filter((id) => id !== UNBOUND_NAMESPACE_ID);
      return {
        kind: 'missing',
        ...missing(
          named.length === 0
            ? `the ${contract.name} contract has no namespaces`
            : `the ${contract.name} contract has no namespace "${namespaceId}" (namespaces: ${listed(named)})`,
        ),
      };
    }
    return lookupModelInNamespace(contract, namespaceId, namespace, name);
  }
  const declaring = Object.entries(namespaces).filter(
    ([, namespace]) => modelIn(namespace, name) !== undefined,
  );
  const [only] = declaring;
  if (only !== undefined && declaring.length === 1) {
    return lookupModelInNamespace(contract, only[0], only[1], name);
  }
  if (declaring.length > 1) {
    // The only way to name a model of the unbound namespace here is its namespace id.
    const candidates = declaring.map(([id]) => `${id}.${name}`).sort();
    return {
      kind: 'refused',
      reason: `"${name}" is a model in more than one namespace of the ${contract.name} contract (${listed(candidates)})`,
      fix: `Name the model with its namespace, for example ${candidates[0]}.`,
    };
  }
  const storageNamespaceIds = Object.keys(contract.contract.storage.namespaces);
  if (
    storageNamespaceIds.some((namespaceId) =>
      hasValueObject(contract.contract.storage, namespaceId, name),
    )
  ) {
    return { kind: 'refused', ...valueObjectRefusal(name) };
  }
  return {
    kind: 'missing',
    ...missing(
      `the ${contract.name} contract has no model "${name}" (models: ${listed(modelNames(contract))})`,
    ),
  };
}

function enumsOf(namespace: ApplicationDomainNamespace): Readonly<Record<string, ContractEnum>> {
  return namespace.enum ?? {};
}

function lookupEnum(
  contract: NamedContract,
  namespaceId: string | undefined,
  name: string,
): EnumLookup {
  const namespaces = contract.contract.domain.namespaces;
  const declaring = Object.entries(namespaces).filter(
    ([id, namespace]) =>
      (namespaceId === undefined || id === namespaceId) && Object.hasOwn(enumsOf(namespace), name),
  );
  const [only] = declaring;
  if (only !== undefined && declaring.length === 1) {
    const members = enumsOf(only[1])[name]?.members.map((member) => member.name) ?? [];
    return { kind: 'found', namespaceId: only[0], members };
  }
  if (declaring.length > 1) {
    const candidates = declaring.map(([id]) => `${id}.${name}`).sort();
    return {
      kind: 'refused',
      reason: `"${name}" is an enum in more than one namespace of the ${contract.name} contract (${listed(candidates)})`,
      fix: `Name the enum with its namespace, for example ${candidates[0]}.`,
    };
  }
  const enums = Object.entries(namespaces).flatMap(([id, namespace]) =>
    namespaceId === undefined || id === namespaceId ? Object.keys(enumsOf(namespace)) : [],
  );
  const within = namespaceId === undefined ? '' : ` in namespace "${namespaceId}"`;
  const there = namespaceId === undefined ? '' : ' there';
  const known = enums.length === 0 ? '' : ` (enums${there}: ${listed([...new Set(enums)])})`;
  return {
    kind: 'missing',
    ...missing(`the ${contract.name} contract has no enum "${name}"${within}${known}`),
  };
}

function readEnumValue(
  state: ResolutionState,
  side: Side,
  namespaceId: string | undefined,
  name: string,
  member: string,
): Result<EnumValueReading, Refusal> {
  const contract = side === 'old' ? state.origin : state.destination;
  const renamedFrom =
    side === 'old' && namespaceId !== undefined
      ? state.originOfRenamedNamespace.get(namespaceId)
      : undefined;
  const lookup = lookupEnum(contract, renamedFrom ?? namespaceId, name);
  if (lookup.kind !== 'found') return notOk(lookup);
  if (!lookup.members.includes(member)) {
    return notOk(
      missing(
        `the ${contract.name} enum "${enumText(contract, lookup.namespaceId, name)}" has no value "${member}" (values: ${listed(lookup.members)})`,
      ),
    );
  }
  return ok({
    entity: 'enumValue',
    coordinate: { namespaceId: asNamespaceId(lookup.namespaceId), enum: name, member },
    members: lookup.members,
  });
}

function declaresEnums(contract: NamedContract): boolean {
  return Object.values(contract.contract.domain.namespaces).some(
    (namespace) => Object.keys(enumsOf(namespace)).length > 0,
  );
}

function lookupValueObject(
  contract: NamedContract,
  namespaceId: string | undefined,
  name: string,
): ValueObjectLookup {
  const storage = contract.contract.storage;
  const declaring = Object.keys(storage.namespaces).flatMap((id) => {
    if (namespaceId !== undefined && id !== namespaceId) return [];
    const valueObject = valueObjectAt(storage, {
      plane: 'storage',
      namespaceId: id,
      entityKind: 'valueObject',
      entityName: name,
    });
    return valueObject === undefined ? [] : [{ namespaceId: id, valueObject }];
  });
  const [only] = declaring;
  if (only !== undefined && declaring.length === 1) return { kind: 'found', ...only };
  if (declaring.length > 1) {
    const candidates = declaring.map(({ namespaceId: id }) => `${id}.${name}`).sort();
    return {
      kind: 'refused',
      reason: `"${name}" is a value object in more than one namespace of the ${contract.name} contract (${listed(candidates)})`,
      fix: `Name the value object with its namespace, for example ${candidates[0]}.`,
    };
  }
  const within = namespaceId === undefined ? '' : ` in namespace "${namespaceId}"`;
  return {
    kind: 'missing',
    ...missing(`the ${contract.name} contract has no value object "${name}"${within}`),
  };
}

function readValueObjectField(
  state: ResolutionState,
  side: Side,
  namespaceId: string | undefined,
  name: string,
  field: string,
): Result<ValueObjectFieldReading, Refusal> {
  const contract = side === 'old' ? state.origin : state.destination;
  const renamedFrom =
    side === 'old' && namespaceId !== undefined
      ? state.originOfRenamedNamespace.get(namespaceId)
      : undefined;
  const lookup = lookupValueObject(contract, renamedFrom ?? namespaceId, name);
  if (lookup.kind !== 'found') return notOk(lookup);
  const fields = Object.keys(lookup.valueObject.fields);
  if (!fields.includes(field)) {
    return notOk(
      missing(
        `the ${contract.name} value object "${enumText(contract, lookup.namespaceId, name)}" has no field "${field}" (fields: ${listed(fields)})`,
      ),
    );
  }
  return ok({
    entity: 'valueObjectField',
    coordinate: { namespaceId: asNamespaceId(lookup.namespaceId), valueObject: name, field },
    fields,
  });
}

function readingText(reading: SideReading): string {
  switch (reading.entity) {
    case 'model':
      return `namespace "${reading.coordinate.namespaceId}" model "${reading.coordinate.model}"`;
    case 'field':
      return `model "${reading.coordinate.model}" field "${reading.coordinate.field}"`;
    case 'enumValue':
      return `enum "${reading.coordinate.enum}" value "${reading.coordinate.member}"`;
    case 'valueObjectField':
      return `value object "${reading.coordinate.valueObject}" field "${reading.coordinate.field}"`;
  }
}

function qualifiedReading(reading: SideReading): string {
  switch (reading.entity) {
    case 'model':
      return qualifiedModel(reading.coordinate);
    case 'field':
      return qualifiedField(reading.coordinate);
    case 'enumValue':
      return qualifiedEnumValue(reading.coordinate);
    case 'valueObjectField':
      return qualifiedValueObjectField(reading.coordinate);
  }
}

/** What a reading sits in, which a rename can give another name so that the reading stops colliding. */
function readingContainer(reading: SideReading): string {
  switch (reading.entity) {
    case 'model':
      return `namespace "${reading.coordinate.namespaceId}"`;
    case 'field':
      return `model "${reading.coordinate.model}"`;
    case 'enumValue':
      return `enum "${reading.coordinate.enum}"`;
    case 'valueObjectField':
      return `value object "${reading.coordinate.valueObject}"`;
  }
}

function joinedAs(texts: readonly string[]): string {
  return texts.length === 2
    ? `both as ${texts[0]} and as ${texts[1]}`
    : `as ${texts.slice(0, -1).join(', as ')} and as ${texts.at(-1)}`;
}

/**
 * The enum value and value object field readings beside the model or field reading of the same
 * name: the one that resolves, `primary`'s failure when none does, or a refusal naming each
 * reading when more than one does.
 */
function oneReading(
  text: string,
  primary: Result<SideReading, Refusal>,
  others: readonly Result<SideReading, Refusal>[],
): Result<SideReading, Refusal> {
  const readings = [primary, ...others].flatMap((reading) => (reading.ok ? [reading.value] : []));
  const [only] = readings;
  if (only === undefined) return primary;
  if (readings.length === 1) return ok(only);
  const nameable = readings.filter((reading) => qualifiedReading(reading) !== text);
  const unnameable = readings.find((reading) => qualifiedReading(reading) === text);
  const written = nameable.map(
    (reading) => `${qualifiedReading(reading)} for the ${ENTITY_WORDS[reading.entity]}`,
  );
  return notOk({
    reason: `"${text}" resolves ${joinedAs(readings.map(readingText))}`,
    fix:
      unnameable === undefined
        ? `Name it with its namespace: ${written.join(', ')}.`
        : `Write ${written.join(', ')}. The ${ENTITY_WORDS[unnameable.entity]} cannot be named apart from it: rename ${readings.map(readingContainer).join(' or ')} so that only one reading resolves.`,
  });
}

function readModel(
  state: ResolutionState,
  side: Side,
  namespaceId: string | undefined,
  name: string,
): Result<ModelReading, Refusal> {
  const lookup = lookupModel(side === 'old' ? state.origin : state.destination, namespaceId, name);
  if (lookup.kind !== 'found') return notOk(lookup);
  return ok({ entity: 'model', coordinate: lookup.coordinate, model: lookup.model });
}

function readFieldOf(
  contract: NamedContract,
  found: FoundModel,
  field: string,
  destinationModel: ModelCoordinate | undefined,
): Result<FieldReading, Refusal> {
  if (!hasField(found.model, field)) {
    return notOk(
      missing(
        `the ${contract.name} model "${qualifiedModel(found.coordinate)}" has no field "${field}" (fields: ${listed(fieldNames(found.model))})`,
      ),
    );
  }
  return ok({
    entity: 'field',
    coordinate: { ...found.coordinate, field },
    model: found.model,
    destinationModel,
  });
}

function originCounterpart(
  state: ResolutionState,
  destinationModel: ModelCoordinate,
): FoundModel | undefined {
  const namespaceOrigin = state.originOfRenamedNamespace.get(destinationModel.namespaceId);
  const coordinate =
    state.originOfRenamedModel.get(qualifiedModel(destinationModel)) ??
    (namespaceOrigin === undefined
      ? destinationModel
      : { namespaceId: asNamespaceId(namespaceOrigin), model: destinationModel.model });
  const model = modelAt(state.origin.contract, coordinate);
  return model === undefined ? undefined : { coordinate, model };
}

/**
 * The old side of a field rename names the model as the destination spells
 * it, and the field as the origin counterpart of that model has it. When the
 * model is not in the destination but the origin has it with that field, the
 * reading still resolves so the caller can say the field would move between
 * models.
 */
function readOldField(
  state: ResolutionState,
  namespaceId: string | undefined,
  modelName: string,
  field: string,
): Result<FieldReading, Refusal> {
  const destination = lookupModel(state.destination, namespaceId, modelName);
  if (destination.kind === 'found') {
    const counterpart = originCounterpart(state, destination.coordinate);
    if (counterpart === undefined) {
      const name = qualifiedModel(destination.coordinate);
      return notOk({
        reason: `the destination model "${name}" has no counterpart in the origin contract: the origin has no model "${name}" and no earlier statement renames a model to it`,
        fix: `Rename the origin model to "${name}" with its own --rename statement before this one, or check the names.`,
        modelWithoutCounterpart: name,
      });
    }
    return readFieldOf(state.origin, counterpart, field, destination.coordinate);
  }
  if (destination.kind === 'refused') return notOk(destination);
  const origin = lookupModel(state.origin, namespaceId, modelName);
  if (origin.kind === 'found' && hasField(origin.model, field)) {
    return readFieldOf(state.origin, origin, field, undefined);
  }
  return notOk(destination);
}

function readNewField(
  state: ResolutionState,
  namespaceId: string | undefined,
  modelName: string,
  field: string,
): Result<FieldReading, Refusal> {
  const destination = lookupModel(state.destination, namespaceId, modelName);
  if (destination.kind !== 'found') return notOk(destination);
  return readFieldOf(state.destination, destination, field, destination.coordinate);
}

function readField(
  state: ResolutionState,
  side: Side,
  namespaceId: string | undefined,
  modelName: string,
  field: string,
): Result<FieldReading, Refusal> {
  return side === 'old'
    ? readOldField(state, namespaceId, modelName, field)
    : readNewField(state, namespaceId, modelName, field);
}

function readSide(
  state: ResolutionState,
  side: Side,
  segments: StatementSide,
): Result<SideReading, Refusal> {
  if (segments.length === 1) return readModel(state, side, undefined, segments[0]);
  const contract = side === 'old' ? state.origin : state.destination;
  if (segments.length === 3) {
    const [first, second, third] = segments;
    const qualified = readField(state, side, first, second, third);
    const dotted = readField(state, side, undefined, first, `${second}.${third}`);
    if (qualified.ok && dotted.ok) {
      return notOk({
        reason: `"${first}.${second}.${third}" resolves both as namespace "${first}" model "${second}" field "${third}" and as model "${first}" field "${second}.${third}"`,
        fix: `Give the field a stored name without "." with @map, or rename namespace "${first}" or model "${first}", so that only one reading resolves.`,
      });
    }
    const asField = qualified.ok || !dotted.ok ? qualified : dotted;
    const asEnumValue = readEnumValue(state, side, first, second, third);
    const asValueObjectField = readValueObjectField(state, side, first, second, third);
    if (asField.ok || asEnumValue.ok || asValueObjectField.ok) {
      return oneReading(segments.join('.'), asField, [asEnumValue, asValueObjectField]);
    }
    if (containerNames(contract).valueObjects.has(second)) return asValueObjectField;
    if (!declaresEnums(contract)) return asField;
    return notOk({
      ...missing(
        `"${segments.join('.')}" resolves neither as namespace.Model.field (${asField.failure.reason}) nor as namespace.Enum.value (${asEnumValue.failure.reason})`,
      ),
      ...ifDefined('modelWithoutCounterpart', asField.failure.modelWithoutCounterpart),
    });
  }
  const [first, second] = segments;
  const asModel = readModel(state, side, first, second);
  const asField = readField(state, side, undefined, first, second);
  const asEnumValue = readEnumValue(state, side, undefined, first, second);
  const asValueObjectField = readValueObjectField(state, side, undefined, first, second);
  if (asModel.ok && asField.ok) {
    return notOk({
      reason: `"${first}.${second}" resolves both as namespace "${first}" model "${second}" and as model "${first}" field "${second}"`,
      fix: 'Write the field as namespace.Model.field if you mean the field.',
    });
  }
  if (asModel.ok || asField.ok || asEnumValue.ok || asValueObjectField.ok) {
    return oneReading(`${first}.${second}`, asModel.ok ? asModel : asField, [
      asEnumValue,
      asValueObjectField,
    ]);
  }
  const names = containerNames(contract);
  if (names.valueObjects.has(first) && !names.namespaces.has(first) && !names.models.has(first)) {
    return asValueObjectField;
  }
  if (names.enums.has(first) && !names.namespaces.has(first) && !names.models.has(first)) {
    return asEnumValue;
  }
  const hasNamespaces = names.namespaces.size > 0;
  const hasEnums = declaresEnums(contract);
  if (!hasNamespaces && !hasEnums) return asField;
  const readings = [
    ...(hasNamespaces ? [`as namespace.Model (${asModel.failure.reason})`] : []),
    `as Model.field (${asField.failure.reason})`,
    ...(hasEnums ? [`as Enum.value (${asEnumValue.failure.reason})`] : []),
  ];
  const sameButCase = [...names.namespaces, ...names.models, ...names.enums].find(
    (name) => name !== first && name.toLowerCase() === first.toLowerCase(),
  );
  return notOk({
    reason: `"${first}.${second}" resolves neither ${readings.slice(0, -1).join(', ')}${readings.length > 2 ? ',' : ''} nor ${readings.at(-1)}`,
    fix:
      sameButCase === undefined
        ? CHECK_NAMES_FIX
        : `Names match exactly, including case: write ${sameButCase}, not ${first}.`,
    ...ifDefined('modelWithoutCounterpart', asField.failure.modelWithoutCounterpart),
  });
}

/** The names a side's first segment can be: a namespace, a model, an enum or a value object of the contract. */
function containerNames(contract: NamedContract): {
  readonly namespaces: ReadonlySet<string>;
  readonly models: ReadonlySet<string>;
  readonly enums: ReadonlySet<string>;
  readonly valueObjects: ReadonlySet<string>;
} {
  const namespaces = Object.entries(contract.contract.domain.namespaces);
  return {
    namespaces: new Set(namespaces.flatMap(([id]) => (id === UNBOUND_NAMESPACE_ID ? [] : [id]))),
    models: new Set(namespaces.flatMap(([, namespace]) => Object.keys(namespace.models))),
    enums: new Set(namespaces.flatMap(([, namespace]) => Object.keys(enumsOf(namespace)))),
    valueObjects: new Set(
      valueObjectsWithCoordinates(contract.contract.storage).map(
        ({ coordinate }) => coordinate.entityName,
      ),
    ),
  };
}

function resolveModelRename(
  state: ResolutionState,
  statement: ParsedRename,
  from: ModelCoordinate,
  to: ModelCoordinate,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const fromKey = `${MODEL_RENAMES}:${qualifiedModel(from)}`;
  const toKey = `${MODEL_RENAMES}:${qualifiedModel(to)}`;
  if (state.renamedFrom.has(fromKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames "${qualifiedModel(from)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (state.renamedTo.has(toKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames a model to "${qualifiedModel(to)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (qualifiedModel(from) === qualifiedModel(to)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `The statement renames model "${qualifiedModel(from)}" to itself.`,
        `Leave out --${statement.verb} ${statement.text}. ${STORED_NAME_ONLY}`,
      ),
    );
  }
  if (
    modelAt(state.origin.contract, to) !== undefined &&
    modelAt(state.destination.contract, from) !== undefined
  ) {
    return notOk(swapRefusal(statement, 'model', qualifiedModel(from), qualifiedModel(to)));
  }
  if (modelAt(state.origin.contract, to) !== undefined) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `"${qualifiedModel(to)}" already exists in the origin contract, so it cannot be the new name of a model.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  if (modelAt(state.destination.contract, from) !== undefined) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `"${qualifiedModel(from)}" still exists in the destination contract, so it was not renamed.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  state.renamedFrom.add(fromKey);
  state.renamedTo.add(toKey);
  state.originOfRenamedModel.set(qualifiedModel(to), from);
  return ok({ kind: 'rename', entity: 'model', from, to });
}

function modelPart(side: StatementSide): string {
  return side.slice(0, -1).join('.');
}

/**
 * The old side names a model the destination contract does not have. The
 * user most likely named the field's model by its old name, so the error
 * writes the statement with the model named as the destination names it.
 */
function oldModelNotInDestination(
  state: ResolutionState,
  statement: ParsedRename,
  from: FieldReading,
  toModel: string,
): CliStructuredError {
  const oldModel = modelPart(statement.from);
  const newModel = modelPart(statement.to);
  const corrected = `${newModel}.${from.coordinate.field}:${statement.to.join('.')}`;
  const renamedEarlier = state.originOfRenamedModel.get(toModel);
  const modelRenamed =
    renamedEarlier !== undefined &&
    qualifiedModel(renamedEarlier) === qualifiedModel(from.coordinate);
  const modelStatement = `${oldModel}:${newModel}`;
  const why = [
    `"${qualifiedModel(from.coordinate)}" is not a model of the destination contract, and a field cannot move between models.`,
    `Name a field's model as the destination contract names it: --${statement.verb} ${corrected}.`,
    ...(modelRenamed
      ? []
      : [`The model also needs its own statement, --rename ${modelStatement}, before it.`]),
  ].join(' ');
  const fix = modelRenamed
    ? `Write the statement as --${statement.verb} ${corrected}.`
    : `Write the statements as --rename ${modelStatement} --${statement.verb} ${corrected}.`;
  return errorStatementInvalid(statement, why, fix);
}

function fieldMovesBetweenModels(
  statement: StatementText,
  fromModel: string,
  toModel: string,
): CliStructuredError {
  return errorStatementInvalid(
    statement,
    `The old name is a field of "${fromModel}" and the new name a field of "${toModel}"; a field cannot move between models.`,
    'Rename a field within one model, and name that model as the destination contract names it.',
  );
}

/**
 * True when the old side most likely names the new side's model by its old
 * name: no earlier statement renamed the old model to some other model or
 * some other model to the new model, and the origin does not have the new
 * model.
 */
function oldSideNamesNewModel(
  state: ResolutionState,
  from: FieldReading,
  to: FieldReading,
): boolean {
  const oldModel = qualifiedModel(from.coordinate);
  const renamedTo = [...state.originOfRenamedModel.entries()].find(
    ([, origin]) => qualifiedModel(origin) === oldModel,
  )?.[0];
  if (renamedTo !== undefined) return renamedTo === qualifiedModel(to.coordinate);
  if (state.originOfRenamedModel.has(qualifiedModel(to.coordinate))) return false;
  return modelAt(state.origin.contract, to.coordinate) === undefined;
}

function resolveFieldRename(
  state: ResolutionState,
  statement: ParsedRename,
  from: FieldReading,
  to: FieldReading,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const toModel = qualifiedModel(to.coordinate);
  if (from.destinationModel === undefined) {
    return notOk(
      oldSideNamesNewModel(state, from, to)
        ? oldModelNotInDestination(state, statement, from, toModel)
        : fieldMovesBetweenModels(statement, qualifiedModel(from.coordinate), toModel),
    );
  }
  if (qualifiedModel(from.destinationModel) !== toModel) {
    return notOk(
      fieldMovesBetweenModels(statement, qualifiedModel(from.destinationModel), toModel),
    );
  }
  const fromKey = `${FIELD_RENAMES}:${qualifiedField(from.coordinate)}`;
  const toKey = `${FIELD_RENAMES}:${qualifiedField(to.coordinate)}`;
  if (state.renamedFrom.has(fromKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames "${qualifiedField(from.coordinate)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (state.renamedTo.has(toKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames a field to "${qualifiedField(to.coordinate)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (from.coordinate.field === to.coordinate.field) {
    return notOk(
      errorStatementInvalid(
        statement,
        `The statement renames field "${toModel}.${to.coordinate.field}" to itself.`,
        `Leave out --${statement.verb} ${statement.text}. ${STORED_NAME_ONLY}`,
      ),
    );
  }
  if (hasField(from.model, to.coordinate.field) && hasField(to.model, from.coordinate.field)) {
    return notOk(
      swapRefusal(
        statement,
        'field',
        `${toModel}.${from.coordinate.field}`,
        `${toModel}.${to.coordinate.field}`,
      ),
    );
  }
  if (hasField(from.model, to.coordinate.field)) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `The field "${to.coordinate.field}" already exists on the origin model "${qualifiedModel(from.coordinate)}", so it cannot be the new name of a field.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  if (hasField(to.model, from.coordinate.field)) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `The field "${from.coordinate.field}" still exists on the destination model "${toModel}", so it was not renamed.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  state.renamedFrom.add(fromKey);
  state.renamedTo.add(toKey);
  state.originOfRenamedField.set(qualifiedField(to.coordinate), from.coordinate);
  return ok({ kind: 'rename', entity: 'field', from: from.coordinate, to: to.coordinate });
}

function resolveEnumValueRename(
  state: ResolutionState,
  statement: ParsedRename,
  from: EnumValueReading,
  to: EnumValueReading,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const oldEnum = enumText(state.origin, from.coordinate.namespaceId, from.coordinate.enum);
  const newEnum = enumText(state.destination, to.coordinate.namespaceId, to.coordinate.enum);
  const toNamespaceInOrigin =
    state.originOfRenamedNamespace.get(to.coordinate.namespaceId) ?? to.coordinate.namespaceId;
  if (
    from.coordinate.namespaceId !== toNamespaceInOrigin ||
    from.coordinate.enum !== to.coordinate.enum
  ) {
    return notOk(
      errorStatementInvalid(
        statement,
        `The old name is a value of enum "${oldEnum}" and the new name a value of enum "${newEnum}"; a value cannot move between enums.`,
        `Rename a value within one enum: --${statement.verb} ${statement.from.join('.')}:${statement.from.slice(0, -1).join('.')}.<new name>.`,
      ),
    );
  }
  const oldMember = from.coordinate.member;
  const newMember = to.coordinate.member;
  const fromKey = `${ENUM_VALUE_RENAMES}:${qualifiedEnumValue(from.coordinate)}`;
  const toKey = `${ENUM_VALUE_RENAMES}:${qualifiedEnumValue(to.coordinate)}`;
  if (state.renamedFrom.has(fromKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames "${qualifiedEnumValue(from.coordinate)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (state.renamedTo.has(toKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames a value to "${qualifiedEnumValue(to.coordinate)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (oldMember === newMember) {
    return notOk(
      errorStatementInvalid(
        statement,
        `The statement renames enum value "${qualifiedEnumValue(from.coordinate)}" to itself.`,
        `Leave out --${statement.verb} ${statement.text}.`,
      ),
    );
  }
  const newInOrigin = from.members.includes(newMember);
  const oldInDestination = to.members.includes(oldMember);
  if (newInOrigin && oldInDestination) {
    return notOk(
      swapRefusal(statement, 'enumValue', `${newEnum}.${oldMember}`, `${newEnum}.${newMember}`),
    );
  }
  if (newInOrigin) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `The value "${newMember}" already exists in the origin enum "${oldEnum}", so it cannot be the new name of a value.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  if (oldInDestination) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `The value "${oldMember}" still exists in the destination enum "${newEnum}", so it was not renamed.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  state.renamedFrom.add(fromKey);
  state.renamedTo.add(toKey);
  return ok({ kind: 'rename', entity: 'enumValue', from: from.coordinate, to: to.coordinate });
}

function resolveValueObjectFieldRename(
  state: ResolutionState,
  statement: ParsedRename,
  from: ValueObjectFieldReading,
  to: ValueObjectFieldReading,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const oldValueObject = enumText(
    state.origin,
    from.coordinate.namespaceId,
    from.coordinate.valueObject,
  );
  const newValueObject = enumText(
    state.destination,
    to.coordinate.namespaceId,
    to.coordinate.valueObject,
  );
  const toNamespaceInOrigin =
    state.originOfRenamedNamespace.get(to.coordinate.namespaceId) ?? to.coordinate.namespaceId;
  if (
    from.coordinate.namespaceId !== toNamespaceInOrigin ||
    from.coordinate.valueObject !== to.coordinate.valueObject
  ) {
    return notOk(
      errorStatementInvalid(
        statement,
        `The old name is a field of value object "${oldValueObject}" and the new name a field of value object "${newValueObject}"; a field cannot move between value objects.`,
        `Rename a field within one value object: --${statement.verb} ${statement.from.join('.')}:${statement.from.slice(0, -1).join('.')}.<new name>.`,
      ),
    );
  }
  const oldField = from.coordinate.field;
  const newField = to.coordinate.field;
  const fromKey = `${VALUE_OBJECT_FIELD_RENAMES}:${qualifiedValueObjectField(from.coordinate)}`;
  const toKey = `${VALUE_OBJECT_FIELD_RENAMES}:${qualifiedValueObjectField(to.coordinate)}`;
  if (state.renamedFrom.has(fromKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames "${qualifiedValueObjectField(from.coordinate)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (state.renamedTo.has(toKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames a field to "${qualifiedValueObjectField(to.coordinate)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (oldField === newField) {
    return notOk(
      errorStatementInvalid(
        statement,
        `The statement renames value object field "${qualifiedValueObjectField(from.coordinate)}" to itself.`,
        `Leave out --${statement.verb} ${statement.text}.`,
      ),
    );
  }
  const newInOrigin = from.fields.includes(newField);
  const oldInDestination = to.fields.includes(oldField);
  if (newInOrigin && oldInDestination) {
    return notOk(
      swapRefusal(
        statement,
        'valueObjectField',
        `${newValueObject}.${oldField}`,
        `${newValueObject}.${newField}`,
      ),
    );
  }
  if (newInOrigin) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `The field "${newField}" already exists in the origin value object "${oldValueObject}", so it cannot be the new name of a field.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  if (oldInDestination) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `The field "${oldField}" still exists in the destination value object "${newValueObject}", so it was not renamed.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  state.renamedFrom.add(fromKey);
  state.renamedTo.add(toKey);
  state.originOfRenamedValueObjectField.set(
    qualifiedValueObjectField(to.coordinate),
    from.coordinate,
  );
  return ok({
    kind: 'rename',
    entity: 'valueObjectField',
    from: from.coordinate,
    to: to.coordinate,
  });
}

/**
 * Two names that trade places: each is an old name and a new name, which one plan cannot do.
 * Statements resolve against contracts, so the swap takes three plans through a temporary name.
 */
function swapRefusal(
  statement: ParsedRename,
  entity: 'model' | 'field' | 'enumValue' | 'valueObjectField',
  first: string,
  second: string,
): CliStructuredError {
  const verb = statement.verb;
  const oldName = statement.from.join('.');
  const newName = statement.to.join('.');
  const temporary =
    entity === 'model'
      ? '<temporary name>'
      : `${statement.to.slice(0, -1).join('.')}.<temporary name>`;
  const keptNames =
    entity === 'enumValue'
      ? ' If the members keep their names and only their stored values trade places, leave out the statement: the plan asks about each value and names the edits that keep its data.'
      : '';
  return errorStatementInvalid(
    statement,
    `"${first}" and "${second}" swap names: each is both an old name and a new name, and statements cannot swap names in one plan.`,
    `Make the swap in three plans. First change the contract so that "${first}" has a temporary name, and plan it with --${verb} ${oldName}:${temporary}. Then give "${second}" the name "${first}", and plan it with --${verb} ${newName}:${oldName}. Then give the temporary name the name "${second}", and plan it with --${verb} ${temporary}:${newName}.${keptNames}`,
  );
}

/**
 * The old side does not resolve. Says so in terms of what the user can do next when the statement
 * is the wrong way round, when the rename has already happened, or when a later statement renames
 * the field's model.
 */
function oldSideRefusal(
  state: ResolutionState,
  statement: ParsedRename,
  later: readonly ParsedRename[],
  refusal: Refusal,
): CliStructuredError {
  const oldText = statement.from.join('.');
  const newText = statement.to.join('.');
  const newIsInOrigin = readSide(state, 'old', statement.to).ok;
  const newIsInDestination = readSide(state, 'new', statement.to).ok;
  const oldIsInDestination = readSide(state, 'new', statement.from).ok;
  if (newIsInOrigin && oldIsInDestination && !newIsInDestination) {
    return errorStatementUnresolved(
      statement,
      `The statement is the wrong way round: "${newText}" is the old name, in the origin contract, and "${oldText}" the new name, in the destination contract.`,
      `Write the old name first: --${statement.verb} ${newText}:${oldText}.`,
    );
  }
  if (newIsInOrigin && newIsInDestination && !oldIsInDestination) {
    return errorStatementUnresolved(
      statement,
      `The origin contract already has "${newText}" and has no "${oldText}", so this rename has already happened. For db update, the database is already at the new name.`,
      `Leave out --${statement.verb} ${statement.text}.`,
    );
  }
  const model = refusal.modelWithoutCounterpart;
  const renamesModel =
    model === undefined
      ? undefined
      : later.find(
          (candidate) =>
            candidate.to.length < 3 &&
            readSide(state, 'new', candidate.to).ok &&
            [model, model.split('.').pop()].includes(candidate.to.join('.')),
        );
  if (renamesModel !== undefined) {
    return errorStatementUnresolved(
      statement,
      `${sentence(refusal.reason)} A later statement, --${renamesModel.verb} ${renamesModel.text}, renames it, and statements apply in the order given.`,
      `Put --${renamesModel.verb} ${renamesModel.text} before --${statement.verb} ${statement.text}.`,
    );
  }
  return unresolved(statement, refusal);
}

function namespacesOf(contract: NamedContract): readonly string[] {
  return Object.keys(contract.contract.domain.namespaces).filter(
    (id) => id !== UNBOUND_NAMESPACE_ID,
  );
}

/**
 * The namespace reading of a statement with one name on each side: `undefined` when the old name
 * is no namespace of the origin contract, so the statement is not about a namespace.
 */
function readNamespaceRename(
  state: ResolutionState,
  from: string,
  to: string,
): Result<{ readonly from: string; readonly to: string }, Refusal> | undefined {
  if (!namespacesOf(state.origin).includes(from)) return undefined;
  if (namespacesOf(state.destination).includes(from)) {
    return notOk(
      missing(
        `namespace "${from}" still exists in the destination contract, so it was not renamed`,
      ),
    );
  }
  const destinationNamespaces = namespacesOf(state.destination);
  if (!destinationNamespaces.includes(to)) {
    return notOk(
      missing(
        `the destination contract has no namespace "${to}" (namespaces: ${listed(destinationNamespaces)})`,
      ),
    );
  }
  if (namespacesOf(state.origin).includes(to)) {
    return notOk(
      missing(
        `namespace "${to}" already exists in the origin contract, so it cannot be the new name of a namespace`,
      ),
    );
  }
  return ok({ from, to });
}

function resolveNamespaceRename(
  state: ResolutionState,
  statement: ParsedRename,
  rename: { readonly from: string; readonly to: string },
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const fromKey = `${NAMESPACE_RENAMES}:${rename.from}`;
  const toKey = `${NAMESPACE_RENAMES}:${rename.to}`;
  if (state.renamedFrom.has(fromKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames namespace "${rename.from}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (state.renamedTo.has(toKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames a namespace to "${rename.to}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  state.renamedFrom.add(fromKey);
  state.renamedTo.add(toKey);
  state.originOfRenamedNamespace.set(rename.to, rename.from);
  return ok({
    kind: 'rename',
    entity: 'namespace',
    from: asNamespaceId(rename.from),
    to: asNamespaceId(rename.to),
  });
}

/** Whether an earlier or a later statement of the run renames the model with its namespace. */
function renamedElsewhere(
  state: ResolutionState,
  later: readonly ParsedRename[],
  model: ModelCoordinate,
): boolean {
  if (state.renamedFrom.has(`${MODEL_RENAMES}:${qualifiedModel(model)}`)) return true;
  return later.some((candidate) => {
    if (candidate.from.length !== 2) return false;
    const reading = readSide(state, 'old', candidate.from);
    return (
      reading.ok &&
      reading.value.entity === 'model' &&
      qualifiedModel(reading.value.coordinate) === qualifiedModel(model)
    );
  });
}

/**
 * A statement with one name on each side reads as a namespace rename or a model rename. Exactly
 * one reading must resolve; `undefined` leaves the statement to the model reading.
 */
/**
 * A one-name statement whose new name is a namespace of the destination, and whose old name is no
 * namespace or model of the origin, as when a namespace rename is given again.
 */
function neitherNamespaceNorModel(
  state: ResolutionState,
  statement: ParsedRename,
  from: string,
  to: string,
): Result<ResolvedMigrationStatement, CliStructuredError> | undefined {
  if (!namespacesOf(state.destination).includes(to)) return undefined;
  const fromModel = lookupModel(state.origin, undefined, from);
  if (fromModel.kind !== 'missing') return undefined;
  return notOk(
    unresolved(
      statement,
      missing(
        `the origin contract has no namespace or model "${from}" (namespaces: ${listed(namespacesOf(state.origin))}; models: ${listed(modelNames(state.origin))})`,
      ),
    ),
  );
}

function resolveOneNameStatement(
  state: ResolutionState,
  statement: ParsedRename,
  later: readonly ParsedRename[],
  from: string,
  to: string,
): Result<ResolvedMigrationStatement, CliStructuredError> | undefined {
  const asNamespace = readNamespaceRename(state, from, to);
  if (asNamespace === undefined) return neitherNamespaceNorModel(state, statement, from, to);
  const fromModel = readModel(state, 'old', undefined, from);
  const toModel = readModel(state, 'new', undefined, to);
  if (
    asNamespace.ok &&
    fromModel.ok &&
    renamedElsewhere(state, later, fromModel.value.coordinate)
  ) {
    return resolveNamespaceRename(state, statement, asNamespace.value);
  }
  if (asNamespace.ok && fromModel.ok && toModel.ok) {
    const oldModel = qualifiedModel(fromModel.value.coordinate);
    const newModel = qualifiedModel(toModel.value.coordinate);
    return notOk(
      errorStatementUnresolved(
        statement,
        `"${statement.text}" reads both as a rename of namespace "${from}" to "${to}" and as a rename of model "${oldModel}" to "${newModel}".`,
        `To rename the model, name it with its namespace: --${statement.verb} ${oldModel}:${newModel}. To rename both the namespace and the model, give both statements: --${statement.verb} ${oldModel}:${newModel} --${statement.verb} ${statement.text}.`,
      ),
    );
  }
  if (asNamespace.ok) return resolveNamespaceRename(state, statement, asNamespace.value);
  if (fromModel.ok) return undefined;
  return notOk(unresolved(statement, asNamespace.failure));
}

function resolveStatement(
  state: ResolutionState,
  statement: ParsedRename,
  later: readonly ParsedRename[],
): Result<ResolvedMigrationStatement, CliStructuredError> {
  if (statement.from.length === 1 && statement.to.length === 1) {
    const oneName = resolveOneNameStatement(
      state,
      statement,
      later,
      statement.from[0],
      statement.to[0],
    );
    if (oneName !== undefined) return oneName;
  }
  const from = readSide(state, 'old', statement.from);
  if (!from.ok) return notOk(oldSideRefusal(state, statement, later, from.failure));
  const to = readSide(state, 'new', statement.to);
  if (
    !to.ok &&
    (from.value.entity === 'enumValue' || from.value.entity === 'valueObjectField') &&
    statement.to.length === 1
  ) {
    const container = statement.from.slice(0, -1).join('.');
    const word = from.value.entity === 'enumValue' ? 'enum' : 'value object';
    return notOk(
      errorStatementUnresolved(
        statement,
        sentence(to.failure.reason),
        `Write the new name with its ${word}: --${statement.verb} ${statement.from.join('.')}:${container}.${statement.to[0]}.`,
      ),
    );
  }
  if (!to.ok) return notOk(unresolved(statement, to.failure));
  if (from.value.entity === 'model' && to.value.entity === 'model') {
    return resolveModelRename(state, statement, from.value.coordinate, to.value.coordinate);
  }
  if (from.value.entity === 'field' && to.value.entity === 'field') {
    return resolveFieldRename(state, statement, from.value, to.value);
  }
  if (from.value.entity === 'enumValue' && to.value.entity === 'enumValue') {
    return resolveEnumValueRename(state, statement, from.value, to.value);
  }
  if (from.value.entity === 'valueObjectField' && to.value.entity === 'valueObjectField') {
    return resolveValueObjectFieldRename(state, statement, from.value, to.value);
  }
  if (from.value.entity === 'valueObjectField' || to.value.entity === 'valueObjectField') {
    return notOk(
      errorStatementInvalid(
        statement,
        'The statement names a value object field on one side and something else on the other.',
        'Rename a value object field to another field of the same value object, as ValueObject.field:ValueObject.<new name>.',
      ),
    );
  }
  if (from.value.entity === 'enumValue' || to.value.entity === 'enumValue') {
    return notOk(
      errorStatementInvalid(
        statement,
        'The statement names an enum value on one side and a model or field on the other.',
        'Rename an enum value to another value of the same enum, as Enum.value:Enum.<new name>.',
      ),
    );
  }
  return notOk(
    errorStatementInvalid(
      statement,
      'The statement names a model on one side and a field on the other.',
      mixedSidesFix(statement.verb, statement.from, statement.to),
    ),
  );
}

function typeText(type: ContractFieldType): string {
  switch (type.kind) {
    case 'scalar':
      return type.typeParams === undefined
        ? type.codecId
        : `${type.codecId}(${JSON.stringify(type.typeParams)})`;
    case 'valueObject':
      return type.entityName;
    case 'union':
      return type.members.map(typeText).join(' | ');
  }
}

function fieldTypeText(field: ContractField): string {
  return `${typeText(field.type)}${field.many ? '[]' : ''}${field.dict ? ' dict' : ''}`;
}

function sameType(origin: ContractField, destination: ContractField): boolean {
  const shape = (field: ContractField) => ({
    type: field.type,
    many: field.many ?? false,
    dict: field.dict ?? false,
  });
  return isDeepStrictEqual(shape(origin), shape(destination));
}

/**
 * A convert of a variant: the model must be a variant in both contracts, followed through a rename,
 * and its discriminator value must have changed.
 */
function resolveVariantConvert(
  state: ResolutionState,
  statement: ParsedFieldStatement,
  variant: FoundModel,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const flag = statementFlag(statement);
  const refuse = (reason: string) =>
    notOk(unresolved(statement, { reason, fix: `Leave out ${flag}.` }));
  const shown = modelStatementText(state.destination.contract, variant.coordinate);
  const key = `convert:${qualifiedModel(variant.coordinate)}`;
  if (state.fieldStatements.has(key)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already converts "${shown}".`,
        'Give each variant at most one --convert statement.',
      ),
    );
  }
  const counterpart = originCounterpart(state, variant.coordinate);
  const from =
    counterpart === undefined
      ? undefined
      : variantValue(state.origin.contract, counterpart.coordinate);
  const to = variantValue(state.destination.contract, variant.coordinate);
  if (from === undefined || to === undefined) {
    return refuse(
      `the model "${shown}" is not a variant in both contracts; a --convert statement names a field, or a variant whose discriminator value changed`,
    );
  }
  if (from === to) {
    return refuse(
      `the variant "${shown}" has the discriminator value "${to}" in the origin and destination contracts, so it has no values to convert`,
    );
  }
  state.fieldStatements.add(key);
  return ok({ kind: 'convert', entity: 'model', model: variant.coordinate });
}

/** A convert with one name, which names a variant as the destination contract names it. */
function resolveOneNameConvert(
  state: ResolutionState,
  statement: ParsedFieldStatement,
  name: string,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const lookup = lookupModel(state.destination, undefined, name);
  if (lookup.kind === 'found') return resolveVariantConvert(state, statement, lookup);
  return notOk(
    unresolved(statement, {
      reason: lookup.reason,
      fix:
        lookup.kind === 'missing'
          ? 'A --convert statement with one name names a variant as the destination contract names it, Variant or namespace.Variant. Names match exactly, including case.'
          : lookup.fix,
    }),
  );
}

/**
 * The variant a two-name convert reads as, `namespace.Variant`, when the destination has that
 * model: `undefined` leaves the statement to the field reading, and a refusal names both readings
 * when the field reading resolves too.
 */
function readNamespaceVariant(
  state: ResolutionState,
  statement: ParsedFieldStatement,
  first: string,
  second: string,
): Result<FoundModel, CliStructuredError> | undefined {
  const asVariant = lookupModel(state.destination, first, second);
  if (asVariant.kind !== 'found') return undefined;
  const asFieldModel = lookupModel(state.destination, undefined, first);
  if (asFieldModel.kind !== 'found' || !hasField(asFieldModel.model, second)) return ok(asVariant);
  const field = qualifiedField({ ...asFieldModel.coordinate, field: second });
  return notOk(
    unresolved(statement, {
      reason: `"${statement.text}" reads both as variant "${qualifiedModel(asVariant.coordinate)}" and as field "${field}"`,
      fix: `Write the field as namespace.Model.field if you mean the field: --convert ${field}.`,
    }),
  );
}

/**
 * A backfill of a value object's field: the field must be required in the destination value object,
 * and absent or optional in the origin one, under its origin name when a rename gave it a new one.
 */
function resolveValueObjectFieldBackfill(
  state: ResolutionState,
  statement: ParsedFieldStatement,
  namespaceId: string | undefined,
  name: string,
  field: string,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const flag = statementFlag(statement);
  const leaveOut = `Leave out ${flag}.`;
  const refuse = (reason: string, fix: string = leaveOut) =>
    notOk(unresolved(statement, { reason, fix }));
  const destination = lookupValueObject(state.destination, namespaceId, name);
  if (destination.kind !== 'found') return refuse(destination.reason, destination.fix);
  const coordinate: ValueObjectFieldCoordinate = {
    namespaceId: asNamespaceId(destination.namespaceId),
    valueObject: name,
    field,
  };
  const shown = valueObjectFieldStatementText(state.destination.contract, coordinate);
  const destinationFields = destination.valueObject.fields;
  const destinationField = Object.hasOwn(destinationFields, field)
    ? destinationFields[field]
    : undefined;
  if (destinationField === undefined) {
    return refuse(
      `the destination value object "${enumText(state.destination, destination.namespaceId, name)}" has no field "${field}" (fields: ${listed(Object.keys(destinationFields))})`,
      'A --backfill statement names the field as the destination contract names it. Names match exactly, including case.',
    );
  }
  const key = `backfill:${qualifiedValueObjectField(coordinate)}`;
  if (state.fieldStatements.has(key)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already backfills "${shown}".`,
        'Give each field at most one --backfill statement.',
      ),
    );
  }
  if (destinationField.nullable) {
    return refuse(
      `the field "${shown}" is optional in the destination contract, so no existing value needs it`,
      `${leaveOut} A --backfill statement fills a required field.`,
    );
  }
  const originNamespace =
    state.originOfRenamedNamespace.get(destination.namespaceId) ?? destination.namespaceId;
  const origin = valueObjectAt(state.origin.contract.storage, {
    plane: 'storage',
    namespaceId: originNamespace,
    entityKind: 'valueObject',
    entityName: name,
  });
  if (origin === undefined) {
    return refuse(
      `the origin contract has no value object "${enumText(state.origin, originNamespace, name)}", so no existing value lacks the field`,
    );
  }
  const originName =
    state.originOfRenamedValueObjectField.get(qualifiedValueObjectField(coordinate))?.field ??
    field;
  const originField = Object.hasOwn(origin.fields, originName)
    ? origin.fields[originName]
    : undefined;
  if (originField !== undefined && !originField.nullable) {
    return refuse(
      `the field "${shown}" is already required in the origin contract, so every existing value has it`,
    );
  }
  state.fieldStatements.add(key);
  return ok({ kind: 'backfill', entity: 'valueObjectField', field: coordinate });
}

/**
 * A convert or backfill statement names a field as the destination contract names it. A convert
 * needs the field in the origin contract, under its origin name when a rename gave it a new one,
 * with another type; a convert with one name, or a two-name convert that reads as
 * `namespace.Variant`, names a variant instead. A backfill needs the field required in the
 * destination contract and, on a model the origin has, either new or optional there; a backfill
 * whose first name is a value object names a field of the value object.
 */
function resolveFieldStatement(
  state: ResolutionState,
  statement: ParsedFieldStatement,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const { verb } = statement;
  const names = statement.field;
  if (names.length === 1) return resolveOneNameConvert(state, statement, names[0]);
  if (verb === 'convert' && names.length === 2) {
    const variant = readNamespaceVariant(state, statement, names[0], names[1]);
    if (variant !== undefined) {
      return variant.ok ? resolveVariantConvert(state, statement, variant.value) : variant;
    }
  }
  const [namespaceId, modelName, field] = names.length === 3 ? names : [undefined, ...names];
  const flag = statementFlag(statement);
  const leaveOut = `Leave out ${flag}.`;
  const refuse = (reason: string, fix: string = leaveOut) =>
    notOk(unresolved(statement, { reason, fix }));
  const destination = lookupModel(state.destination, namespaceId, modelName);
  if (destination.kind !== 'found') {
    if (destination.valueObject !== undefined && verb === 'backfill') {
      return resolveValueObjectFieldBackfill(state, statement, namespaceId, modelName, field);
    }
    if (destination.valueObject !== undefined) {
      return refuse(
        `"${destination.valueObject}" is a value object; a --${verb} statement names a field of a model or a variant`,
      );
    }
    return refuse(
      destination.reason,
      destination.kind === 'missing'
        ? `A --${verb} statement names a field as the destination contract names it, Model.field or namespace.Model.field. Names match exactly, including case.`
        : destination.fix,
    );
  }
  const coordinate: FieldCoordinate = { ...destination.coordinate, field };
  const name = qualifiedField(coordinate);
  const shown = fieldStatementText(state.destination.contract, coordinate);
  if (Object.hasOwn(destination.model.relations, field)) {
    return refuse(`"${shown}" is a relation, which holds no values of its own to ${verb}`);
  }
  const destinationField = Object.hasOwn(destination.model.fields, field)
    ? destination.model.fields[field]
    : undefined;
  if (destinationField === undefined) {
    return refuse(
      `the destination model "${modelStatementText(state.destination.contract, destination.coordinate)}" has no field "${field}" (fields: ${listed(fieldNames(destination.model))})`,
      `A --${verb} statement names the field as the destination contract names it: after --rename User.age:User.years, write --${verb} User.years. Names match exactly, including case.`,
    );
  }
  const key = `${verb}:${name}`;
  if (state.fieldStatements.has(key)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already ${verb}s "${shown}".`,
        `Give each field at most one --${verb} statement.`,
      ),
    );
  }
  if (verb === 'backfill' && destinationField.nullable) {
    return refuse(
      `the field "${shown}" is optional in the destination contract, so no existing row needs a value`,
      `${leaveOut} A --backfill statement fills a required field.`,
    );
  }
  const counterpart = originCounterpart(state, destination.coordinate);
  if (counterpart === undefined) {
    const model = modelStatementText(state.destination.contract, destination.coordinate);
    return refuse(
      `the destination model "${model}" has no counterpart in the origin contract: the origin has no model "${model}" and no rename statement renames a model to it`,
      verb === 'convert'
        ? `If the model was renamed, add --rename <old name>:${model}. A new model has no values to convert, so leave out ${flag}.`
        : `A new model has no existing rows to backfill. ${leaveOut}`,
    );
  }
  const originName = state.originOfRenamedField.get(name)?.field ?? field;
  const originField = Object.hasOwn(counterpart.model.fields, originName)
    ? counterpart.model.fields[originName]
    : undefined;
  if (verb === 'convert') {
    if (originField === undefined) {
      const model = statement.field.slice(0, -1).join('.');
      return refuse(
        `the origin model "${modelStatementText(state.origin.contract, counterpart.coordinate)}" has no field "${field}" (fields: ${listed(fieldNames(counterpart.model))}), and no rename statement renames a field to it`,
        `If the field was renamed, add --rename ${model}.<old name>:${model}.${field}. A new field has no values to convert, so leave out ${flag}.`,
      );
    }
    if (sameType(originField, destinationField)) {
      return refuse(
        `the field "${shown}" has the same type, ${fieldTypeText(destinationField)}, in the origin and destination contracts, so it has no values to convert`,
      );
    }
  } else if (originField !== undefined && !originField.nullable) {
    return refuse(
      `the field "${shown}" is already required in the origin contract, so every existing row has a value`,
    );
  }
  state.fieldStatements.add(key);
  return ok({ kind: verb, entity: 'field', field: coordinate });
}

/** A delete that names what a rename of the same run renames: both cannot happen. */
function deleteOfRenamed(
  deletes: readonly StatementText[],
  renames: readonly ParsedRename[],
): CliStructuredError | undefined {
  for (const deleted of deletes) {
    const renamed = renames.find((rename) => rename.from.join('.') === deleted.text);
    if (renamed === undefined) continue;
    return errorStatementInvalid(
      deleted,
      `--delete ${deleted.text} names what --rename ${renamed.text} renames in the same run, so it cannot also be deleted.`,
      `Leave out --delete ${deleted.text} to keep the data under its new name, or leave out --rename ${renamed.text} to delete it.`,
    );
  }
  return undefined;
}

/**
 * A delete that names what a rename among `statements` renames, which contradict each other: the
 * commands check it before they plan, since they hand the deletes to their questions, not here.
 */
export function renamedAndDeleted(
  statements: readonly StatementText[],
): CliStructuredError | undefined {
  const renames = statements.flatMap((entry) => {
    if (entry.verb !== 'rename') return [];
    const parsed = parseRenameStatement({ ...entry, verb: entry.verb });
    return parsed.ok ? [parsed.value] : [];
  });
  return deleteOfRenamed(
    statements.filter(({ verb }) => verb === 'delete'),
    renames,
  );
}

/**
 * Resolves the statements a user gave against the origin and destination contracts. Renames
 * resolve first, in the order given, so a convert or backfill statement can name a renamed field
 * by its new name wherever it is given; the result keeps the order given. A delete or allow
 * statement is checked and left out: it names what a plan would do to a subject, so it is matched
 * against the plan, and it needs no origin contract.
 */
export function resolveStatements(
  input: ResolveStatementsInput,
): Result<readonly ResolvedMigrationStatement[], CliStructuredError> {
  const renames: { readonly index: number; readonly statement: ParsedRename }[] = [];
  const deletes: StatementText[] = [];
  const fieldStatements: { readonly index: number; readonly statement: ParsedFieldStatement }[] =
    [];
  for (const [index, entry] of input.statements.entries()) {
    if (entry.verb === 'delete' || entry.verb === 'allow') {
      const statement = parseConsentStatement({ ...entry, verb: entry.verb });
      if (!statement.ok) return statement;
      if (entry.verb === 'delete') deletes.push(entry);
      continue;
    }
    if (input.origin.kind === 'missing') {
      return notOk(errorStatementOriginUnknown(input.origin));
    }
    if (entry.verb === 'rename') {
      const statement = parseRenameStatement({ ...entry, verb: entry.verb });
      if (!statement.ok) return statement;
      renames.push({ index, statement: statement.value });
    } else {
      const statement = parseFieldStatement({ ...entry, verb: entry.verb });
      if (!statement.ok) return statement;
      fieldStatements.push({ index, statement: statement.value });
    }
  }
  if (input.origin.kind === 'missing') return ok([]);
  const state: ResolutionState = {
    origin: { name: 'origin', contract: input.origin.contract },
    destination: { name: 'destination', contract: input.destination },
    originOfRenamedModel: new Map(),
    originOfRenamedField: new Map(),
    originOfRenamedValueObjectField: new Map(),
    originOfRenamedNamespace: new Map(),
    renamedFrom: new Set(),
    renamedTo: new Set(),
    fieldStatements: new Set(),
  };
  const resolved: { readonly index: number; readonly statement: ResolvedMigrationStatement }[] = [];
  const parsedRenames = renames.map(({ statement }) => statement);
  const contradicted = deleteOfRenamed(deletes, parsedRenames);
  if (contradicted !== undefined) return notOk(contradicted);
  for (const [position, { index, statement }] of renames.entries()) {
    const result = resolveStatement(state, statement, parsedRenames.slice(position + 1));
    if (!result.ok) return result;
    resolved.push({ index, statement: result.value });
  }
  for (const { index, statement } of fieldStatements) {
    const result = resolveFieldStatement(state, statement);
    if (!result.ok) return result;
    resolved.push({ index, statement: result.value });
  }
  return ok(
    [...resolved].sort((left, right) => left.index - right.index).map(({ statement }) => statement),
  );
}
