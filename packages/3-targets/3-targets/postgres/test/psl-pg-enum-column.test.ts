/**
 * Tests for PSL `pg.enum(Ref)` field resolution:
 *
 *  1. A field `pg.enum(<native_enum ref>)` resolves the ref against the
 *     `native_enum` block declared in the same document (and namespace),
 *     lowering to a column `{ codecId: 'pg/enum@1', dataType: 'pg/enum', valueSet ref,
 *     typeParams.typeName, no CHECK }` — the production factory chain, no test-side hand-lowering.
 *
 *  2. Negatives: an unresolvable ref, and a ref naming something that is not
 *     a `native_enum` block.
 *
 *  3. Nullable variant (`pg.enum(E)?`).
 */

import type { Contract } from '@internal/contract/types';
import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import { printPsl } from '@internal/psl-printer';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
  postgresAuthoringTypes,
} from '../src/core/authoring';
import { postgresRenderCheckExpressions } from '../src/core/check-expressions';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import { postgresQualifyColumnType } from '../src/core/codecs';
import type { PostgresSchema } from '../src/core/postgres-schema';
import { postgresCreateNamespace } from '../src/core/postgres-schema';
import { buildPostgresPslContract } from '../src/core/psl-print/psl-contract';
import { testBuildContext } from './psl-print/build-context';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const codecLookup: CodecLookupWithDescriptors = createPostgresBuiltinCodecLookup();

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      type: postgresAuthoringTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
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
  // Native-enum column type names are schema-qualified at construction via the
  // target's `authoring.qualifyColumnType` hook, so this minimal target must
  // carry it (production reads it off the real Postgres pack). `type` is
  // included only so `authoring` shares a property with `AuthoringContributions`
  // (a weak, all-optional type); build-contract reads `qualifyColumnType`.
  // `renderCheckExpressions` is the production renderer, not a stub: without it
  // no column could receive a check under any condition, and the no-CHECK
  // assertion below would hold for the wrong reason.
  authoring: {
    type: postgresAuthoringTypes,
    qualifyColumnType: postgresQualifyColumnType,
    renderCheckExpressions: postgresRenderCheckExpressions,
  },
};

const scalarColumnDescriptors = new Map<string, { codecId: string }>([
  ['String', { codecId: 'pg/text@1' }],
  ['Int', { codecId: 'pg/int4@1' }],
]);

const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> =
  Object.fromEntries(
    [...scalarColumnDescriptors].map(([name, output]) => [
      name,
      { kind: 'typeConstructor' as const, output },
    ]),
  );

