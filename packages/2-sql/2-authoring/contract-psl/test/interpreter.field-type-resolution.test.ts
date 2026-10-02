import type {
  AuthoringContributions,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
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
  db: {
    Text: {
      kind: 'typeConstructor',
      output: { codecId: 'pg/text@1', nativeType: 'text' },
    },
  },
} satisfies AuthoringTypeNamespace;

const authoringContributions = {
  entityTypes: {},
  field: {
    db: {
      uuid: {
        kind: 'fieldPreset',
        output: { codecId: 'pg/uuid@1', nativeType: 'uuid', id: true },
      },
    },
  },
  pslBlockDescriptors: {},
  modelAttributes: {},
  type: authoringTypes,
} satisfies AuthoringContributions;

const baseInput = {
  dataTypes: fixtureDataTypeSupport,
  target: postgresTarget,
  scalarColumnDescriptors: collectScalarTypeConstructors(authoringTypes),
  authoringContributions,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
} as const;

function diagnosticsOf(schema: string) {
  const result = interpretSqlContract(schema, baseInput);
  expect(result.ok).toBe(false);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

describe('SQL field types from the binder resolution', () => {
  it('stores a qualified type constructor written without a call when it needs no argument', () => {
    const result = interpretSqlContract(
      `model Doc {
  id Int @id
  body db.Text
}
`,
      baseInput,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Doc']?.columns[
        'body'
      ],
    ).toMatchObject({ codecId: 'pg/text@1', nativeType: 'text' });
  });

  it('resolves a preset and a type constructor that share a namespace', () => {
    const result = interpretSqlContract(
      `model Doc {
  id   db.uuid()
  body db.Text
}
`,
      baseInput,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Doc'];
    expect(table?.columns['id']).toMatchObject({ codecId: 'pg/uuid@1', nativeType: 'uuid' });
    expect(table?.primaryKey).toEqual({ columns: ['id'] });
  });

  it('refuses a call to a named type', () => {
    expect(
      diagnosticsOf(`types {
  Slug = String
}

model Doc {
  id Int @id
  slug Slug(10)
}
`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "Doc.slug" calls "Slug", which is a named type, not a type constructor. Remove the arguments.',
      },
    ]);
  });

  it('refuses a composite type member typed by a model', () => {
    expect(
      diagnosticsOf(`type Address {
  owner User
}

model User {
  id Int @id
}
`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message: 'Field "Address.owner" is typed by the model "User", which is not a column type.',
      },
    ]);
  });

  it('leaves a namespace used as a type to the binder', () => {
    expect(
      diagnosticsOf(`namespace auth {
  model Account {
    id Int @id
  }
}

model Doc {
  id Int @id
  owner auth
}
`),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          '"auth" is a namespace; a type reference must name a model, composite type, enum, or named type',
      },
    ]);
  });

  it('leaves an unknown type name to the binder', () => {
    expect(
      diagnosticsOf(`model Doc {
  id Int @id
  body Missing
}
`),
    ).toEqual([{ code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "Missing"' }]);
  });
});
