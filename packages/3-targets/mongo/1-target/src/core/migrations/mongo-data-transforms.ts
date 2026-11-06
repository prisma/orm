import type { ContractWithDomain } from '@internal/contract/types';
import {
  describeMigrationStatement,
  type FieldCoordinate,
  fieldStatementText,
  type MigrationPlannerConflict,
  type ModelCoordinate,
  type ResolvedFieldBackfillStatement,
  type ResolvedFieldConvertStatement,
  type ResolvedRenameStatement,
} from '@internal/framework-components/control';
import {
  type MongoContract,
  ownStoredNameOf,
  validatorRootShapesOf,
} from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { documentsMissingOrNull, documentsNotOfType } from './migration-factories';
import { collectionOf, modelAt, variantFilter } from './mongo-statement-planning';
import type { TypeChange } from './mongo-type-changes';
import { DataTransformCall } from './op-factory-call';

type Document = Record<string, unknown>;

/** A statement a data transform carries out, or the conflict that refuses it. */
export type StatementTransform =
  | { readonly kind: 'transform'; readonly call: DataTransformCall }
  | { readonly kind: 'refused'; readonly conflict: MigrationPlannerConflict };

/** A convert or backfill statement of a field, with what the plan does for it. */
export interface PlannedTransform {
  readonly statement: ResolvedFieldConvertStatement | ResolvedFieldBackfillStatement;
  readonly outcome: StatementTransform;
}

function refuse(
  statement: ResolvedFieldConvertStatement | ResolvedFieldBackfillStatement,
  reason: string,
  why: string,
  contracts: { readonly fromContract: ContractWithDomain; readonly contract: MongoContract },
): StatementTransform {
  return {
    kind: 'refused',
    conflict: {
      kind: 'statementRefused',
      summary: `Cannot ${describeMigrationStatement(statement, contracts.fromContract, contracts.contract)}: ${reason}`,
      why,
      refusedStatement: statement,
    },
  };
}

function withFilter(filter: Document | undefined, condition: Document): Document {
  return filter === undefined ? condition : { $and: [filter, condition] };
}

/**
 * The data transform of `--convert`: its check and its run select the documents whose field holds
 * a type the new field does not allow, and the user writes the update.
 */
export function convertTransform(
  statement: ResolvedFieldConvertStatement,
  change: TypeChange | undefined,
  contracts: { readonly fromContract: ContractWithDomain; readonly contract: MongoContract },
): StatementTransform {
  if (change === undefined) {
    return refuse(statement, 'its type does not change', 'Leave out this statement.', contracts);
  }
  const notOfType = documentsNotOfType(change.field, {
    types: change.to.list && !change.from.list ? ['array'] : change.to.types,
    list: change.to.list && change.from.list,
  });
  return {
    kind: 'transform',
    call: new DataTransformCall(
      fieldStatementText(contracts.contract, statement.field),
      change.collection,
      withFilter(change.filter, notOfType),
    ),
  };
}

export function originModelOf(
  model: ModelCoordinate,
  renames: readonly ResolvedRenameStatement[],
): ModelCoordinate {
  const renamed = renames.find(
    (statement) =>
      statement.entity === 'model' &&
      statement.to.namespaceId === model.namespaceId &&
      statement.to.model === model.model,
  );
  return renamed?.entity === 'model' ? renamed.from : model;
}

export function originFieldOf(
  field: FieldCoordinate,
  origin: ModelCoordinate,
  renames: readonly ResolvedRenameStatement[],
): string {
  const renamed = renames.find(
    (statement) =>
      statement.entity === 'field' &&
      statement.to.namespaceId === field.namespaceId &&
      statement.to.model === field.model &&
      statement.to.field === field.field,
  );
  return renamed?.entity === 'field' && renamed.from.model === origin.model
    ? renamed.from.field
    : field.field;
}

/** Whether the origin already had the field and made it required. */
function requiredInOrigin(
  input: BackfillInput,
  collection: string,
  field: FieldCoordinate,
  storedName: string,
): boolean {
  if (input.fromContract === null) {
    return validatorRootShapesOf(input.schema.collection(collection)?.validator?.jsonSchema).some(
      (root) => root.required.includes(storedName),
    );
  }
  const origin = originModelOf(field, input.renames);
  const model = modelAt(input.fromContract, origin);
  const originField = originFieldOf(field, origin, input.renames);
  return model !== undefined && Object.hasOwn(model.fields, originField)
    ? model.fields[originField]?.nullable === false
    : false;
}

interface BackfillInput {
  readonly fromContract: ContractWithDomain | null;
  readonly contract: MongoContract;
  /** The schema the plan starts from, with renamed collections under their new names. */
  readonly schema: MongoSchemaIR;
  readonly renames: readonly ResolvedRenameStatement[];
}

/**
 * The data transform of `--backfill`: a required field that is new on an existing collection, or
 * was optional. Its check and its run select the documents where the field is missing or `null`,
 * and the user writes the update.
 */
export function backfillTransform(
  statement: ResolvedFieldBackfillStatement,
  input: BackfillInput,
): StatementTransform {
  const contracts = {
    fromContract: input.fromContract ?? input.contract,
    contract: input.contract,
  };
  const model = modelAt(input.contract, statement.field);
  const definition = model?.fields[statement.field.field];
  if (model === undefined || definition === undefined) {
    return refuse(
      statement,
      'the destination has no such field',
      'Leave out this statement.',
      contracts,
    );
  }
  if (definition.nullable) {
    return refuse(
      statement,
      'it is optional',
      'Only a required field needs a value in every document. Leave out this statement.',
      contracts,
    );
  }
  const collection = collectionOf(input.contract, statement.field);
  if (input.schema.collection(collection) === undefined) {
    return refuse(
      statement,
      `collection "${collection}" is new, so it has no documents to fill`,
      'Leave out this statement.',
      contracts,
    );
  }
  const storedName = ownStoredNameOf(model, statement.field.field);
  if (requiredInOrigin(input, collection, statement.field, storedName)) {
    return refuse(
      statement,
      'it was already required',
      'Every document already has a value for it. Leave out this statement.',
      contracts,
    );
  }
  return {
    kind: 'transform',
    call: new DataTransformCall(
      fieldStatementText(input.contract, statement.field),
      collection,
      withFilter(
        variantFilter(input.contract, statement.field),
        documentsMissingOrNull(storedName),
      ),
    ),
  };
}
