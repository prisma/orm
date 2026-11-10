import type {
  AnyMongoMigrationOperation,
  MongoCheckDocumentsMeta,
  MongoMigrationCheck,
  MongoMigrationPlanOperation,
} from '@internal/mongo-query-ast/control';
import { CollModCommand, isMongoDmlOperation } from '@internal/mongo-query-ast/control';
import { MongoExistsExpr, RawAggregateCommand } from '@internal/mongo-query-ast/execution';
import { structuredError } from '@internal/utils/structured-error';

type Document = Readonly<Record<string, unknown>>;

const READ_PLAN_META = { target: 'mongo', storageHash: '', lane: 'mongo-raw' } as const;

function isDocument(value: unknown): value is Document {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A check that no document of `collection` fails `validator`: an aggregate that matches the
 * documents the validator rejects.
 */
export function documentsFitValidator(
  collection: string,
  validator: Document,
): MongoMigrationCheck {
  return {
    description: `every document in ${collection} fits the new validator`,
    source: {
      collection,
      command: new RawAggregateCommand(collection, [
        { $match: { $nor: [validator] } },
        { $limit: 1 },
      ]),
      meta: { ...READ_PLAN_META },
    },
    filter: MongoExistsExpr.exists('_id'),
    expect: 'notExists',
  };
}

/**
 * `schema` at the top of the document and in each root model and variant branch, with each rewritten
 * field optional and allowed to hold any value, and each renamed field optional under its new name
 * and allowed under its old name with the new name's schema, so that a discriminator's `enum` still
 * selects one branch under either name. MongoDB refuses an empty `required`, so one left empty is
 * dropped.
 */
function relaxedSchema(schema: Document, fields: MongoCheckDocumentsMeta): Record<string, unknown> {
  const { required, properties, ...rest } = schema;
  const relaxed: Record<string, unknown> = { ...rest };
  const renamedTo = new Set(Object.values(fields.renamedFields));
  if (Array.isArray(required)) {
    const stillRequired = required.filter(
      (field) => !fields.rewrittenFields.includes(field) && !renamedTo.has(field),
    );
    if (stillRequired.length > 0) relaxed['required'] = stillRequired;
  }
  if (isDocument(properties) || schema['additionalProperties'] === false) {
    const declared: Record<string, unknown> = {
      ...(isDocument(properties) ? properties : {}),
      ...Object.fromEntries(fields.rewrittenFields.map((field) => [field, {}])),
    };
    relaxed['properties'] = {
      ...declared,
      ...Object.fromEntries(
        Object.entries(fields.renamedFields).flatMap(([from, to]) =>
          Object.hasOwn(declared, to) ? [[from, declared[to]]] : [],
        ),
      ),
    };
  }
  for (const branches of ['anyOf', 'oneOf']) {
    const entries = schema[branches];
    if (Array.isArray(entries)) {
      relaxed[branches] = entries.map((entry) =>
        isDocument(entry) ? relaxedSchema(entry, fields) : entry,
      );
    }
  }
  return relaxed;
}

/** The check a `checkDocuments` operation runs: `jsonSchema` with the operation's fields left out. */
export function relaxedDocumentsCheck(
  fields: MongoCheckDocumentsMeta,
  jsonSchema: Document,
): MongoMigrationCheck {
  return documentsFitValidator(fields.collection, {
    $jsonSchema: relaxedSchema(jsonSchema, fields),
  });
}

function validatorJsonSchemaSetBy(
  operation: MongoMigrationPlanOperation,
  collection: string,
): Document | undefined {
  const command = operation.execute.find(
    (step) => step.command instanceof CollModCommand && step.command.collection === collection,
  )?.command;
  const jsonSchema: unknown =
    command instanceof CollModCommand ? command.validator?.['$jsonSchema'] : undefined;
  return isDocument(jsonSchema) ? jsonSchema : undefined;
}

/**
 * The operations of one migration, each `checkDocuments` operation given its check: against the
 * validator the first validator change of its collection after it in the same migration sets. So
 * `migration.ts` holds the validator once, and `ops.json` holds the check itself. A
 * `checkDocuments` with no such validator change after it is refused.
 */
export function resolveDocumentChecks<
  Operation extends AnyMongoMigrationOperation | Promise<AnyMongoMigrationOperation>,
>(operations: readonly Operation[]): readonly (Operation | MongoMigrationPlanOperation)[] {
  return operations.map((operation, index) => {
    if (operation instanceof Promise) return operation;
    const fields = operation.meta?.checkDocuments;
    if (fields === undefined || isMongoDmlOperation(operation)) return operation;
    const jsonSchema = operations
      .slice(index + 1)
      .flatMap((later) =>
        later instanceof Promise || isMongoDmlOperation(later)
          ? []
          : [validatorJsonSchemaSetBy(later, fields.collection)],
      )
      .find((found) => found !== undefined);
    if (jsonSchema === undefined) {
      throw structuredError(
        'MIGRATION.INVALID_OPERATION_ENTRY',
        `checkDocuments on collection ${fields.collection} has no validator change of that collection after it in the same migration.`,
        {
          why: 'The check reads the validator it checks the documents against from the first validator change of its collection after it in the same migration.ts.',
          fix: `Remove the checkDocuments(...) call, or restore the validator change of collection ${fields.collection} after it in migration.ts, then run the file with node.`,
          meta: { operationId: operation.id, collection: fields.collection },
        },
      );
    }
    return { ...operation, precheck: [relaxedDocumentsCheck(fields, jsonSchema)] };
  });
}
