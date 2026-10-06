/**
 * A GIN index over `to_tsvector(...)` reaches the planner as a
 * `PostgresCreateIndex` carrying the access method and the expression
 * verbatim — whether it came from `@@fullTextIndex`, which renders the
 * expression, or from a hand-written `@@index(expression:)`. The SQL bytes are
 * asserted beside the renderer in the adapter package.
 */

import type { Contract } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
} from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { opaqueSql } from '@internal/sql-relational-core/ast';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { PostgresCreateIndex } from '../../src/core/ddl/nodes';
import { postgresTargetDescriptorMeta } from '../../src/core/descriptor-meta';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const TYPED_ATTRIBUTE_SCHEMA = `
model Message {
  id   Int    @id
  text String
  @@fullTextIndex([text], name: "message_text_search")
}
`;

const HAND_WRITTEN_EXPRESSION_SCHEMA = `
model Message {
  id   Int    @id
  text String
  @@index(expression: "to_tsvector('english', \\"text\\")", type: "gin", name: "message_text_search")
}
`;

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      modelAttributes: postgresAuthoringModelAttributes,
      type: {
        Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
        String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } },
      },
    },
  },
]);

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
]);

const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> =
  Object.fromEntries(
    [...scalarTypeDescriptors].map(([name, output]) => [
      name,
      { kind: 'typeConstructor' as const, output },
    ]),
  );

function authoredContract(schema: string): Contract<SqlStorage> {
  const bound = bindPslSchema(schema, {
    sourceId: 'full-text-index-planning.test.psl',
    context: {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...scalarTypeConstructors, ...assembled.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: { ...emptyCodecLookup, descriptorFor: () => undefined },
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypeLookup: postgresDataTypeLookup,
      resolvedInputs: [],
      capabilities: {},
    },
  });
  const result = withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresTargetDescriptorMeta,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('PSL interpretation failed');
  return blindCast<
    Contract<SqlStorage>,
    'the interpreter returns the framework Contract supertype; a Postgres schema is SQL storage'
  >(result.value);
}

/** The table exists with no indexes, so only the index is left to plan. */
function liveSchemaWithoutTheIndex(): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          Message: new PostgresTableSchemaNode({
            name: 'Message',
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              text: { name: 'text', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            rlsEnabled: false,
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

async function plannedCreateIndexNodes(schema: string): Promise<readonly PostgresCreateIndex[]> {
  const lowered: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => ({ sql: 'stub', params: [] }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async (ast) => {
      lowered.push(ast);
      return { sql: 'stub', params: [] };
    },
  };
  const result = createPostgresMigrationPlanner(lowerer).plan({
    contract: authoredContract(schema),
    schema: liveSchemaWithoutTheIndex(),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return [];
  await Promise.all(result.plan.operations);
  return lowered.filter((node) => node instanceof PostgresCreateIndex);
}

describe('a GIN index over to_tsvector, authored in PSL', () => {
  it('plans one CREATE INDEX from @@fullTextIndex', async () => {
    const nodes = await plannedCreateIndexNodes(TYPED_ATTRIBUTE_SCHEMA);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.type).toBe('gin');
    expect(node.elements).toEqual({ expression: opaqueSql(`to_tsvector('english', "text")`) });
    expect(node.table).toBe('Message');
    expect(node.name.startsWith('message_text_search')).toBe(true);
  });

  it('plans the same CREATE INDEX from a hand-written @@index(expression:)', async () => {
    const nodes = await plannedCreateIndexNodes(HAND_WRITTEN_EXPRESSION_SCHEMA);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.type).toBe('gin');
    expect(node.elements).toEqual({ expression: opaqueSql(`to_tsvector('english', "text")`) });
    expect(node.table).toBe('Message');
    expect(node.name.startsWith('message_text_search')).toBe(true);
  });
});
