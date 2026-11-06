import type { ContractWithDomain } from '@internal/contract/types';
import {
  describeMigrationStatement,
  type FieldCoordinate,
  fieldStatementText,
  type MigrationPlannerConflict,
  type ResolvedFieldBackfillStatement,
  type ResolvedFieldConvertStatement,
} from '@internal/framework-components/control';
import {
  type MongoContract,
  ownStoredNameOf,
  validatorDocumentShapesOf,
} from '@internal/mongo-contract';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import {
  documentsMissingOrNull,
  documentsNotOfType,
  unrewritableFieldNameReason,
} from './migration-factories';
import type { PlannedRewrite } from './mongo-rewrite-refusals';
import {
  collectionControlPolicy,
  collectionOf,
  EMBEDDED_MODEL_WHY,
  embeddedModelReason,
  type ModelMatchInput,
  modelAt,
  noCollectionReason,
  originFieldOf,
  originModelOf,
  variantFilter,
} from './mongo-statement-planning';
import type { TypeChange } from './mongo-type-changes';
import { DataTransformCall } from './op-factory-call';

type Document = Record<string, unknown>;

/** A statement a data transform carries out, or the conflict that refuses it. */
export type StatementTransform =
  | {
      readonly kind: 'transform';
      readonly call: DataTransformCall;
      readonly rewrite: PlannedRewrite;
    }
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

/** Why the plan cannot rewrite a field of the destination contract, if it cannot. */
function unrewritableReason(contract: MongoContract, field: FieldCoordinate): string | undefined {
  const model = modelAt(contract, field);
  if (model === undefined || !Object.hasOwn(model.fields, field.field)) return undefined;
  const collection = collectionOf(contract, field);
  if (collection === undefined) return noCollectionReason(field);
  const storedName = ownStoredNameOf(model, field.field);
  const nameReason = unrewritableFieldNameReason(storedName);
  if (nameReason !== undefined) {
    return `its stored name ${JSON.stringify(storedName)} cannot be rewritten: ${nameReason}`;
  }
  const policy = collectionControlPolicy(contract, collection);
  return policy === 'managed'
    ? undefined
    : `collection ${JSON.stringify(collection)} has control policy ${JSON.stringify(policy)}`;
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
  const embedded = embeddedModelReason(contracts.contract, statement.field);
  if (embedded !== undefined) return refuse(statement, embedded, EMBEDDED_MODEL_WHY, contracts);
  const unrewritable = unrewritableReason(contracts.contract, statement.field);
  if (unrewritable !== undefined) {
    return refuse(statement, unrewritable, 'Leave out this statement.', contracts);
  }
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
    rewrite: {
      kind: 'conversion',
      collection: change.collection,
      field: change.field,
      filter: change.filter,
      model: change.destination,
    },
  };
}

/** Whether the origin already had the field and made it required. */
function requiredInOrigin(
  input: BackfillInput,
  collection: string,
  field: FieldCoordinate,
  storedName: string,
): boolean {
  if (input.match === undefined) {
    const declaring = validatorDocumentShapesOf(
      input.schema.collection(collection)?.validator?.jsonSchema,
    ).filter((shape) => Object.hasOwn(shape.properties, storedName));
    return declaring.length > 0 && declaring.every((shape) => shape.required.includes(storedName));
  }
  const origin = originModelOf(field, input.match);
  const model = origin === undefined ? undefined : modelAt(input.match.fromContract, origin);
  const originField = originFieldOf(field, input.match.statements);
  return model !== undefined && Object.hasOwn(model.fields, originField)
    ? model.fields[originField]?.nullable === false
    : false;
}

interface BackfillInput {
  readonly contract: MongoContract;
  /** The schema the plan starts from, with renamed collections under their new names. */
  readonly schema: MongoSchemaIR;
  /** How to find a model or field in the origin contract; `undefined` without one. */
  readonly match: ModelMatchInput | undefined;
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
    fromContract: input.match?.fromContract ?? input.contract,
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
  const embedded = embeddedModelReason(input.contract, statement.field);
  if (embedded !== undefined) return refuse(statement, embedded, EMBEDDED_MODEL_WHY, contracts);
  const unrewritable = unrewritableReason(input.contract, statement.field);
  if (unrewritable !== undefined) {
    return refuse(statement, unrewritable, 'Leave out this statement.', contracts);
  }
  const collection = collectionOf(input.contract, statement.field);
  if (collection === undefined) {
    return refuse(
      statement,
      noCollectionReason(statement.field),
      'Leave out this statement.',
      contracts,
    );
  }
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
  const variant = variantFilter(input.contract, statement.field);
  return {
    kind: 'transform',
    call: new DataTransformCall(
      fieldStatementText(input.contract, statement.field),
      collection,
      withFilter(variant, documentsMissingOrNull(storedName)),
    ),
    rewrite: {
      kind: 'backfill',
      collection,
      field: storedName,
      filter: variant,
      model: statement.field,
    },
  };
}
