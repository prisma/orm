/**
 * A GIN index over `to_tsvector(...)` reaches the planner as a
 * `PostgresCreateIndex` carrying the access method and the expression —
 * whether it came from `@@fullTextIndex`, whose search document is rendered
 * from the weight groups in its options, or from a hand-written
 * `@@index(expression:)`. The SQL bytes are asserted beside the renderer in
 * the adapter package.
 */

import type { Contract } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
} from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
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
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { postgresRenderDefault } from '../../src/exports/control';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const TYPED_ATTRIBUTE_SCHEMA = `
model Message {
  id   Int    @id
  text String
  @@fullTextIndex([text], name: "message_text_search")
}
`;

const WEIGHTED_SCHEMA = `
model Message {
  id   Int     @id
  text String
  note String?
  @@fullTextIndex([text, note], name: "message_search")
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

function authoredContract(schema: string): Contract<SqlStorage> {
  const { document, sources } = parse(schema, 'full-text-index-planning.test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
  });
  const result = interpretPslDocumentToSqlContract({
    documents: [document],
    symbolTable,
    sources,
    capabilities: {},
    target: postgresTargetDescriptorMeta,
    dataTypeLookup: postgresDataTypeLookup,
    scalarColumnDescriptors: new Map([
      ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
      ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
    ]),
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
  });
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
              note: { name: 'note', nativeType: 'text', nullable: true },
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

describe('a single-field index authored before full-text indexes were stored as data', () => {
  it('is renamed, not rebuilt, when planned from the contract that stored its expression', async () => {
    const previous = blindCast<
      Parameters<typeof contractToPostgresDatabaseSchemaNode>[0],
      'the authored contract targets Postgres'
    >(authoredContract(HAND_WRITTEN_EXPRESSION_SCHEMA));
    const result = createPostgresMigrationPlanner({
      lower: () => ({ sql: 'stub', params: [] }),
      renderColumnDefault: async () => '',
      lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
    }).plan({
      contract: authoredContract(TYPED_ATTRIBUTE_SCHEMA),
      schema: contractToPostgresDatabaseSchemaNode(previous, {
        annotationNamespace: 'pg',
        renderDefault: postgresRenderDefault,
      }),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: previous,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const operations = await Promise.all(result.plan.operations);
    expect(operations.map((operation) => operation.label)).toEqual([
      expect.stringMatching(
        /^Rename index "message_text_search_[0-9a-f]{8}" to "message_text_search_[0-9a-f]{8}"/,
      ),
    ]);
  });
});

describe('a weighted full-text index over a column whose nullability changes', () => {
  it('plans only the column change, because the search document does not depend on nullability', async () => {
    const before = blindCast<
      Parameters<typeof contractToPostgresDatabaseSchemaNode>[0],
      'the authored contract targets Postgres'
    >(authoredContract(WEIGHTED_SCHEMA));
    const after = authoredContract(WEIGHTED_SCHEMA.replace('note String?', 'note String'));
    const result = createPostgresMigrationPlanner({
      lower: () => ({ sql: 'stub', params: [] }),
      renderColumnDefault: async () => '',
      lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
    }).plan({
      contract: after,
      schema: contractToPostgresDatabaseSchemaNode(before, {
        annotationNamespace: 'pg',
        renderDefault: postgresRenderDefault,
      }),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: before,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const operations = await Promise.all(result.plan.operations);
    expect(operations.map((operation) => operation.label)).toEqual([
      expect.stringMatching(/NOT NULL.*"note"|"note".*NOT NULL/),
    ]);

    const expressionOf = (contract: Parameters<typeof contractToPostgresDatabaseSchemaNode>[0]) =>
      contractToPostgresDatabaseSchemaNode(contract, {
        annotationNamespace: 'pg',
        renderDefault: postgresRenderDefault,
      }).namespaces['public']?.tables['Message']?.indexes[0]?.expression;
    expect(expressionOf(blindCast<typeof before, 'a Postgres contract'>(after))).toBe(
      expressionOf(before),
    );
  });
});

describe('a GIN index over to_tsvector, authored in PSL', () => {
  it('plans one CREATE INDEX from @@fullTextIndex', async () => {
    const nodes = await plannedCreateIndexNodes(TYPED_ATTRIBUTE_SCHEMA);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.type).toBe('gin');
    expect(node.elements).toEqual({ expression: `to_tsvector('english', "text")` });
    expect(node.table).toBe('Message');
    expect(node.name.startsWith('message_text_search')).toBe(true);
  });

  it('plans one CREATE INDEX over the weighted search document', async () => {
    const nodes = await plannedCreateIndexNodes(WEIGHTED_SCHEMA);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.type).toBe('gin');
    expect(node.elements).toEqual({
      expression: `(setweight(to_tsvector('english', coalesce("text", '')), 'A') || setweight(to_tsvector('english', coalesce("note", '')), 'B'))`,
    });
    expect(node.name.startsWith('message_search')).toBe(true);
  });

  it('plans the same CREATE INDEX from a hand-written @@index(expression:)', async () => {
    const nodes = await plannedCreateIndexNodes(HAND_WRITTEN_EXPRESSION_SCHEMA);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.type).toBe('gin');
    expect(node.elements).toEqual({ expression: `to_tsvector('english', "text")` });
    expect(node.table).toBe('Message');
    expect(node.name.startsWith('message_text_search')).toBe(true);
  });
});
