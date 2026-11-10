import type {
  MongoCheckDocumentsMeta,
  MongoMigrationCheck,
} from '@internal/mongo-query-ast/control';
import { MongoExistsExpr, RawAggregateCommand } from '@internal/mongo-query-ast/execution';

type Document = Readonly<Record<string, unknown>>;

/** The plan meta of the raw queries a migration's operations run and check with. */
export const RAW_PLAN_META = { target: 'mongo', storageHash: '', lane: 'mongo-raw' } as const;

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
      meta: { ...RAW_PLAN_META },
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

/**
 * The validator a check `documentsFitValidator` wrote matches against: the one its aggregate excludes
 * with `$nor`.
 */
export function validatorCheckedBy(source: MongoMigrationCheck['source']): Document | undefined {
  if (!('command' in source) || !(source.command instanceof RawAggregateCommand)) return undefined;
  const match: unknown = source.command.pipeline[0]?.['$match'];
  const nor: unknown = isDocument(match) ? match['$nor'] : undefined;
  const [validator]: readonly unknown[] = Array.isArray(nor) ? nor : [];
  return isDocument(validator) ? validator : undefined;
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
