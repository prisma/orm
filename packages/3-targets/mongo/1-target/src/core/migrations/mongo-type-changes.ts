import type { ContractField, ContractWithDomain } from '@internal/contract/types';
import type { TypeLookups } from '@internal/framework-components/codec';
import {
  type FieldCoordinate,
  fieldStatementText,
  type MigrationPlannerConflict,
  type MigrationSubject,
  type ResolvedFieldConvertStatement,
} from '@internal/framework-components/control';
import {
  type MongoContract,
  ownStoredNameOf,
  validatorRootShapesOf,
} from '@internal/mongo-contract';
import { bsonTypesOfCodec } from '@internal/mongo-contract/data-type';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { hasCast, isCastTarget } from './bson-casts';
import { type CastFieldOptions, unrewritableFieldNameReason } from './migration-factories';
import {
  collectionControlPolicy,
  collectionOf,
  destinationFieldOf,
  destinationModelOf,
  type FieldRemovalInput,
  modelAt,
  modelCoordinates,
  variantFilter,
} from './mongo-statement-planning';
import { CastFieldCall } from './op-factory-call';

type Document = Record<string, unknown>;

/** The BSON types a field holds, `null` left out, and whether it is a list of them. No types means any value. */
interface FieldShape {
  readonly types: readonly string[];
  readonly list: boolean;
}

/** A field whose stored values the new type does not take, in the documents a plan keeps. */
export interface TypeChange {
  readonly subject: MigrationSubject;
  /** The field as the destination contract names it, when the origin contract is known. */
  readonly destination: FieldCoordinate | undefined;
  readonly collection: string;
  /** The field's stored name after the plan's renames. */
  readonly field: string;
  readonly from: FieldShape;
  readonly to: FieldShape;
  readonly filter: Document | undefined;
  /** The cast, when `$convert` has one for every old type; `undefined` when only a conversion can change the values. */
  readonly cast: CastFieldCall | undefined;
}

function withoutNull(types: readonly string[]): readonly string[] {
  return types.filter((type) => type !== 'null');
}

function fieldShapeOf(
  field: ContractField | undefined,
  lookups: TypeLookups,
): FieldShape | undefined {
  if (field?.type.kind !== 'scalar' || field.dict === true) return undefined;
  const types = bsonTypesOfCodec(field.type.codecId, lookups);
  return types === undefined
    ? undefined
    : { types: withoutNull(types), list: field.many !== undefined && field.many !== false };
}

