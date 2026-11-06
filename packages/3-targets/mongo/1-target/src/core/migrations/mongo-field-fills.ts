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
  otherModelsReached,
  SEPARATE_THE_MODELS,
  sharedCollectionWhy,
  storedFieldsOf,
  TIME_SERIES_UPDATES,
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

/** A fill in a time-series collection, whose documents MongoDB does not let an update change except through the metaField. */
export function timeSeriesFillRefusals(
  fills: readonly FieldFill[],
  schema: MongoSchemaIR,
): readonly MigrationPlannerConflict[] {
  return fills
    .filter(
      ({ call }) => schema.collection(call.options.collection)?.options?.timeseries !== undefined,
    )
    .map(({ call }) => ({
      kind: 'fieldFillRefused',
      summary: `Cannot fill field ${JSON.stringify(call.options.field)} in collection ${JSON.stringify(call.options.collection)}: it is a time-series collection`,
      why: `${TIME_SERIES_UPDATES}, so the field cannot be filled in the documents. Make the field optional in the contract, then run this command again.`,
    }));
}

/**
 * A fill whose documents another model stored in the same collection shares: another root model
 * when the fill has no discriminator filter, or a variant of another root model with the same
 * discriminator field and value. Its documents would get the field too.
 */
export function sharedCollectionFillRefusals(
  fills: readonly FieldFill[],
  contract: ContractWithDomain,
): readonly MigrationPlannerConflict[] {
  return fills.flatMap((fill): MigrationPlannerConflict[] => {
    const { subject, call } = fill;
    if (subject.kind !== 'field') return [];
    const others = otherModelsReached(
      contract,
      subject,
      call.options.collection,
      call.options.filter,
      undefined,
    );
    if (others.length === 0) return [];
    const named = others.map((name) => JSON.stringify(name)).join(', ');
    return [
      {
        kind: 'fieldFillRefused',
        summary: `Cannot fill field ${JSON.stringify(call.options.field)} of model ${JSON.stringify(subject.model)} in collection ${JSON.stringify(call.options.collection)}: model ${named} is stored in the same collection`,
        why: `${sharedCollectionWhy(call.options.collection, others, 'filling the field would add it to the documents')} To fill it in ${JSON.stringify(subject.model)} documents only, ${SEPARATE_THE_MODELS}.`,
      },
    ];
  });
}