function interpret(source: string, capabilities: Record<string, Record<string, boolean>> = {}) {
  const bound = bindPslSchema(source, {
    sourceId: 'psl-pg-enum-column.test.psl',
    context: {
      composedExtensions: [],
      defaultNamespaceId: 'public',
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...scalarTypeConstructors, ...assembled.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup,
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypes: {
        entries: assembled.dataTypes,
        lookup: postgresDataTypeLookup,
        dataTypeOfCodec: () => undefined,
      },
      resolvedInputs: [],
      capabilities,
    },
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

const aalLevelSource = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model AuthSession {
    id  Int @id
    aal pg.enum(AalLevel)
  }
}
`;

describe('PSL pg.enum(Ref) field resolution', () => {
  it('lowers to a column with codecId pg/enum@1, a valueSet ref, and the enum typeName as typeParams.typeName', () => {
    const result = interpret(aalLevelSource);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const authTable = ns.table['AuthSession'];
    expect(authTable).toBeDefined();
    const aalColumn = authTable?.columns['aal'];
    expect(aalColumn).toMatchObject({
      codecId: 'pg/enum@1',
      dataType: 'pg/enum',
      typeParams: { typeName: 'auth.aal_level' },
      nullable: false,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'auth',
        entityName: 'AalLevel',
      },
    });
    // No typeRef and no CHECK-strategy leftovers — a pg.enum column is a
    // plain value-set column, not a named-type-refined one.
    expect(aalColumn?.typeRef).toBeUndefined();
  });

  it('does not write a CHECK constraint for a pg.enum column', () => {
    const result = interpret(aalLevelSource);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const authTable = ns.table['AuthSession'];
    expect(authTable).toBeDefined();
    expect(authTable?.checks ?? []).toEqual([]);
  });

  it('resolves the enum for the value-set derived from the native_enum in the same namespace', () => {
    const result = interpret(aalLevelSource);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const valueSet = ns.valueSet?.['AalLevel'];
    expect(valueSet).toMatchObject({ values: ['aal1', 'aal2', 'aal3'] });
  });

  // Settles the infer-adoption open question: the Phase-1 authoring surface
  // accepts an enum-typed list column (`pg.enum(E)[]`), so `contract infer`
  // emits the list form for `<enum type>[]` columns instead of a diagnostic.
  it('supports a pg.enum(E)[] list field when the target reports the scalarList capability', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    @@map("aal_level")
  }

  model AuthSession {
    id   Int @id
    aals pg.enum(AalLevel)[]
  }
}
`;
    const result = interpret(source, { sql: { scalarList: true } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const aalsColumn = ns.table['AuthSession']?.columns['aals'];
    expect(aalsColumn).toMatchObject({
      codecId: 'pg/enum@1',
      dataType: 'pg/enum',
      nullable: false,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'auth',
        entityName: 'AalLevel',
      },
    });
    expect(aalsColumn?.many).toEqual({ elementNullable: false });
  });

  it('keeps typeParams.typeName on a pg.enum(E)[] domain field, like the single field', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    @@map("aal_level")
  }

  model AuthSession {
    id   Int                 @id
    aal  pg.enum(AalLevel)
    aals pg.enum(AalLevel)[]
  }
}
`;
    const result = interpret(source, { sql: { scalarList: true } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fields = result.value.domain.namespaces['auth']?.models['AuthSession']?.fields;
    const aal = {
      nullable: false,
      many: false,
      type: {
        kind: 'scalar',
        codecId: 'pg/enum@1',
        typeParams: { typeName: 'auth.aal_level' },
      },
    };
    expect({ aal: fields?.['aal'], aals: fields?.['aals'] }).toEqual({
      aal,
      aals: { ...aal, many: { elementNullable: false } },
    });
  });

  it('stores a list of member names written as a default on a pg.enum(E)[] field', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    @@map("aal_level")
  }

  model AuthSession {
    id   Int @id
    aals pg.enum(AalLevel)[] @default(["aal1", "aal2"])
  }
}
`;
    const result = interpret(source, { sql: { scalarList: true } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    expect(ns.table['AuthSession']?.columns['aals']?.default).toEqual({
      kind: 'literal',
      value: ['aal1', 'aal2'],
    });
  });

  it('refuses a list default holding something other than a member name on a pg.enum(E)[] field', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    @@map("aal_level")
  }

  model AuthSession {
    id   Int @id
    aals pg.enum(AalLevel)[] @default(["aal1", 3])
  }
}
`;
    const result = interpret(source, { sql: { scalarList: true } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PSL_VALUE_TYPE_INCOMPATIBLE',
    );
  });

  it('supports a nullable pg.enum(E)? field', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    @@map("aal_level")
  }

  model AuthSession {
    id  Int @id
    aal pg.enum(AalLevel)?
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const aalColumn = ns.table['AuthSession']?.columns['aal'];
    expect(aalColumn?.nullable).toBe(true);
    expect(aalColumn?.valueSet).toEqual({
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: 'auth',
      entityName: 'AalLevel',
    });
  });

  it('resolves a pg.enum ref declared in the public namespace (the default target namespace) with an unqualified nativeType', () => {
    // A top-level (unspecified-namespace) `native_enum` block is never lowered
    // — native enums are schema-scoped and must be declared inside an explicit
    // `namespace { … }` block, same as any other native_enum. `namespace public
    // { … }` is the explicit way to target the default target namespace.
    //
    // `public` is Postgres's default schema — `format_type()` reports the
    // bare type name for a `public`-schema type, so the column `nativeType`
    // must stay bare too (contrast the `auth` namespace case above, which
    // expects the schema-qualified `auth.aal_level`).
    const source = `
namespace public {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    @@map("aal_level")
  }

  model AuthSession {
    id  Int @id
    aal pg.enum(AalLevel)
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.valueSet?.['AalLevel']).toMatchObject({ values: ['aal1', 'aal2'] });
    const aalColumn = ns.table['AuthSession']?.columns['aal'];
    expect(aalColumn).toMatchObject({
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'aal_level' },
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'AalLevel',
      },
    });
  });
});

const crossNamespaceSource = `
namespace auth {
  native_enum OrderStatus {
    pending = "pending"
    shipped = "shipped"
    @@map("order_status")
  }
}

