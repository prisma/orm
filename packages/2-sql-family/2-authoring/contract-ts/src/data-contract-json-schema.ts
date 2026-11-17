import { isPlainRecord } from '@internal/framework-components/ir';
import { composeSqlEntityKinds } from '@internal/sql-contract/entity-kinds';
import { createSqlContractSchema } from '@internal/sql-contract/validators';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { type Type, type } from 'arktype';

type JsonSchemaObject = Record<string, unknown>;

/**
 * Renders an arktype schema as a JSON schema, dropping constraints JSON
 * schema cannot express (narrow predicates). The result is advisory —
 * editor feedback for `contract.json` files — so losing predicates only
 * makes it more permissive; authoritative validation stays in arktype.
 */
function lossyJsonSchemaOf(schema: Type<unknown>): JsonSchemaObject {
  const rendered = schema.toJsonSchema({
    dialect: null,
    fallback: { default: (ctx) => ctx.base },
  });
  if (!isPlainRecord(rendered)) {
    throw new InternalError('toJsonSchema produced a non-object schema');
  }
  return blindCast<
    JsonSchemaObject,
    'freshly built by toJsonSchema and narrowed to a plain record above; safe to treat as mutable'
  >(rendered);
}

/**
 * Structural mirror of `createNamespaceEntrySchema`: that validator checks
 * entry kinds imperatively in a narrow (which JSON schema cannot express),
 * so this rebuilds the same shape structurally from the same entity-kind
 * descriptors — one optional map per family-default kind. Entry kinds the
 * family does not know (pack-contributed, e.g. an extension's `rls` or
 * `policy` entities) are accepted as generic name→object maps: this static
 * file cannot know pack kinds, and the arktype validator composed with the
 * pack stays authoritative for them.
 */
function structuralNamespaceEntrySchema(
  kinds: ReturnType<typeof composeSqlEntityKinds>,
): Type<unknown> {
  const entriesDef: Record<string, unknown> = {
    '[string]': 'Record<string, Record<string, unknown>>',
  };
  for (const [kind, descriptor] of kinds) {
    entriesDef[`${kind}?`] = type({ '[string]': descriptor.schema });
  }
  return type({
    '+': 'reject',
    id: 'string',
    'kind?': 'string',
    entries: type.raw(entriesDef),
  });
}

function recordAt(parent: JsonSchemaObject, key: string): JsonSchemaObject {
  const value = parent[key];
  if (!isPlainRecord(value)) {
    throw new InternalError(`Expected an object at "${key}" in the generated contract JSON schema`);
  }
  return blindCast<
    JsonSchemaObject,
    'freshly built by toJsonSchema and narrowed to a plain record above; safe to treat as mutable'
  >(value);
}

/**
 * Generates the editor-facing JSON schema for SQL `contract.json` files
 * from the authoritative arktype schemas in `@internal/sql-contract`.
 * Regenerate the checked-in file with `pnpm schemas:generate` in this
 * package; the drift test fails when the file and this output diverge.
 */
export function generateDataContractJsonSchema(): JsonSchemaObject {
  const kinds = composeSqlEntityKinds();
  const contract = lossyJsonSchemaOf(createSqlContractSchema(kinds));

  const properties = recordAt(contract, 'properties');
  const storageNamespaces = recordAt(
    recordAt(recordAt(properties, 'storage'), 'properties'),
    'namespaces',
  );
  storageNamespaces['additionalProperties'] = lossyJsonSchemaOf(
    structuralNamespaceEntrySchema(kinds),
  );

  // Wire-only keys: the validator strips these before structural
  // validation (see validateSqlContractFully), but emitted files carry
  // them and the envelope rejects unknown properties.
  properties['$schema'] = {
    type: 'string',
    description: 'Reference to this JSON schema for IDE validation',
  };
  properties['schemaVersion'] = {
    enum: ['1'],
    description: 'Contract schema version',
  };
  properties['_generated'] = {
    type: 'object',
    description: 'Non-semantic generation metadata (ignored by validation)',
  };

  return {
    $id: 'https://prisma.dev/schemas/data-contract-sql-v1.json',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Prisma 8 Data Contract SQL v1',
    description:
      'Schema for Prisma 8 contract.json files for the SQL family (postgres, mysql, sqlite, etc.). Generated from the arktype schemas in @internal/sql-contract — do not edit by hand; run `pnpm schemas:generate` in @internal/sql-contract-ts.',
    ...contract,
  };
}
