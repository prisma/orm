import type { ContractField, ContractWithDomain } from '@internal/contract/types';
import type { TypeLookups } from '@internal/framework-components/codec';
import {
  type FieldCoordinate,
  fieldStatementText,
  type MigrationPlannerConflict,
  type MigrationSubject,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import {
  type MongoContract,
  ownStoredNameOf,
  validatorFieldNamesOf,
} from '@internal/mongo-contract';
import {
  type MongoTemporaryValue,
  temporaryValueOfCodec,
} from '@internal/mongo-contract/data-type';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { unrewritableFieldNameReason } from './migration-factories';
import {
  collectionControlPolicy,
  collectionOf,
  type ModelMatchInput,
  modelAt,
  modelCoordinates,
  originFieldOf,
  originModelOf,
  storedFieldsOf,
  variantFilter,
} from './mongo-statement-planning';
import { FillFieldCall } from './op-factory-call';

const EMPTY_LIST: MongoTemporaryValue = { expression: [], text: '[]' };

/** A new required field the plan fills with a temporary value, where the documents lack it or hold `null`. */
export interface FieldFill {
  readonly call: FillFieldCall;
  /** The field, as the destination contract names it. */
  readonly subject: MigrationSubject;
  readonly text: string;
}

function temporaryValueOf(
  field: ContractField,
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

/** Whether the origin stored the field: in the origin model, or, without an origin contract, in the origin validator. */
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
  return (
    origin === undefined ||
    model === undefined ||
    Object.hasOwn(model.fields, originFieldOf(field, input.match.statements)) ||
    storedFieldsOf(input.match.fromContract, origin).has(storedName)
  );
}

/**
 * Each required field of the destination that is new on a collection the plan keeps, with the
 * temporary value its type declares, unless a `--backfill` statement names it. A field whose type
 * declares none is left to the validator change's document check.
 */
export function planFieldFills(input: FillInput): readonly FieldFill[] {
  return modelCoordinates(input.contract).flatMap((model) => {
    const definition = modelAt(input.contract, model);
    const collection = collectionOf(input.contract, model);
    if (definition === undefined || collection === undefined || definition.owner !== undefined) {
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
        const value = temporaryValueOf(contractField, input.lookups);
        if (value === undefined) return [];
        const filter = variantFilter(input.contract, model);
        return [
          {
            call: new FillFieldCall({
              collection,
              field: storedName,
              value: value.expression,
              ...(filter === undefined ? {} : { filter }),
            }),
            subject: { kind: 'field', ...coordinate },
            text: value.text,
          },
        ];
      });
  });
}

function fieldText(fill: FieldFill, contract: ContractWithDomain): string {
  return fill.subject.kind === 'field'
    ? fieldStatementText(contract, fill.subject)
    : fill.call.options.field;
}

/** A fill under a unique index: every document would get the same value, which the index refuses. */
export function uniqueFillRefusals(
  fills: readonly FieldFill[],
  input: Pick<FillInput, 'contract' | 'destination'>,
): readonly MigrationPlannerConflict[] {
  return fills
    .filter(({ call }) =>
      (input.destination.collection(call.options.collection)?.indexes ?? []).some(
        (index) => index.unique && index.keys.some((key) => key.field === call.options.field),
      ),
    )
    .map((fill) => {
      const field = fieldText(fill, input.contract);
      return {
        kind: 'fieldFillRefused',
        summary: `Cannot fill new required field "${field}" in collection "${fill.call.options.collection}" with a temporary value: a unique index covers it`,
        why: `Every document would get the same value, which the unique index refuses. Plan the change with migration plan and --backfill ${field}, and write a value for each document in migration.ts.`,
      };
    });
}
