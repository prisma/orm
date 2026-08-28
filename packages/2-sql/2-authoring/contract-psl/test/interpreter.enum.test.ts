import type { Contract } from '@internal/contract/types';
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
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresEnumInferenceCodecs,
  postgresScalarTypeDescriptors,
  postgresTarget,
  postgresTargetRenderingChecks,
  sqliteEnumInferenceCodecs,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
  testRenderCheckExpressions,
} from './fixtures';

// ---------------------------------------------------------------------------
// Minimal test codecs for enum validation
// ---------------------------------------------------------------------------

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

const int4Codec: Codec = {
  id: 'pg/int4@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'number') throw new Error(`expected number, got ${typeof json}`);
    return json;
  },
};

const pgIntCodec: Codec = { ...int4Codec, id: 'pg/int@1' };
const sqliteTextCodec: Codec = { ...textCodec, id: 'sqlite/text@1' };
const sqliteIntegerCodec: Codec = { ...int4Codec, id: 'sqlite/integer@1' };

const codecsById: Record<string, Codec> = {
  'pg/text@1': textCodec,
  'pg/int4@1': int4Codec,
  'pg/int@1': pgIntCodec,
  'sqlite/text@1': sqliteTextCodec,
  'sqlite/integer@1': sqliteIntegerCodec,
};

