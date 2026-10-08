/**
 * A GIN index over `to_tsvector(...)` reaches the planner as a `PostgresCreateIndex` carrying the access method and the expression — whether it came from `@@fullTextIndex`, whose search document is rendered from the weight groups in its options, or from a hand-written `@@index(expression:)`. A change to the weight groups or language is a different index, which the planner drops and creates again; a change to the name prefix alone is a rename. The SQL bytes are asserted beside the renderer in the adapter package.
 */

import type { Contract } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
  planOriginOf,
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
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-registry';
import { PostgresCreateIndex } from '../../src/core/ddl/nodes';
import { postgresTargetDescriptorMeta } from '../../src/core/descriptor-meta';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { postgresRenderDefault } from '../../src/exports/control';
import { postgresDataTypeSupport } from '../fixtures/postgres-data-type-support';
import { postgresTypeComponents, postgresTypeLookups } from '../postgres-type-lookups';

const postgresCodecLookup = createPostgresBuiltinCodecLookup();

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
  @@index(expression: sql\`to_tsvector('english', "text")\`, type: "gin", name: "message_text_search")
}
`;

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      modelAttributes: postgresAuthoringModelAttributes,
      type: {
        Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1' } },
        String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1' } },
      },
    },
  },
]);

const scalarTypeDescriptors = new Map<string, { codecId: string }>([
  ['Int', { codecId: 'pg/int4@1' }],
  ['String', { codecId: 'pg/text@1' }],
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
      codecLookup: postgresCodecLookup,
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypes: postgresDataTypeSupport,
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
    origin: null,
    statements: [],
    frameworkComponents: postgresTypeComponents,
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
        ...postgresTypeLookups,
      }),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: previous,
      origin: planOriginOf(previous),
      statements: [],
      frameworkComponents: postgresTypeComponents,
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
        ...postgresTypeLookups,
      }),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: before,
      origin: planOriginOf(before),
      statements: [],
      frameworkComponents: postgresTypeComponents,
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
        ...postgresTypeLookups,
      }).namespaces['public']?.tables['Message']?.indexes[0]?.expression;
    expect(expressionOf(blindCast<typeof before, 'a Postgres contract'>(after))).toBe(
      expressionOf(before),
    );
  });
});

async function plannedLabels(beforeSchema: string, afterSchema: string): Promise<string[]> {
  const before = blindCast<
    Parameters<typeof contractToPostgresDatabaseSchemaNode>[0],
    'the authored contract targets Postgres'
  >(authoredContract(beforeSchema));
  const result = createPostgresMigrationPlanner({
    lower: () => ({ sql: 'stub', params: [] }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
  }).plan({
    contract: authoredContract(afterSchema),
    schema: contractToPostgresDatabaseSchemaNode(before, {
      annotationNamespace: 'pg',
      renderDefault: postgresRenderDefault,
      ...postgresTypeLookups,
    }),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: before,
    origin: planOriginOf(before),
    statements: [],
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return [];
  const operations = await Promise.all(result.plan.operations);
  return operations.map((operation) => operation.label);
}

describe('a weighted full-text index whose definition changes', () => {
  const WEIGHTED_ATTRIBUTE = '@@fullTextIndex([text, note], name: "message_search")';

  it.each([
    ['its grouping', '@@fullTextIndex([[text, note]], name: "message_search")'],
    ['the order of its fields', '@@fullTextIndex([note, text], name: "message_search")'],
    ['its language', '@@fullTextIndex([text, note], language: "german", name: "message_search")'],
  ])('is dropped and created again when %s changes', async (_label, attribute) => {
    expect(
      await plannedLabels(WEIGHTED_SCHEMA, WEIGHTED_SCHEMA.replace(WEIGHTED_ATTRIBUTE, attribute)),
    ).toEqual([
      expect.stringMatching(/^Drop index "message_search_[0-9a-f]{8}"/),
      expect.stringMatching(/^Create index "message_search_[0-9a-f]{8}"/),
    ]);
  });

  it('is renamed, keeping its search document, when only its name prefix changes', async () => {
    expect(
      await plannedLabels(
        WEIGHTED_SCHEMA,
        WEIGHTED_SCHEMA.replace(
          WEIGHTED_ATTRIBUTE,
          '@@fullTextIndex([text, note], name: "msg_search")',
        ),
      ),
    ).toEqual([
      expect.stringMatching(
        /^Rename index "message_search_([0-9a-f]{8})" to "msg_search_[0-9a-f]{8}"/,
      ),
    ]);
  });
});

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

  it('plans one CREATE INDEX over the weighted search document', async () => {
    const nodes = await plannedCreateIndexNodes(WEIGHTED_SCHEMA);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.type).toBe('gin');
    expect(node.elements).toEqual({
      expression: opaqueSql(
        `(setweight(to_tsvector('english', coalesce("text", '')), 'A') || setweight(to_tsvector('english', coalesce("note", '')), 'B'))`,
      ),
    });
    expect(node.name.startsWith('message_search')).toBe(true);
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

  it('keeps a full-text index and a hand-written gin index that render the same SQL', async () => {
    const nodes = await plannedCreateIndexNodes(`
model Message {
  id   Int    @id
  text String
  @@fullTextIndex([text], name: "message_text_search")
  @@index(expression: "to_tsvector('english', \\"text\\")", type: "gin", name: "message_text_by_hand")
}
`);
    expect(
      nodes.map((node) => ({
        prefix: node.name.slice(0, node.name.lastIndexOf('_')),
        type: node.type,
        elements: node.elements,
      })),
    ).toEqual([
      {
        prefix: 'message_text_by_hand',
        type: 'gin',
        elements: { expression: opaqueSql(`to_tsvector('english', "text")`) },
      },
      {
        prefix: 'message_text_search',
        type: 'gin',
        elements: { expression: opaqueSql(`to_tsvector('english', "text")`) },
      },
    ]);
  });
});
