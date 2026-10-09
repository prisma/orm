import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { type BoundPslSchema, bindPslSchema } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';
import { postgresDataTypeSupport } from './fixtures/postgres-data-type-support';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      modelAttributes: postgresAuthoringModelAttributes,
    },
  },
]);

const postgresTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
};

const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> = {
  String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1' } },
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1' } },
};

function contextFor(): BoundPslSchema['context'] {
  return {
    composedExtensions: [],
    composedExtensionContracts: new Map(),
    authoringContributions: {
      ...assembled,
      type: { ...scalarTypeConstructors, ...assembled.type },
      attributeSpecs: sqlAttributeSpecs,
    },
    pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
    codecLookup: createPostgresBuiltinCodecLookup(),
    controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
    dataTypes: postgresDataTypeSupport,
    resolvedInputs: [],
    capabilities: { sql: { scalarList: true } },
  };
}

function interpret(text: string) {
  const bound = bindPslSchema(text, {
    sourceId: 'psl-policy-mixin.test.psl',
    context: contextFor(),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresTarget,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

function contractOf(text: string) {
  const result = interpret(text);
  if (!result.ok) {
    throw new Error(
      `The schema did not interpret: ${JSON.stringify(result.failure.diagnostics, null, 2)}`,
    );
  }
  return result.value;
}

const models = [
  '  model Profile {',
  '    id     Int @id',
  '    userId String',
  '',
  '    @@rls',
  '  }',
  '',
  '  model Document {',
  '    id     Int @id',
  '    userId String',
  '',
  '    @@rls',
  '  }',
];

const withMixin = [
  'namespace public {',
  ...models,
  '',
  '  policy_select mixin OwnerRead {',
  '    roles = [authenticated]',
  '    using = sql`"userId"::uuid = auth.uid()`',
  '  }',
  '',
  '  policy_select profile_owner_read {',
  '    target = Profile',
  '    +OwnerRead',
  '  }',
  '',
  '  policy_select document_owner_read {',
  '    target = Document',
  '    +OwnerRead',
  '  }',
  '}',
].join('\n');

const inline = [
  'namespace public {',
  ...models,
  '',
  '  policy_select profile_owner_read {',
  '    target = Profile',
  '    roles = [authenticated]',
  '    using = sql`"userId"::uuid = auth.uid()`',
  '  }',
  '',
  '  policy_select document_owner_read {',
  '    target = Document',
  '    roles = [authenticated]',
  '    using = sql`"userId"::uuid = auth.uid()`',
  '  }',
  '}',
].join('\n');

describe('a policy_select mixin that holds the roles and the predicate of two policies', () => {
  it('gives the contract of the same policies written out in full', () => {
    expect(contractOf(withMixin)).toEqual(contractOf(inline));
  });

  it('gives each policy its own target and the roles and predicate of the mixin', () => {
    const namespace = contractOf(withMixin).storage.namespaces['public'] as PostgresSchema;

    expect(
      Object.values(namespace.policy)
        .map(({ tableName, operation, roles, using }) => ({ tableName, operation, roles, using }))
        .sort((left, right) => left.tableName.localeCompare(right.tableName)),
    ).toEqual([
      {
        tableName: 'Document',
        operation: 'select',
        roles: ['authenticated'],
        using: '"userId"::uuid = auth.uid()',
      },
      {
        tableName: 'Profile',
        operation: 'select',
        roles: ['authenticated'],
        using: '"userId"::uuid = auth.uid()',
      },
    ]);
  });

  it('cannot be included in a policy_update block', () => {
    const result = interpret(
      withMixin.replace(
        '  policy_select document_owner_read {',
        '  policy_update document_owner_read {',
      ),
    );

    expect(
      result.ok ? [] : result.failure.diagnostics.map((diagnostic) => diagnostic.message),
    ).toContain('Mixin "OwnerRead" is for "policy_select" blocks, not "policy_update" blocks');
  });
});