function isRecord(value: unknown): value is Document {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bsonTypesOf(schema: Document): readonly string[] {
  const bsonType = schema['bsonType'];
  const types = Array.isArray(bsonType) ? bsonType : bsonType === undefined ? [] : [bsonType];
  return withoutNull(types.filter((type): type is string => typeof type === 'string'));
}

function isObjectSchema(schema: Document): boolean {
  return ['properties', 'oneOf', 'anyOf'].some((keyword) => Object.hasOwn(schema, keyword));
}

/** The shape a validator's property schema gives a field; `undefined` for an object, whose fields are not compared here. */
function propertyShapeOf(schema: unknown): FieldShape | undefined {
  if (!isRecord(schema) || isObjectSchema(schema)) return undefined;
  const types = bsonTypesOf(schema);
  const items = schema['items'];
  if (types.length === 1 && types[0] === 'array' && isRecord(items)) {
    return isObjectSchema(items) ? undefined : { types: bsonTypesOf(items), list: true };
  }
  return { types, list: false };
}

/** Whether a field of shape `to` takes every value a field of shape `from` holds. */
function takesEveryValue(from: FieldShape, to: FieldShape): boolean {
  if (to.types.length === 0 && !to.list) return true;
  if (from.list !== to.list) return false;
  if (to.types.length === 0) return true;
  return from.types.length > 0 && from.types.every((type) => to.types.includes(type));
}

function castOptions(from: FieldShape, to: FieldShape): CastFieldOptions | undefined {
  const [target, ...others] = to.types;
  if (from.list !== to.list || target === undefined || others.length > 0) return undefined;
  if (!isCastTarget(target) || !from.types.every((type) => hasCast(type, target))) {
    return undefined;
  }
  return { from: from.types, to: target, ...(to.list ? { list: true } : {}) };
}

function typeChange(input: Omit<TypeChange, 'cast'>): TypeChange {
  const options = castOptions(input.from, input.to);
  return {
    ...input,
    cast:
      options === undefined
        ? undefined
        : new CastFieldCall(input.collection, input.field, {
            ...options,
            ...(input.filter === undefined ? {} : { filter: input.filter }),
          }),
  };
}

/**
 * Each top-level field of a model or variant, in a collection the plan keeps, whose destination
 * type does not take every value its origin type holds, read from the BSON types of the two codecs.
 */
export function planFieldTypeChanges(
  input: FieldRemovalInput,
  lookups: TypeLookups,
): readonly TypeChange[] {
  return modelCoordinates(input.fromContract).flatMap((origin) => {
    const model = modelAt(input.fromContract, origin);
    if (model === undefined || model.owner !== undefined) return [];
    const destination = destinationModelOf(origin, input);
    const destinationModel =
      destination === undefined ? undefined : modelAt(input.contract, destination);
    if (destination === undefined || destinationModel === undefined) return [];
    const collection = collectionOf(input.contract, destination);
    if (collection === undefined || !input.keptCollections.has(collection)) return [];
    if (collectionControlPolicy(input.contract, collection) !== 'managed') return [];
    return Object.keys(model.fields)
      .sort()
      .flatMap((field): TypeChange[] => {
        const destinationField = destinationFieldOf({ ...origin, field }, input.statements);
        if (!Object.hasOwn(destinationModel.fields, destinationField)) return [];
        const from = fieldShapeOf(model.fields[field], lookups);
        const to = fieldShapeOf(destinationModel.fields[destinationField], lookups);
        const storedName = ownStoredNameOf(destinationModel, destinationField);
        if (from === undefined || to === undefined || takesEveryValue(from, to)) return [];
        if (unrewritableFieldNameReason(storedName) !== undefined) return [];
        return [
          typeChange({
            subject: { kind: 'field', ...origin, field },
            destination: { ...destination, field: destinationField },
            collection,
            field: storedName,
            from,
            to,
            filter: variantFilter(input.contract, destination),
          }),
        ];
      });
  });
}

/**
 * Without an origin contract, each field a root model of both validators declares whose new
 * property schema does not take every value the old one does, named by its storage name.
 */
export function planValidatorTypeChanges(input: {
  readonly origin: MongoSchemaIR;
  readonly destination: MongoSchemaIR;
  readonly contract: MongoContract;
}): readonly TypeChange[] {
  return input.origin.collections.flatMap((originCollection) => {
    if (collectionControlPolicy(input.contract, originCollection.name) !== 'managed') return [];
    const destination = input.destination.collection(originCollection.name);
    if (destination?.validator === undefined || originCollection.validator === undefined) return [];
    const propertiesOf = (jsonSchema: unknown) =>
      validatorRootShapesOf(jsonSchema).flatMap((root) => Object.entries(root.properties));
    const before = new Map(propertiesOf(originCollection.validator.jsonSchema));
    const after = new Map(propertiesOf(destination.validator.jsonSchema));
    return [...before.keys()]
      .filter((field) => after.has(field) && unrewritableFieldNameReason(field) === undefined)
      .sort()
      .flatMap((field): TypeChange[] => {
        const from = propertyShapeOf(before.get(field));
        const to = propertyShapeOf(after.get(field));
        if (from === undefined || to === undefined || takesEveryValue(from, to)) return [];
        return [
          typeChange({
            subject: { kind: 'storage', name: `${originCollection.name}.${field}` },
            destination: undefined,
            collection: originCollection.name,
            field,
            from,
            to,
            filter: undefined,
          }),
        ];
      });
  });
}

function shapeText(shape: FieldShape): string {
  const types = shape.types.length === 0 ? 'any value' : shape.types.join(', ');
  return shape.list ? `list of ${types}` : types;
}

function fieldText(change: TypeChange, contract: ContractWithDomain): string {
  return change.destination === undefined
    ? change.subject.kind === 'storage'
      ? change.subject.name
      : change.field
    : fieldStatementText(contract, change.destination);
}

/** A type change `$convert` has no cast for: only a conversion the user writes keeps the field. */
export function noCastRefusals(
  changes: readonly TypeChange[],
  contract: ContractWithDomain,
): readonly MigrationPlannerConflict[] {
  return changes
    .filter((change) => change.cast === undefined)
    .map((change) => {
      const field = fieldText(change, contract);
      return {
        kind: 'typeChangeRefused',
        summary: `Cannot change the type of field "${field}" in collection "${change.collection}" from ${shapeText(change.from)} to ${shapeText(change.to)}: MongoDB has no cast from ${shapeText(change.from)} to ${shapeText(change.to)}`,
        why:
          change.destination === undefined
            ? 'Its values cannot be cast, so --delete cannot keep the field. Plan the change with migration plan --from <hash of the migration the database is at> and --convert, and write the conversion in migration.ts.'
            : `Its values cannot be cast, so --delete cannot keep the field. Plan the change with migration plan and --convert ${field}, and write the conversion in migration.ts.`,
      };
    });
}

function sameField(a: FieldCoordinate, b: FieldCoordinate): boolean {
  return a.namespaceId === b.namespaceId && a.model === b.model && a.field === b.field;
}

/** The type change a convert statement names, if it names one. */
export function typeChangeConverted(
  statement: ResolvedFieldConvertStatement,
  changes: readonly TypeChange[],
): TypeChange | undefined {
  return changes.find(
    (change) => change.destination !== undefined && sameField(change.destination, statement.field),
  );
}
