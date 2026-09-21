import type {
  AuthoringContributions,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  documentScopedTypes,
  postgresScalarAuthoringTypes,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

const authoringTypes = {
  ...postgresScalarAuthoringTypes,
  VarCharish: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Defaulted: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: { kind: 'arg', index: 0, default: 191 } },
    },
  },
  Vector: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
    output: {
      codecId: 'pg/vector@1',
      nativeType: 'vector',
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
  field: {},
  pslBlockDescriptors: {},
  modelAttributes: {},
  type: authoringTypes,
} satisfies AuthoringContributions;

const baseInput = {
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Doc {
  id Int @id
  bare VarCharish
  called VarCharish()
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const columns = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Doc']
      ?.columns;
    expect(columns?.['bare']).toEqual(columns?.['called']);
    expect(columns?.['bare']).toMatchObject({
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
    });
  });

  it('applies a defaulted template value in bare form, same as the zero-arg call', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Doc {
  id Int @id
  bare Defaulted
  called Defaulted()
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const columns = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Doc']
      ?.columns;
    expect(columns?.['bare']).toEqual(columns?.['called']);
    expect(columns?.['bare']).toMatchObject({
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: 191 },
    });
  });

  it('emits identical named-type storage for a bare base and its zero-arg call', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Slug = Defaulted
  SlugCalled = Defaulted()
}

model Doc {
  id Int @id
  slug Slug
  slugCalled SlugCalled
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const types = documentScopedTypes(result.value);
    expect(types?.['Slug']).toEqual(types?.['SlugCalled']);
    expect(types?.['Slug']).toEqual({
      kind: 'codec-instance',
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: 191 },
    });
  });

  it('reports the unsupported-type diagnostic for a bare required-arg constructor in field position', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Doc {
  id Int @id
  v Vector
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          message: expect.stringContaining('"Vector"'),
        }),
      ]),
    );
  });

  it('reports the unsupported-base diagnostic for a bare required-arg constructor in named-type position', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  V = Vector
}

model Doc {
  id Int @id
  v V
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });
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

  it('reports the unsupported-type diagnostic for a bare entity-ref constructor in field position', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Doc {
  id Int @id
  level EnumRef
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          message: expect.stringContaining('"EnumRef"'),
        }),
      ]),
    );
  });
});
