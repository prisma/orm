/**
 * Tests for PSL `pg.enum(Ref)` field resolution:
 *
 *  1. A field `pg.enum(<native_enum ref>)` resolves the ref against the
 *     `native_enum` block declared in the same document (and namespace),
 *     lowering to a column `{ codecId: 'pg/enum@1', valueSet ref, nativeType,
 *     no CHECK }` — the production factory chain, no test-side hand-lowering.
 *
 *  2. Negatives: an unresolvable ref, and a ref naming something that is not
 *     a `native_enum` block.
 *
 *  3. Nullable variant (`pg.enum(E)?`).
 */

import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
  postgresAuthoringTypes,
} from '../src/core/authoring';
import { postgresRenderCheckExpressions } from '../src/core/check-expressions';
import { PG_ENUM_CODEC_ID } from '../src/core/codec-ids';
import { pgEnumDescriptor, postgresQualifyColumnType } from '../src/core/codecs';
import type { PostgresSchema } from '../src/core/postgres-schema';
import { postgresCreateNamespace } from '../src/core/postgres-schema';

// Production always resolves `pg.enum(Ref)` through a real `CodecLookup` (the
// CLI/config-loading pipeline supplies `stack.codecLookup`), so this test
// double mirrors that shape. A `pg.enum(Ref)` column resolves through the
// entity-ref type-constructor path, which reaches `pgEnumDescriptor` via
// `codecLookup.descriptorFor` to call its `columnFromEntity` authoring hook —
// without `descriptorFor` below, resolution fails, so it is required, not
// just a production-shape mirror.
const pgEnumCodec = {
  id: PG_ENUM_CODEC_ID,
  descriptor: pgEnumDescriptor,
  encode: () => Promise.reject(new Error('unused')),
  decode: () => Promise.reject(new Error('unused')),
  encodeJson: (value) => value,
  decodeJson: (json) => json,
} as Codec;

const codecLookup: CodecLookup = {
  get: (id) => (id === PG_ENUM_CODEC_ID ? pgEnumCodec : undefined),
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
  descriptorFor: (id) => (id === PG_ENUM_CODEC_ID ? pgEnumDescriptor : undefined),
};

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

const scalarColumnDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string, capabilities: Record<string, Record<string, boolean>> = {}) {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    capabilities,
    target: postgresTarget,
    scalarColumnDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup,
  });
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
  it('lowers to a column with codecId pg/enum@1, a valueSet ref, and the enum typeName as nativeType', () => {
    const result = interpret(aalLevelSource);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const authTable = ns.table['AuthSession'];
    expect(authTable).toBeDefined();
    const aalColumn = authTable?.columns['aal'];
    expect(aalColumn).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'auth.aal_level',
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
      nativeType: 'auth.aal_level',
      nullable: false,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'auth',
        entityName: 'AalLevel',
      },
    });
    expect(aalsColumn?.many).toBe(true);
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
      nativeType: 'aal_level',
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
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_UNKNOWN_ENTITY_REF' })]),
    );
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
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_UNKNOWN_ENTITY_REF' })]),
    );
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
