import type {
  AuthoringContributions,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarAuthoringTypes,
  postgresTarget,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

const authoringTypes = {
  ...postgresScalarAuthoringTypes,
  VarCharish: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'length', optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Vector: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
    output: {
      codecId: 'pg/vector@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  EnumRef: {
    kind: 'typeConstructor',
    entityRefArg: { index: 0, entityKind: 'native_enum' },
    output: { codecId: 'pg/enum@1' },
  },
} satisfies AuthoringTypeNamespace;

const authoringContributions = {
  entityTypes: {},
  pslBlockDescriptors: {},
  modelAttributes: {},
  type: authoringTypes,
} satisfies AuthoringContributions;

const baseInput = {
  ...fixtureInterpreterTypes,
  target: postgresTarget,
  scalarColumnDescriptors: collectScalarTypeConstructors(authoringTypes),
  authoringContributions,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
} as const;

describe('bare-name sugar (T ≡ T())', () => {
  it('emits identical columns for a bare all-optional-args constructor and its zero-arg call', () => {
    const result = interpretSqlContract(
      `model Doc {
  id Int @id
  bare VarCharish
  called VarCharish()
}
`,
      { ...baseInput },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const columns = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Doc']
      ?.columns;
    expect(columns?.['bare']).toEqual(columns?.['called']);
    expect(columns?.['bare']).toMatchObject({
      codecId: 'sql/varchar@1',
    });
  });

  it('expands a named type with a bare base as one with its zero-arg call', () => {
    const result = interpretSqlContract(
      `types {
  Slug = VarCharish
  SlugCalled = VarCharish()
}

model Doc {
  id Int @id
  slug Slug
  slugCalled SlugCalled
}
`,
      { ...baseInput },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const columns = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Doc']
      ?.columns;
    expect(columns?.['slug']).toEqual(columns?.['slugCalled']);
    expect(columns?.['slug']).toEqual({
      codecId: 'sql/varchar@1',
      dataType: 'pg/varchar',
      nullable: false,
      many: false,
    });
  });

  it('reports a bare required-arg constructor in field position as not called', () => {
    const result = interpretSqlContract(
      `model Doc {
  id Int @id
  v Vector
}
`,
      { ...baseInput },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      {
        code: 'PSL_TYPE_CONSTRUCTOR_NOT_CALLED',
        message:
          'Field "Doc.v" uses type constructor "Vector" without arguments. Write Vector(length).',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 27, line: 3, column: 3 },
          end: { offset: 35, line: 3, column: 11 },
        },
      },
    ]);
  });

  it('reports the unsupported-base diagnostic for a bare required-arg constructor in named-type position', () => {
    const result = interpretSqlContract(
      `types {
  V = Vector
}

model Doc {
  id Int @id
  v V
}
`,
      { ...baseInput },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message: expect.stringContaining('"Vector"'),
        }),
      ]),
    );
  });

  it('reports a bare entity-ref constructor in field position as not called', () => {
    const result = interpretSqlContract(
      `model Doc {
  id Int @id
  level EnumRef
}
`,
      { ...baseInput },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      {
        code: 'PSL_TYPE_CONSTRUCTOR_NOT_CALLED',
        message:
          'Field "Doc.level" uses type constructor "EnumRef" without arguments. Write EnumRef(native_enum).',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 27, line: 3, column: 3 },
          end: { offset: 40, line: 3, column: 16 },
        },
      },
    ]);
  });
});
