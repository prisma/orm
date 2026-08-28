import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
} from '@internal/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresEnumInferenceCodecs,
  postgresScalarTypeDescriptors,
  postgresTargetRenderingChecks,
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
  testRenderCheckExpressions,
} from './fixtures';

const textCodec: Codec = {
  id: 'pg/text@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const int4Codec: Codec = { ...textCodec, id: 'pg/int4@1' };

const codecsById: Record<string, Codec> = {
  'pg/text@1': textCodec,
  'pg/int4@1': int4Codec,
};

const targetTypesById: Record<string, readonly string[]> = {
  'pg/text@1': ['text'],
  'pg/int4@1': ['int4'],
};

const testCodecLookup: CodecLookup = {
  get(id: string): Codec | undefined {
    return codecsById[id];
  },
  targetTypesFor(id: string): readonly string[] | undefined {
    return targetTypesById[id];
  },
  renderOutputTypeFor: () => undefined,
};

const authoringContributions = {
  entityTypes: testEnumEntityContributions,
  field: {},
  type: {},
  valueObjectStorageType: 'Jsonb',
  pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
};

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function interpret(schema: string) {
  const document = symbolTableInputFromParseArgs({
    schema,
    sourceId: 'schema.prisma',
    pslBlockDescriptors: authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTargetRenderingChecks,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: builtinControlMutationDefaults,
    authoringContributions,
    codecLookup: testCodecLookup,
    createNamespace: createTestSqlNamespace,
    enumInferenceCodecs: postgresEnumInferenceCodecs,
    capabilities: { sql: { scalarList: true } },
  });
}

const ROLE_ENUM_PSL = `
enum Role {
  @@type("pg/text@1")
  User  = "user"
  Admin = "admin"
}
`;

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' as const };
const RoleHandle = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

const sqlFamilyPack = {
  kind: 'family' as const,
  id: 'sql',
  familyId: 'sql' as const,
  version: '0.0.1',
};

const postgresTargetPack = {
  kind: 'target' as const,
  id: 'postgres',
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: { field: {}, renderCheckExpressions: testRenderCheckExpressions },
};

describe('@noCheck PSL ↔ TS parity', () => {
  it('every @noCheck form produces the same contract as the equivalent TS authoring', () => {
    const pslResult = interpret(`${ROLE_ENUM_PSL}
model Post {
  id    Int      @id
  role  Role
  kind  Role     @noCheck
  roles Role[]   @noCheck(membership)
  tags  String[] @noCheck(elementNotNull)
}
`);

    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;

    const tsContract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Role: RoleHandle },
      createNamespace: createTestSqlNamespace,
      models: {
        Post: model('Post', {
          fields: {
            id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' }).id(),
            role: field.namedType(RoleHandle),
            kind: field.namedType(RoleHandle).noCheck(),
            roles: field.namedType(RoleHandle).many().noCheck('membership'),
            tags: field
              .column({ codecId: 'pg/text@1', nativeType: 'text' })
              .many()
              .noCheck('elementNotNull'),
          },
        }).sql({ table: 'post' }),
      },
    });

    const pslNs = (pslResult.value.storage as unknown as SqlStorage).namespaces['public'];
    const tsNs = (tsContract.storage as unknown as SqlStorage).namespaces['public'];
    const pslTable = pslNs !== undefined ? pslNs.entries.table?.['post'] : undefined;
    const tsTable = tsNs !== undefined ? tsNs.entries.table?.['post'] : undefined;

    expect(pslTable?.columns['kind']?.noCheck).toEqual(['membership']);
    expect(pslTable?.columns['roles']?.noCheck).toEqual(['membership']);
    expect(pslTable?.columns['tags']?.noCheck).toEqual(['elementNotNull']);
    expect(pslTable?.columns).toEqual(tsTable?.columns);
    expect(pslTable?.checks).toEqual(tsTable?.checks);
    // Only role's membership check and roles' element-non-null check survive.
    expect(pslTable?.checks?.map((c) => c.prefix)).toEqual([
      'post_role_check',
      'post_roles_elem_not_null',
    ]);
    expect((pslResult.value.storage as unknown as SqlStorage).storageHash).toEqual(
      (tsContract.storage as unknown as SqlStorage).storageHash,
    );
  });

  it('a bare @noCheck on a list domain enum resolves to both kinds in canonical order', () => {
    const pslResult = interpret(`${ROLE_ENUM_PSL}
model Post {
  id    Int    @id
  roles Role[] @noCheck
}
`);

    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;
    const ns = (pslResult.value.storage as unknown as SqlStorage).namespaces['public'];
    const postTable = ns !== undefined ? ns.entries.table?.['post'] : undefined;
    expect(postTable?.columns['roles']?.noCheck).toEqual(['elementNotNull', 'membership']);
    expect(postTable?.checks ?? []).toEqual([]);
  });
});

