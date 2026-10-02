import { emptyCodecLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
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
import type { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';
import { postgresDataTypeSupport } from './fixtures/postgres-data-type-support';

const SOURCE_ID = 'psl-policy-predicates.test.psl';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      modelAttributes: postgresAuthoringModelAttributes,
    },
  },
]);

function interpret(source: string) {
  const bound = bindPslSchema(source, {
    sourceId: SOURCE_ID,
    context: {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: {
          Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
          ...assembled.type,
        },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: { ...emptyCodecLookup, descriptorFor: () => undefined },
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypes: postgresDataTypeSupport,
      resolvedInputs: [],
      capabilities: { sql: { scalarList: true } },
    },
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: {
        kind: 'target',
        familyId: 'sql',
        targetId: 'postgres',
        id: 'postgres',
        version: '0.0.1',
        capabilities: {},
        defaultNamespaceId: 'public',
      },
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

function schemaWith(policy: string): string {
  return `namespace public {
  model profile {
    id       Int @id
    owner_id Int
    @@rls
  }
${policy}
}
`;
}

function onlyPolicy(source: string): PostgresRlsPolicy {
  const result = interpret(source);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const namespace = result.value.storage.namespaces['public'] as PostgresSchema;
  const [policy, ...rest] = Object.values(namespace.policy);
  if (policy === undefined || rest.length > 0) throw new Error('expected exactly one policy');
  return policy;
}

function diagnosticsOf(source: string) {
  const result = interpret(source);
  if (result.ok) throw new Error('expected diagnostics');
  return result.failure.diagnostics;
}

function positionAt(text: string, offset: number) {
  const before = text.slice(0, offset);
  return {
    offset,
    line: before.split('\n').length,
    column: offset - before.lastIndexOf('\n'),
  };
}

function spanAt(text: string, marker: string, needle: string) {
  const start = text.indexOf(needle, text.indexOf(marker));
  return { start: positionAt(text, start), end: positionAt(text, start + needle.length) };
}

describe('policy predicates', () => {
  it('lowers using and withCheck sql literals to their canonical text', () => {
    const policy = onlyPolicy(
      schemaWith(`  policy_update owner_write {
    target    = profile
    roles     = [app_user]
    using     = sql\`owner_id = 1\`
    withCheck = sql\`
      owner_id = 1
        AND EXISTS (SELECT 1 FROM profile WHERE id = owner_id)
    \`
  }`),
    );

    expect({ using: policy.using, withCheck: policy.withCheck }).toEqual({
      using: 'owner_id = 1',
      withCheck: 'owner_id = 1\n  AND EXISTS (SELECT 1 FROM profile WHERE id = owner_id)',
    });
  });

  it('keeps permissive = false', () => {
    const policy = onlyPolicy(
      schemaWith(`  policy_select owner_read {
    target     = profile
    using      = sql\`owner_id = 1\`
    permissive = false
  }`),
    );

    expect({ using: policy.using, permissive: policy.permissive }).toEqual({
      using: 'owner_id = 1',
      permissive: false,
    });
  });

  it.each([
    [
      '"owner_id = 1"',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'sql/expression has no cast from pg/text; write it as sql`owner_id = 1`',
    ],
    [
      "'x'",
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'sql/expression has no cast from pg/text; write it as sql`x`',
    ],
    [
      '42',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'sql/expression has no cast from pg/int2; write sql`...`',
    ],
    [
      'true',
      'PSL_VALUE_TYPE_INCOMPATIBLE',
      'sql/expression has no cast from pg/bool; write sql`...`',
    ],
    [
      'pg.sql`x`',
      'PSL_UNKNOWN_LITERAL_TAG',
      'Unknown literal tag "pg.sql". Known tags: sql, json.',
    ],
  ])('refuses %s in using and withCheck at the value', (value, code, message) => {
    const source = schemaWith(`  policy_update owner_write {
    target    = profile
    using     = ${value}
    withCheck = ${value}
  }`);

    expect(diagnosticsOf(source)).toEqual([
      { code, message, sourceId: SOURCE_ID, span: spanAt(source, 'using', value) },
      { code, message, sourceId: SOURCE_ID, span: spanAt(source, 'withCheck', value) },
    ]);
  });

  it('still reports a predicate the operation does not take as an unknown parameter', () => {
    const source = schemaWith(`  policy_insert owner_insert {
    target = profile
    using  = sql\`owner_id = 1\`
  }`);

    expect(diagnosticsOf(source)).toEqual([
      {
        code: 'PSL_EXTENSION_UNKNOWN_PARAMETER',
        message:
          'Unknown parameter "using" in "policy_insert" block "owner_insert". The block does not declare this parameter.',
        sourceId: SOURCE_ID,
        span: spanAt(source, 'owner_insert', 'using  = sql`owner_id = 1`'),
      },
    ]);
  });
});