const targetTypesById: Record<string, readonly string[]> = {
  'pg/text@1': ['text'],
  'pg/int4@1': ['int4'],
  'pg/int@1': ['int4'],
  'sqlite/text@1': ['text'],
  'sqlite/integer@1': ['integer'],
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
  pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
};

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function interpret(schema: string, overrides?: Partial<InterpretPslDocumentToSqlContractInput>) {
  const contributions = overrides?.authoringContributions ?? authoringContributions;
  const descriptors = contributions.pslBlockDescriptors;
  const document = symbolTableInputFromParseArgs({
    schema,
    sourceId: 'schema.prisma',
    ...(descriptors !== undefined ? { pslBlockDescriptors: descriptors } : {}),
  });
  return interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: builtinControlMutationDefaults,
    authoringContributions: contributions,
    codecLookup: testCodecLookup,
    createNamespace: createTestSqlNamespace,
    enumInferenceCodecs: postgresEnumInferenceCodecs,
    capabilities: { sql: { scalarList: true } },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// PSL ↔ TS parity: enum emits contract equal to TS enumType authoring
// ---------------------------------------------------------------------------

describe('enum PSL ↔ TS parity', () => {
  it('emits domain enum, storage valueSet, field/column valueSet refs, and table check equal to TS enumType authoring', () => {
    const pslResult = interpret(
      `
enum Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
  Urgent = "urgent"
}

model Post {
  id       Int    @id
  priority Priority
}
`,
      { target: postgresTargetRenderingChecks },
    );

    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;

    const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' as const };
    const PriorityHandle = enumType(
      'Priority',
      pgText,
      member('Low', 'low'),
      member('High', 'high'),
      member('Urgent', 'urgent'),
    );

    const sqlFamilyPack = {
      kind: 'family' as const,
      id: 'sql',
      familyId: 'sql' as const,
      version: '0.0.1',
    };
    // Same hook as the PSL side's target fixture: the parity claim is that one
    // emission site serves both surfaces, so both must actually render checks.
    const postgresTargetPack = {
      kind: 'target' as const,
      id: 'postgres',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      version: '0.0.1',
      defaultNamespaceId: 'public',
      authoring: { field: {}, renderCheckExpressions: testRenderCheckExpressions },
    };

    const tsContract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Priority: PriorityHandle },
      createNamespace: createTestSqlNamespace,
      models: {
        Post: model('Post', {
          fields: {
            id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' }).id(),
            priority: field.namedType(PriorityHandle),
          },
        }).sql({ table: 'post' }),
      },
    });

    const pslNs = (pslResult.value.storage as unknown as SqlStorage).namespaces['public'];
    const tsNs = (tsContract.storage as unknown as SqlStorage).namespaces['public'];
    const pslDomainNs = pslResult.value.domain.namespaces['public'];
    const tsDomainNs = (tsContract as unknown as Contract).domain.namespaces['public'];

    expect(pslDomainNs?.enum?.['Priority']).toEqual(tsDomainNs?.enum?.['Priority']);
    expect(pslNs !== undefined ? pslNs.entries.valueSet?.['Priority'] : undefined).toEqual(
      tsNs !== undefined ? tsNs.entries.valueSet?.['Priority'] : undefined,
    );
    expect(pslDomainNs?.models?.['Post']?.fields?.['priority']).toEqual(
      tsDomainNs?.models?.['Post']?.fields?.['priority'],
    );
    // Strict equality on the storage column catches extra properties (e.g. a stray typeRef).
    expect(
      pslNs !== undefined ? pslNs.entries.table?.['post']?.columns?.['priority'] : undefined,
    ).toEqual(tsNs !== undefined ? tsNs.entries.table?.['post']?.columns?.['priority'] : undefined);
    expect(pslNs !== undefined ? pslNs.entries.table?.['post']?.checks : undefined).toEqual(
      tsNs !== undefined ? tsNs.entries.table?.['post']?.checks : undefined,
    );
    // Both authoring paths must produce the same storageHash.
    expect((pslResult.value.storage as unknown as SqlStorage).storageHash).toEqual(
      (tsContract.storage as unknown as SqlStorage).storageHash,
    );
  });

  it('parity holds with a defaulted field: @default(Low) produces the same column as .default(members.Low)', () => {
    const pslResult = interpret(
      `
enum Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
  Urgent = "urgent"
}

model Post {
  id       Int      @id
  priority Priority @default(Low)
}
`,
      { target: postgresTargetRenderingChecks },
    );

    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;

    const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' as const };
    const PriorityHandle = enumType(
      'Priority',
      pgText,
      member('Low', 'low'),
      member('High', 'high'),
      member('Urgent', 'urgent'),
    );

    const sqlFamilyPack = {
      kind: 'family' as const,
      id: 'sql',
      familyId: 'sql' as const,
      version: '0.0.1',
    };
    // Same hook as the PSL side's target fixture: the parity claim is that one
    // emission site serves both surfaces, so both must actually render checks.
    const postgresTargetPack = {
      kind: 'target' as const,
      id: 'postgres',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      version: '0.0.1',
      defaultNamespaceId: 'public',
      authoring: { field: {}, renderCheckExpressions: testRenderCheckExpressions },
    };

    const tsContract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Priority: PriorityHandle },
      createNamespace: createTestSqlNamespace,
      models: {
        Post: model('Post', {
          fields: {
            id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' }).id(),
            priority: field.namedType(PriorityHandle).default(PriorityHandle.members.Low),
          },
        }).sql({ table: 'post' }),
      },
    });

    const pslNs = (pslResult.value.storage as unknown as SqlStorage).namespaces['public'];
    const tsNs = (tsContract.storage as unknown as SqlStorage).namespaces['public'];

    // Storage column must be strictly equal (including the default field).
    expect(pslNs?.entries.table?.['post']?.columns?.['priority']).toEqual(
      tsNs?.entries.table?.['post']?.columns?.['priority'],
    );
    // Both paths must produce the same storageHash.
    expect((pslResult.value.storage as unknown as SqlStorage).storageHash).toEqual(
      (tsContract.storage as unknown as SqlStorage).storageHash,
    );
  });
});

// ---------------------------------------------------------------------------
// Diagnostic tests
// ---------------------------------------------------------------------------