describe('@noCheck on a non-managed table is tolerated', () => {
  it('an inapplicable kind on an external table builds cleanly', () => {
    const result = interpret(`
model Post {
  id   Int    @id
  name String @noCheck(membership)

  @@control(external)
}
`);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.failure.diagnostics)).toBe(true);
  });

  it('a bare @noCheck on an external table builds cleanly', () => {
    const result = interpret(`
model Post {
  id   Int    @id
  name String @noCheck

  @@control(external)
}
`);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.failure.diagnostics)).toBe(true);
  });

  it('the tolerated form matches the TS equivalent byte-for-byte', () => {
    const pslResult = interpret(`
model Post {
  id   Int    @id
  name String @noCheck(membership)

  @@control(external)
}
`);
    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;

    const tsContract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        Post: model('Post', {
          fields: {
            id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' }).id(),
            name: field.column({ codecId: 'pg/text@1', nativeType: 'text' }).noCheck('membership'),
          },
        }).sql({ table: 'post', control: 'external' }),
      },
    });

    const pslStorage = pslResult.value.storage as unknown as SqlStorage;
    const tsStorage = tsContract.storage as unknown as SqlStorage;
    const pslTable = pslStorage.namespaces['public']?.entries.table?.['post'];
    const tsTable = tsStorage.namespaces['public']?.entries.table?.['post'];
    expect(pslTable).toBeDefined();
    // The flag is dropped on both surfaces, so the tables agree byte-for-byte.
    expect(JSON.stringify(pslTable)).toBe(JSON.stringify(tsTable));
    expect(pslTable?.columns['name']).not.toHaveProperty('noCheck');
    expect(pslStorage.storageHash).toBe(tsStorage.storageHash);
  });
});

describe('@noCheck diagnostics', () => {
  function expectDiagnostic(schema: string, code: string, messagePattern: RegExp): void {
    const result = interpret(schema);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const match = result.failure.diagnostics.find(
      (d) => d.code === code && messagePattern.test(d.message),
    );
    expect(match).toBeDefined();
    expect(match?.span).toBeDefined();
  }

  it('rejects an unknown kind identifier', () => {
    expectDiagnostic(
      `${ROLE_ENUM_PSL}
model Post {
  id   Int  @id
  role Role @noCheck(bogus)
}
`,
      'PSL_INVALID_ATTRIBUTE_SYNTAX',
      /Expected one of: membership \| elementNotNull/,
    );
  });

  it('rejects a duplicated kind', () => {
    expectDiagnostic(
      `${ROLE_ENUM_PSL}
model Post {
  id   Int  @id
  role Role @noCheck(membership, membership)
}
`,
      'PSL_INVALID_ATTRIBUTE_SYNTAX',
      /same kind twice/,
    );
  });

  it('rejects membership on a column with no domain-enum value set, span-anchored', () => {
    expectDiagnostic(
      `${ROLE_ENUM_PSL}
model Post {
  id   Int    @id
  name String @noCheck(membership)
}
`,
      'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      /does not apply/,
    );
  });

  it('rejects elementNotNull on a non-list column, span-anchored', () => {
    expectDiagnostic(
      `${ROLE_ENUM_PSL}
model Post {
  id   Int  @id
  role Role @noCheck(elementNotNull)
}
`,
      'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      /does not apply/,
    );
  });

  it('rejects a bare @noCheck on a column that derives nothing, span-anchored', () => {
    expectDiagnostic(
      `${ROLE_ENUM_PSL}
model Post {
  id   Int    @id
  name String @noCheck
}
`,
      'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      /waives nothing/,
    );
  });

  // A value-object list is one JSONB column, not a scalar list, so it derives
  // no element-non-null check. Waiving one waives nothing — the storage shape
  // decides, not the PSL shape.
  it('rejects @noCheck on a value-object list field, span-anchored', () => {
    expectDiagnostic(
      `type Address {
  street String
}

model Post {
  id        Int       @id
  addresses Address[] @noCheck(elementNotNull)
}
`,
      'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      /does not apply/,
    );
  });
});