model Order {
  id     Int @id
  status pg.enum(auth.OrderStatus)
}
`;

describe('PSL pg.enum(Ref) across namespaces', () => {
  it('types a top-level column by a native_enum of another namespace, schema-qualified', () => {
    const result = interpret(crossNamespaceSource);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.table['Order']?.columns['status']).toMatchObject({
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'auth.order_status' },
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'auth',
        entityName: 'OrderStatus',
      },
    });
  });

  it('types a column of a namespace by a top-level native_enum named unqualified', () => {
    const result = interpret(`
native_enum OrderStatus {
  pending = "pending"
  @@map("order_status")
}

namespace auth {
  model Order {
    id     Int @id
    status pg.enum(OrderStatus)
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    expect(ns.table['Order']?.columns['status']).toMatchObject({
      typeParams: { typeName: 'order_status' },
      valueSet: { namespaceId: 'public', entityName: 'OrderStatus' },
    });
  });

  it('prints the column back qualified and the enum block once, in its own namespace', () => {
    const result = interpret(crossNamespaceSource);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const printed = printPsl(
      buildPostgresPslContract(
        blindCast<Contract<SqlStorage>, 'the PSL interpreter yields a SQL contract'>(result.value),
        testBuildContext(),
      ),
      { pslBlockDescriptors: assembled.pslBlockDescriptors },
    );

    expect(printed).toBe(
      [
        '// use prisma-8',
        '',
        'namespace auth {',
        '  native_enum OrderStatus {',
        '    pending = "pending"',
        '    shipped = "shipped"',
        '    @@map("order_status")',
        '  }',
        '}',
        '',
        'namespace public {',
        '  model Order {',
        '    id     Int                       @id',
        '    status pg.enum(auth.OrderStatus)',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const reread = interpret(printed);
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(reread.value.storage).toEqual(result.value.storage);
  });
});

describe('PSL pg.enum(Ref) diagnostics', () => {
  it('an unresolvable ref is a diagnostic, not a silent fallback', () => {
    const source = `
namespace auth {
  model AuthSession {
    id  Int @id
    aal pg.enum(NoSuchEnum)
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "NoSuchEnum"' },
    ]);
  });

  it('a ref naming something other than a native_enum block is a diagnostic', () => {
    const source = `
namespace auth {
  model AalLevel {
    id Int @id
  }

  model AuthSession {
    id  Int @id
    aal pg.enum(AalLevel)
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code }) => code)).toEqual(['PSL_UNKNOWN_ENTITY_REF']);
  });

  it('refuses pg.enum(E) on a composite type member, which has no column to store the enum in', () => {
    const source = `
native_enum Level {
  low = "low"
  @@map("level")
}

type Session {
  level pg.enum(Level)
}

model User {
  id Int @id
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "Session.level" is typed by the storage enum "Level", which a composite type member cannot use: a member has no column to store it in. Use a PSL enum instead.',
      },
    ]);
  });

  it('a pg.enum() call with no arguments is a diagnostic', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    @@map("aal_level")
  }

  model AuthSession {
    id  Int @id
    aal pg.enum()
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' })]),
    );
  });
});
