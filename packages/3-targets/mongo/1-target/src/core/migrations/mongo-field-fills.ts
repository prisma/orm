import type { ContractField, ContractValueObjectField } from '@internal/contract/types';
import type { TypeLookups } from '@internal/framework-components/codec';
import type {
  FieldCoordinate,
  MigrationSubject,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import {
  collectionOfModel,
  embeddingModelOf,
  type MongoContract,
  ownStoredNameOf,
  type SelectedVariant,
  selectedVariantOf,
  validatorFieldNamesOf,
  variantFilter,
} from '@internal/mongo-contract';
import {
  type MongoTemporaryValue,
  temporaryValueOfCodec,
} from '@internal/mongo-contract/data-type';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { unrewritableFieldNameReason } from './migration-factories';
import {
  collectionControlPolicy,
  destinationFieldOf,
  type ModelMatchInput,
  modelAt,
  modelCoordinates,
  originFieldOf,
  originModelOf,
  storedFieldsKeptOf,
} from './mongo-statement-planning';
import { FillFieldCall } from './op-factory-call';

const EMPTY_LIST: MongoTemporaryValue = { expression: [], text: '[]' };

/** A new required field the plan fills with a temporary value, where the documents lack it or hold `null`. */
export interface FieldFill {
  readonly call: FillFieldCall;
  /** The field, as the destination contract names it. */
  readonly subject: MigrationSubject;
  readonly text: string;
  /** The variant whose documents the fill selects; `undefined` for a root model's documents. */
  readonly variant: SelectedVariant | undefined;
}

/** The temporary value of a field's type: an empty list for any list, and for a scalar the one its codec declares. A value object, an enum or a dictionary has none. */
export function temporaryValueOf(
  field: ContractField | ContractValueObjectField,
  lookups: TypeLookups,
): MongoTemporaryValue | undefined {
  if (field.many !== undefined && field.many !== false) return EMPTY_LIST;
  if (field.type.kind !== 'scalar' || field.valueSet !== undefined || field.dict === true) {
    return undefined;
  }
  return temporaryValueOfCodec(field.type.codecId, lookups);
}

interface FillInput {
  readonly contract: MongoContract;
  readonly lookups: TypeLookups;
  /** How to find a model or field in the origin contract; `undefined` without one. */
  readonly match: ModelMatchInput | undefined;
  /** The schema the plan starts from, with renamed collections under their new names. */
  readonly schema: MongoSchemaIR;
  readonly destination: MongoSchemaIR;
  readonly statements: readonly ResolvedMigrationStatement[];
}

function backfilled(statements: readonly ResolvedMigrationStatement[], field: FieldCoordinate) {
  return statements.some(
    (statement) =>
      statement.kind === 'backfill' &&
      statement.entity === 'field' &&
      statement.field.namespaceId === field.namespaceId &&
      statement.field.model === field.model &&
      statement.field.field === field.field,
  );
}

/** Whether the origin stored the field: in the origin model, unless a rename moves the origin's field of that name away, or, without an origin contract, in the origin validator. */
function inOrigin(
  input: FillInput,
  field: FieldCoordinate,
  collection: string,
  storedName: string,
) {
  if (input.match === undefined) {
    const validator = input.schema.collection(collection)?.validator;
    return validator === undefined || validatorFieldNamesOf(validator.jsonSchema).has(storedName);
  }
  const origin = originModelOf(field, input.match);
  const model = origin === undefined ? undefined : modelAt(input.match.fromContract, origin);
  if (origin === undefined || model === undefined) return true;
  const originField = originFieldOf(field, input.match.statements);
  const movedAway =
    destinationFieldOf({ ...origin, field: originField }, input.match.statements) !== field.field;
  return (
    !movedAway &&
    (Object.hasOwn(model.fields, originField) ||
      storedFieldsKeptOf(input.match, origin).has(storedName))
  );
}

/** Whether a unique index covers the field, so that one value in every document would break it. */
function underUniqueIndex(
  destination: MongoSchemaIR,
  collection: string,
  storedName: string,
): boolean {
  return (destination.collection(collection)?.indexes ?? []).some(
    (index) => index.unique && index.keys.some((key) => key.field === storedName),
  );
}

/**
 * Each required field of the destination that is new on a collection the plan keeps, with the
 * temporary value its type declares, unless a `--backfill` statement names it. A field whose type
 * declares none, or that a unique index covers, is left to the validator change's document check.
 */
export function planFieldFills(input: FillInput): readonly FieldFill[] {
  return modelCoordinates(input.contract).flatMap((model) => {
    const definition = modelAt(input.contract, model);
    const collection = collectionOfModel(input.contract.domain, model);
    if (
      definition === undefined ||
      collection === undefined ||
      embeddingModelOf(input.contract.domain, model) !== undefined
    ) {
      return [];
    }
    if (input.schema.collection(collection) === undefined) return [];
    if (collectionControlPolicy(input.contract, collection) !== 'managed') return [];
    return Object.entries(definition.fields)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([field, contractField]): FieldFill[] => {
        const coordinate = { ...model, field };
        const storedName = ownStoredNameOf(definition, field);
        if (contractField.nullable || unrewritableFieldNameReason(storedName) !== undefined) {
          return [];
        }
        if (backfilled(input.statements, coordinate)) return [];
        if (inOrigin(input, coordinate, collection, storedName)) return [];
        if (underUniqueIndex(input.destination, collection, storedName)) return [];
        const value = temporaryValueOf(contractField, input.lookups);
        if (value === undefined) return [];
        const variant = selectedVariantOf(input.contract.domain, model);
        return [
          {
            call: new FillFieldCall({
              collection,
              field: storedName,
              value: value.expression,
              ...(variant === undefined ? {} : { filter: variantFilter(variant) }),
            }),
            subject: { kind: 'field', ...coordinate },
            text: value.text,
            variant,
          },
        ];
      });
  });
}
