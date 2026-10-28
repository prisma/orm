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
  db: {
    Text: {
      kind: 'typeConstructor',
      output: { codecId: 'pg/text@1' },
    },
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
    ).toMatchObject({ codecId: 'pg/text@1', dataType: 'pg/text' });
  });

  it('refuses a call to a type alias', () => {
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
          'Field "Doc.slug" calls "Slug", which is a type alias, not a type constructor. Remove the arguments.',
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
          '"auth" is a namespace; a type reference must name a model, composite type, enum, or type alias',
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

  it('names Unsupported("x") as no Prisma 8 type, at the field type', () => {
    const schema = `model Doc {
  id Int @id
  meta Unsupported("hstore")
}
`;
    const result = interpretSqlContract(schema, baseInput);
    expect(result.ok).toBe(false);
    const typeStart = schema.indexOf('Unsupported');
    expect(
      result.ok
        ? []
        : result.failure.diagnostics.map(({ code, message, span }) => ({
            code,
            message,
            start: span?.start.offset,
          })),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          'Unsupported("hstore") is not a Prisma 8 type. Write the column\'s type with a type constructor, or as Raw(sql`hstore`) when no type constructor names it. If "hstore" comes from a database extension that has a Prisma 8 pack, add the pack to extensions in prisma.config.ts.',
        start: typeStart,
      },
    ]);
  });

  it('refuses a namespaced call in @default as attribute syntax', () => {
    expect(
      diagnosticsOf(`model Doc {
  id Int @id
  stamp DateTime @default(db.now())
}
`),
    ).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message:
          'Expected one of: string | number | boolean | null | autoincrement() | now() | sql`...` | json`...` | list of (string | number | boolean | null | json`...`)',
      },
    ]);
  });
});