describe('enum diagnostics', () => {
  it('missing @@type with non-inferable members emits PSL_ENUM_CANNOT_INFER_TYPE', () => {
    const result = interpret(`
enum Priority {
  Low = 1.5
}
model Post {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]),
    );
  });

  it('unknown codec id emits diagnostic', () => {
    const result = interpret(`
enum Priority {
  @@type("unknown/codec@1")
  Low = "low"
}
model Post {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]),
    );
  });

  it('non-JSON member rawValue emits diagnostic', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low = notjson
}
model Post {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]),
    );
  });

  it('codec-rejected member value emits diagnostic', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low = 42
}
model Post {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]),
    );
  });

  it('bare member under non-string codec emits diagnostic', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/int4@1")
  Low
}
model Post {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC' }),
      ]),
    );
  });

  it('duplicate member names emits PSL_EXTENSION_DUPLICATE_PARAMETER from the parser', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  Low  = "low2"
}
model Post {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_EXTENSION_DUPLICATE_PARAMETER' }),
      ]),
    );
  });

  it('multi-argument enum defaults are rejected as invalid attribute syntax', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}
model Post {
  id Int @id
  priority Priority @default(Low, High)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' })]),
    );
  });

  it('named-argument enum defaults are rejected as invalid attribute syntax', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low = "low"
}
model Post {
  id Int @id
  priority Priority @default(value: Low)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' })]),
    );
  });

  it('duplicate member values emits diagnostic', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low  = "same"
  High = "same"
}
model Post {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE' }),
      ]),
    );
  });

  it('duplicate enum block names are flagged PSL_DUPLICATE_DECLARATION (first-wins)', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low = "low"
}
enum Priority {
  @@type("pg/text@1")
  High = "high"
}
model Post {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' })]),
    );
  });

  it('namespaced enum emits not-supported diagnostic', () => {
    const result = interpret(`
namespace public {
  enum Priority {
    @@type("pg/text@1")
    Low = "low"
  }
  model Post {
  id Int @id
}
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_ENUM_NAMESPACE_NOT_SUPPORTED' }),
      ]),
    );
  });

  it('missing enum entityType factory emits diagnostic for each enum block', () => {
    const entityTypesWithoutEnum = {};
    const result = interpret(
      `
enum Priority {
  @@type("pg/text@1")
  Low = "low"
}
model Post {
  id Int @id
}
`,
      {
        authoringContributions: {
          entityTypes: entityTypesWithoutEnum,
          field: {},
          type: {},
          pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_ENUM_MISSING_FACTORY' })]),
    );
  });

  it('missing pslBlockDescriptors means enum is treated as unknown top-level block', () => {
    const result = interpret(
      `
enum Priority {
  @@type("pg/text@1")
  Low = "low"
}
model Post {
  id Int @id
}
`,
      {
        authoringContributions: {
          entityTypes: testEnumEntityContributions,
          field: {},
          type: {},
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK' }),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Multiple enums in one document
// ---------------------------------------------------------------------------

describe('enum multiple document', () => {
  it('two domain enums lower correctly side by side', () => {
    const result = interpret(`
enum Role {
  @@type("pg/text@1")
  User  = "user"
  Admin = "admin"
}

enum Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
}

model User {
  id       Int      @id
  role     Role
  priority Priority
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = (result.value.storage as unknown as SqlStorage).namespaces['public'];

    expect(ns?.entries.valueSet?.['Role']).toMatchObject({
      kind: 'valueSet',
      values: ['user', 'admin'],
    });
    expect(ns?.entries.valueSet?.['Priority']).toMatchObject({
      kind: 'valueSet',
      values: ['low', 'high'],
    });
    const domainNs = result.value.domain.namespaces['public'];
    expect(domainNs?.enum?.['Role']).toBeDefined();
    expect(domainNs?.enum?.['Priority']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// @@type inference from members (TML-2915)
// ---------------------------------------------------------------------------

describe.each([
  {
    targetName: 'postgres',
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    enumInferenceCodecs: postgresEnumInferenceCodecs,
  },
  {
    targetName: 'sqlite',
    target: sqliteTarget,
    scalarColumnDescriptors: sqliteScalarColumnDescriptors,
    enumInferenceCodecs: sqliteEnumInferenceCodecs,
  },
])(
  'enum @@type inference ($targetName)',
  ({ target, scalarColumnDescriptors, enumInferenceCodecs }) => {
    const namespaceId = target.defaultNamespaceId;

    it('no @@type, all-bare members infers the target text codec', () => {
      const result = interpret(
        `
enum Role {
  Admin
  User
}
model Post {
  id   Int  @id
  role Role
}
`,
        { target, scalarColumnDescriptors, enumInferenceCodecs },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const domainNs = result.value.domain.namespaces[namespaceId];
      expect(domainNs?.enum?.['Role']).toMatchObject({ codecId: enumInferenceCodecs.text });
      const ns = (result.value.storage as unknown as SqlStorage).namespaces[namespaceId];
      expect(ns?.entries.valueSet?.['Role']).toMatchObject({
        kind: 'valueSet',
        values: ['Admin', 'User'],
      });
    });

    it('no @@type, all-string-value members infers the target text codec', () => {
      const result = interpret(
        `
enum Role {
  Admin = "admin"
  User  = "user"
}
model Post {
  id   Int  @id
  role Role
}
`,
        { target, scalarColumnDescriptors, enumInferenceCodecs },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const domainNs = result.value.domain.namespaces[namespaceId];
      expect(domainNs?.enum?.['Role']).toMatchObject({ codecId: enumInferenceCodecs.text });
      const ns = (result.value.storage as unknown as SqlStorage).namespaces[namespaceId];
      expect(ns?.entries.valueSet?.['Role']).toMatchObject({
        kind: 'valueSet',
        values: ['admin', 'user'],
      });
    });

    it('no @@type, all-integer-value members infers the target int codec', () => {
      const result = interpret(
        `
enum Priority {
  Low  = 1
  High = 2
}
model Post {
  id       Int      @id
  priority Priority
}
`,
        { target, scalarColumnDescriptors, enumInferenceCodecs },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const domainNs = result.value.domain.namespaces[namespaceId];
      expect(domainNs?.enum?.['Priority']).toMatchObject({ codecId: enumInferenceCodecs.int });
      const ns = (result.value.storage as unknown as SqlStorage).namespaces[namespaceId];
      expect(ns?.entries.valueSet?.['Priority']).toMatchObject({
        kind: 'valueSet',
        values: [1, 2],
      });
    });

    it('explicit @@type is unchanged: same codec and diagnostics as before this slice', () => {
      const result = interpret(
        `
enum Priority {
  @@type("${enumInferenceCodecs.text}")
  Low  = "low"
  High = "high"
}
model Post {
  id       Int      @id
  priority Priority
}
`,
        { target, scalarColumnDescriptors, enumInferenceCodecs },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const domainNs = result.value.domain.namespaces[namespaceId];
      expect(domainNs?.enum?.['Priority']).toMatchObject({ codecId: enumInferenceCodecs.text });
    });

    it('no @@type, a mix of string and integer member values cannot be inferred', () => {
      const result = interpret(
        `
enum Mixed {
  Low  = "low"
  High = 2
}
model Post {
  id    Int   @id
  mixed Mixed
}
`,
        { target, scalarColumnDescriptors, enumInferenceCodecs },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_ENUM_CANNOT_INFER_TYPE',
            message: expect.stringMatching(/Mixed/),
          }),
        ]),
      );
      expect(
        result.failure.diagnostics.find((d) => d.code === 'PSL_ENUM_CANNOT_INFER_TYPE')?.message,
      ).toMatch(/@@type/);
    });

    it('no @@type, a float member value cannot be inferred', () => {
      const result = interpret(
        `
enum Priority {
  Low = 1.5
}
model Post {
  id       Int      @id
  priority Priority
}
`,
        { target, scalarColumnDescriptors, enumInferenceCodecs },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]),
      );
    });

    it('no @@type, a boolean member value cannot be inferred', () => {
      const result = interpret(
        `
enum Flag {
  On = true
}
model Post {
  id   Int  @id
  flag Flag
}
`,
        { target, scalarColumnDescriptors, enumInferenceCodecs },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]),
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Non-string codec happy path
// ---------------------------------------------------------------------------

describe('enum non-string codec', () => {
  // The lowering tests below run against the hook-less target fixture, which
  // renders no checks: they pin that int member values survive lowering into
  // the value set, the domain enum, and column defaults. A target that DOES
  // render checks cannot express a numeric membership predicate, so it rejects
  // the same schema outright — pinned first so the two are read together.
  // The guard surfaces as a thrown structured error rather than a
  // span-anchored diagnostic: it fires inside contract building, downstream of
  // interpretation.
  it('an int-backed enum is rejected by a target that renders check predicates', () => {
    expect(() =>
      interpret(
        `
enum Priority {
  @@type("pg/int4@1")
  Low  = 1
  High = 10
}

model Post {
  id       Int @id
  priority Priority
}
`,
        { target: postgresTargetRenderingChecks },
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message: expect.stringContaining('numeric-enum CHECK constraints are not yet supported'),
      }),
    );
  });

  it('integer-backed enum lowers correctly', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/int4@1")
  Low  = 1
  High = 10
}

model Post {
  id       Int @id
  priority Priority
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = (result.value.storage as unknown as SqlStorage).namespaces['public'];
    expect(ns !== undefined ? ns.entries.valueSet?.['Priority'] : undefined).toMatchObject({
      kind: 'valueSet',
      values: [1, 10],
    });
    const domainNs = result.value.domain.namespaces['public'];
    expect(domainNs?.enum?.['Priority']).toMatchObject({
      codecId: 'pg/int4@1',
      members: [
        { name: 'Low', value: 1 },
        { name: 'High', value: 10 },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// enum field defaults: member-name resolution
// ---------------------------------------------------------------------------

describe('enum field defaults: @default(MemberName) lowering', () => {
  it('@default(Low) on an enum field emits "default": "low" on the storage column', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
  Urgent = "urgent"
}

model Post {
  id       Int      @id
  priority Priority @default(Low)
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = (result.value.storage as unknown as SqlStorage).namespaces['public'];
    expect(ns?.entries.table?.['post']?.columns?.['priority']).toMatchObject({
      default: { kind: 'literal', value: 'low' },
    });
  });

  it('@default(High) resolves to "high"', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
}

model Post {
  id       Int      @id
  priority Priority @default(High)
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = (result.value.storage as unknown as SqlStorage).namespaces['public'];
    expect(ns?.entries.table?.['post']?.columns?.['priority']).toMatchObject({
      default: { kind: 'literal', value: 'high' },
    });
  });

  it('@default(Low) on an int-backed enum field emits numeric literal default', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/int4@1")
  Low  = 1
  High = 10
}

model Post {
  id       Int      @id
  priority Priority @default(Low)
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = (result.value.storage as unknown as SqlStorage).namespaces['public'];
    expect(ns?.entries.table?.['post']?.columns?.['priority']).toMatchObject({
      default: { kind: 'literal', value: 1 },
    });
  });

  it('non-member identifier is rejected as invalid attribute syntax', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

model Post {
  id       Int      @id
  priority Priority @default(Critical)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' })]),
    );
  });

  it('quoted raw value @default("low") on an enum field is rejected as invalid attribute syntax', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

model Post {
  id       Int      @id
  priority Priority @default("low")
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' })]),
    );
  });

  it('function default @default(uuid()) on an enum field is rejected as invalid attribute syntax', () => {
    const result = interpret(`
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

model Post {
  id       Int      @id
  priority Priority @default(uuid())
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' })]),
    );
  });

  it('non-enum field with @default is unchanged (a plain text field still lowers correctly)', () => {
    const result = interpret(`
model Post {
  id    Int    @id
  title String @default("draft")
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = (result.value.storage as unknown as SqlStorage).namespaces['public'];
    expect(ns?.entries.table?.['post']?.columns?.['title']).toMatchObject({
      default: { kind: 'literal', value: 'draft' },
    });
  });
});
