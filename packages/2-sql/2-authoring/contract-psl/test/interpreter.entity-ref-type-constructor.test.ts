/**
 * Tests for entity-ref type constructors — the mechanism behind `pg.enum(Ref)`
 * native-enum field typing (see `@internal/target-postgres`'s
 * `postgresAuthoringTypes.pg.enum`).
 *
 * A type constructor whose descriptor declares `entityRefArg` names another
 * document-local entity instead of carrying a literal value. The interpreter
 * resolves the ref generically (via `entityRefArg.entityKind`) and converts
 * the resolved entity to column params by calling `columnFromEntity` on the
 * codec descriptor registered for the constructor's `output.codecId`.
 *
 * This file stays layer-isolated: it registers its own small `native_enum`-
 * and `plain_ref`-shaped PSL blocks, entity types, type constructors, and
 * codec descriptors rather than importing `@internal/target-postgres`
 * (same rationale as `pgvectorAuthoringContributions` in `fixtures.ts` —
 * interpreter unit tests should not depend on a target pack). Real-pack
 * parity for `pg.enum(Ref)` itself lives in
 * `target-postgres/test/psl-pg-enum-column.test.ts`.
 */
import type {
  AuthoringContributions,
  AuthoringEntityTypeFactoryOutput,
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  ParsedPslExtensionBlock,
} from '@internal/framework-components/authoring';
import type {
  AnyCodecDescriptor,
  CodecLookupWithDescriptors,
} from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import {
  buildSymbolTable,
  createBinder,
  createPslDiagnosticCollector,
  EMPTY_DATA_TYPES,
  jsonValue,
  mapBlock,
  typeReferenceNode,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlValueSetDerivingEntityTypeOutput } from '@internal/sql-contract/value-set-derivation-hook';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testSqlTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { resolveFieldTypeDescriptor } from '../src/psl-column-resolution';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import { interpretSqlContract, postgresScalarTypeDescriptors, postgresTarget } from './fixtures';

const NATIVE_ENUM_DISCRIMINATOR = 'test-native-enum';
const PLAIN_REF_DISCRIMINATOR = 'test-plain-ref';

const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  native_enum: {
    kind: 'pslBlock',
    keyword: 'native_enum',
    discriminator: NATIVE_ENUM_DISCRIMINATOR,
    name: { required: true },
    spec: () =>
      mapBlock({
        value: { type: jsonValue(), documentation: 'The explicit member value.' },
        allowBare: true,
      }),
  },
  plain_ref: {
    kind: 'pslBlock',
    keyword: 'plain_ref',
    discriminator: PLAIN_REF_DISCRIMINATOR,
    name: { required: true },
    spec: () =>
      mapBlock({
        value: { type: jsonValue(), documentation: 'The explicit member value.' },
        allowBare: true,
      }),
  },
};

type TestNativeEnum = { readonly typeName: string; readonly members: readonly string[] };
type TestPlainRef = { readonly name: string };

function lowerTestNativeEnum(block: ParsedPslExtensionBlock): TestNativeEnum {
  return { typeName: block.name, members: Object.keys(block.values) };
}

function lowerTestPlainRef(block: ParsedPslExtensionBlock): TestPlainRef {
  return { name: block.name };
}

// Mirrors `nativeEnumEntityTypeOutput` in `@internal/target-postgres`'s
// authoring.ts: `deriveValueSet` is SQL-family surface
// (`SqlValueSetDerivingEntityTypeOutput`), checked separately against the
// intersection of both shapes so the outer `entityTypes` map's own
// `satisfies` check doesn't see it as an excess property.
const nativeEnumEntityTypeOutput = {
  factory: lowerTestNativeEnum,
  deriveValueSet: (entity: TestNativeEnum) => ({
    kind: 'valueSet' as const,
    values: entity.members,
  }),
} satisfies AuthoringEntityTypeFactoryOutput<ParsedPslExtensionBlock, TestNativeEnum> &
  SqlValueSetDerivingEntityTypeOutput;

const entityTypes: AuthoringEntityTypeNamespace = {
  native_enum: {
    kind: 'entity',
    discriminator: NATIVE_ENUM_DISCRIMINATOR,
    output: nativeEnumEntityTypeOutput,
  },
  plain_ref: {
    kind: 'entity',
    discriminator: PLAIN_REF_DISCRIMINATOR,
    output: { factory: lowerTestPlainRef },
  },
};

type EntityRefColumnResult = { readonly typeParams?: Record<string, unknown> };

function makeCodecDescriptor(options: {
  readonly codecId: string;
  readonly dataType?: string;
  readonly columnFromEntity?: (entity: unknown) => EntityRefColumnResult | undefined;
}): AnyCodecDescriptor {
  return {
    codecId: options.codecId,
    dataType: dataTypeId(options.dataType ?? 'demo/fixture'),
    traits: ['equality'],
    paramsSchema: {
      '~standard': { version: 1, vendor: 'test', validate: (input: unknown) => ({ value: input }) },
    },
    isParameterized: true,
    factory: () => () => {
      throw new Error('unused in these tests');
    },
    ...(options.columnFromEntity ? { columnFromEntity: options.columnFromEntity } : {}),
  } as AnyCodecDescriptor;
}

const nativeEnumCodec = makeCodecDescriptor({
  codecId: 'test/native-enum@1',
  dataType: 'pg/enum',
  columnFromEntity: (entity) => {
    const enumEntity = entity as TestNativeEnum;
    return { typeParams: { typeName: enumEntity.typeName } };
  },
});

const plainRefCodec = makeCodecDescriptor({
  codecId: 'test/plain-ref@1',
  columnFromEntity: () => ({}),
});

// No `columnFromEntity` hook — used to exercise the contributor-bug throw.
const brokenCodec = makeCodecDescriptor({ codecId: 'test/broken@1' });

// A `columnFromEntity` hook that always declines the entity — used to
// exercise the "resolves to no entity" fallback after the generic entity
// lookup itself succeeds.
const rejectsCodec = makeCodecDescriptor({
  codecId: 'test/rejects@1',
  columnFromEntity: () => undefined,
});

const codecsById = new Map<string, AnyCodecDescriptor>([
  [nativeEnumCodec.codecId, nativeEnumCodec],
  [plainRefCodec.codecId, plainRefCodec],
  [brokenCodec.codecId, brokenCodec],
  [rejectsCodec.codecId, rejectsCodec],
]);

const codecLookup: CodecLookupWithDescriptors = testSqlTypeLookups(
  {},
  {
    get: () => undefined,
    renderOutputTypeFor: () => undefined,
    descriptorFor: (id) => codecsById.get(id),
  },
).codecLookup;

const type: AuthoringTypeNamespace = {
  pg: {
    enum: {
      kind: 'typeConstructor',
      entityRefArg: { index: 0, entityKind: NATIVE_ENUM_DISCRIMINATOR },
      output: { codecId: nativeEnumCodec.codecId },
    },
    plain: {
      kind: 'typeConstructor',
      entityRefArg: { index: 0, entityKind: PLAIN_REF_DISCRIMINATOR },
      output: { codecId: plainRefCodec.codecId },
    },
    broken: {
      kind: 'typeConstructor',
      entityRefArg: { index: 0, entityKind: NATIVE_ENUM_DISCRIMINATOR },
      output: { codecId: brokenCodec.codecId },
    },
    rejects: {
      kind: 'typeConstructor',
      entityRefArg: { index: 0, entityKind: NATIVE_ENUM_DISCRIMINATOR },
      output: { codecId: rejectsCodec.codecId },
    },
  },
};

const authoringContributions: AuthoringContributions = {
  entityTypes,
  type,
  pslBlockDescriptors,
};

const baseInput = {
  ...fixtureInterpreterTypes,
  target: postgresTarget,
  scalarColumnDescriptors: postgresScalarTypeDescriptors,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
  codecLookup,
} as const;

function interpretWith(schema: string) {
  return interpretSqlContract(schema, {
    ...baseInput,
    authoringContributions,
  });
}

describe('interpretPslDocumentToSqlContract entity-ref type constructors', () => {
  it('resolves a field entity-ref call to a column carrying a namespace-scoped valueSet ref', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
    aal2
    aal3
  }

  model AuthSession {
    id Int @id
    aal pg.enum(AalLevel)
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `typeParams.typeName` stays bare here: schema-qualification
    // (e.g. `auth.aal_level`) is a Postgres-target concern applied when the
    // target builds the namespace (`postgresCreateNamespace`), not something
    // the generic interpreter or its `TestSqlNamespace` double perform. Real
    // Postgres qualification is covered by
    // `target-postgres/test/psl-pg-enum-column.test.ts`.
    expect(result.value.storage).toMatchObject({
      namespaces: {
        docs: {
          entries: {
            table: {
              AuthSession: {
                columns: {
                  aal: {
                    codecId: 'test/native-enum@1',
                    dataType: 'pg/enum',
                    typeParams: { typeName: 'AalLevel' },
                    nullable: false,
                    valueSet: {
                      plane: 'storage',
                      entityKind: 'valueSet',
                      namespaceId: 'docs',
                      entityName: 'AalLevel',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('refuses a field typed by a non-enum block', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal AalLevel
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "AuthSession.aal" is typed by the native_enum "AalLevel", which is not a column type.',
      },
    ]);
  });

  it('does not set a typeRef on an entity-ref-resolved column', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.enum(AalLevel)
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const namespaces = (
      result.value.storage as unknown as {
        namespaces: Record<
          string,
          { entries: { table: Record<string, { columns: Record<string, unknown> }> } }
        >;
      }
    ).namespaces;
    const column = namespaces['docs']?.entries.table['AuthSession']?.columns['aal'];
    expect(column).toMatchObject({ codecId: 'test/native-enum@1' });
    expect((column as { typeRef?: unknown } | undefined)?.typeRef).toBeUndefined();
  });

  it('leaves valueSet unset for an entity-ref resolution whose entity derives no value-set', () => {
    const result = interpretWith(`
namespace docs {
  plain_ref AnyName {
    x
  }

  model Thing {
    id Int @id
    ref pg.plain(AnyName)
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        docs: {
          entries: {
            table: {
              Thing: {
                columns: {
                  ref: { codecId: 'test/plain-ref@1' },
                },
              },
            },
          },
        },
      },
    });
    const namespaces = (
      result.value.storage as unknown as {
        namespaces: Record<
          string,
          { entries: { table: Record<string, { columns: Record<string, unknown> }> } }
        >;
      }
    ).namespaces;
    const column = namespaces['docs']?.entries.table['Thing']?.columns['ref'];
    expect((column as { valueSet?: unknown } | undefined)?.valueSet).toBeUndefined();
  });

  it('leaves an unknown name to the diagnostic the binder reported', () => {
    const result = interpretWith(`
namespace docs {
  model AuthSession {
    id Int @id
    aal pg.enum(NoSuchEnum)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "NoSuchEnum"' },
    ]);
  });

  it('adds no diagnostic for a block of the expected kind that was not lowered', () => {
    const result = interpretWith(`
namespace public {
  native_enum AalLevel {
    aal1
  }
}

native_enum AalLevel {
  aal2
}

model AuthSession {
  id Int @id
  aal pg.enum(AalLevel)
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code }) => code)).toEqual([
      'PSL_DUPLICATE_EXTENSION_ENTITY',
      'PSL_DUPLICATE_EXTENSION_ENTITY',
    ]);
  });

  it('refuses a name that resolves to a model, saying what it names and what is expected', () => {
    const result = interpretWith(`
namespace docs {
  model AalLevel {
    id Int @id
  }

  model AuthSession {
    id Int @id
    aal pg.enum(AalLevel)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNKNOWN_ENTITY_REF',
        message:
          'Field "AuthSession.aal" type constructor "pg.enum(AalLevel)" names the model "AalLevel"; it expects a test-native-enum.',
      },
    ]);
  });

  it('refuses a name that resolves to a block of another kind', () => {
    const result = interpretWith(`
namespace docs {
  plain_ref Other {
    a
  }

  model AuthSession {
    id Int @id
    aal pg.enum(Other)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNKNOWN_ENTITY_REF',
        message:
          'Field "AuthSession.aal" type constructor "pg.enum(Other)" names the plain_ref "Other"; it expects a test-native-enum.',
      },
    ]);
  });

  it('refuses a name that resolves to a namespace', () => {
    const result = interpretWith(`
namespace docs {
  model AuthSession {
    id Int @id
    aal pg.enum(docs)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNKNOWN_ENTITY_REF',
        message:
          'Field "AuthSession.aal" type constructor "pg.enum(docs)" names the namespace "docs"; it expects a test-native-enum.',
      },
    ]);
  });

  it('refuses a string argument as not naming an entity', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.enum("AalLevel")
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Field "AuthSession.aal" type constructor "pg.enum" expects exactly one positional argument naming the referenced entity',
      },
    ]);
  });

  it('refuses a number argument as not naming an entity', () => {
    const result = interpretWith(`
namespace docs {
  model AuthSession {
    id Int @id
    aal pg.enum(1)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Field "AuthSession.aal" type constructor "pg.enum" expects exactly one positional argument naming the referenced entity',
      },
    ]);
  });

  it('refuses a top-level entity named from a model of another namespace, naming both namespaces', () => {
    const result = interpretWith(`
native_enum AalLevel {
  aal1
}

namespace docs {
  model AuthSession {
    id Int @id
    aal pg.enum(AalLevel)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNKNOWN_ENTITY_REF',
        message:
          'Field "AuthSession.aal" type constructor "pg.enum(AalLevel)" names the native_enum "AalLevel" of namespace "public"; in this version it can only name a test-native-enum of namespace "docs".',
      },
    ]);
  });

  it('refuses a qualified entity named from a model outside its namespace', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }
}

model AuthSession {
  id Int @id
  aal pg.enum(docs.AalLevel)
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNKNOWN_ENTITY_REF',
        message:
          'Field "AuthSession.aal" type constructor "pg.enum(docs.AalLevel)" names the native_enum "AalLevel" of namespace "docs"; in this version it can only name a test-native-enum of namespace "public".',
      },
    ]);
  });

  it('resolves a qualified entity named from a model inside its namespace', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.enum(docs.AalLevel)
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        docs: {
          entries: {
            table: {
              AuthSession: {
                columns: {
                  aal: {
                    typeParams: { typeName: 'AalLevel' },
                    valueSet: { namespaceId: 'docs', entityName: 'AalLevel' },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('resolves a top-level entity from a model in the block of the default namespace', () => {
    const result = interpretWith(`
native_enum AalLevel {
  aal1
}

namespace public {
  model AuthSession {
    id Int @id
    aal pg.enum(AalLevel)
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              AuthSession: {
                columns: { aal: { valueSet: { namespaceId: 'public', entityName: 'AalLevel' } } },
              },
            },
          },
        },
      },
    });
  });

  it('does not find an entity of the default-namespace block from a top-level model when it is written unqualified', () => {
    const result = interpretWith(`
namespace public {
  native_enum AalLevel {
    aal1
  }
}

model AuthSession {
  id Int @id
  aal pg.enum(AalLevel)
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "AalLevel"' },
    ]);
  });

  it('resolves an entity of the default-namespace block from a top-level model when it is qualified', () => {
    const result = interpretWith(`
namespace public {
  native_enum AalLevel {
    aal1
  }
}

model AuthSession {
  id Int @id
  aal pg.enum(public.AalLevel)
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              AuthSession: {
                columns: { aal: { valueSet: { namespaceId: 'public', entityName: 'AalLevel' } } },
              },
            },
          },
        },
      },
    });
  });

  it('rejects an entity-ref call with no arguments', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.enum()
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' })]),
    );
  });

  it('rejects an entity-ref call with more than one positional argument', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.enum(AalLevel, Extra)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' })]),
    );
  });

  it('rejects an entity-ref resolution whose codec rejects the resolved entity', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.rejects(AalLevel)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_UNKNOWN_ENTITY_REF' })]),
    );
  });

  it('throws when the registered codec descriptor has no columnFromEntity hook', () => {
    expect(() =>
      interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.broken(AalLevel)
  }
}
`),
    ).toThrow(/no "columnFromEntity" authoring hook/);
  });

  it('missing columnFromEntity hook error carries CONTRACT.PACK_CONTRIBUTION_INVALID', () => {
    expect(() =>
      interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.broken(AalLevel)
  }
}
`),
    ).toThrowError(
      expect.objectContaining({ code: 'CONTRACT.PACK_CONTRIBUTION_INVALID' }) as unknown as Error,
    );
  });

  it('rejects a value-set-typed entity-ref resolution when the field has no resolvable namespace', () => {
    const { document, sources } = parse(
      `
native_enum AalLevel {
  aal1
}

model AuthSession {
  id Int @id
  aal pg.enum(AalLevel)
}
`,
      'schema.prisma',
    );
    const { symbolTable } = buildSymbolTable({ documents: [document], sources });
    const { binder } = createBinder({
      symbolTable,
      sources,
      context: {
        authoringContributions: {
          type,
          field: {},
          entityTypes,
          attributeSpecs: { model: {}, field: {} },
          modelAttributes: {},
          pslBlockDescriptors,
          dataTypes: {},
        },
        controlMutationDefaults: { defaultFunctionRegistry: new Map() },
        dataTypes: EMPTY_DATA_TYPES,
      },
    });
    const field = symbolTable.topLevel.models['AuthSession']?.fields['aal'];
    const block = symbolTable.topLevel.blocks['AalLevel'];
    const typeNode = field === undefined ? undefined : typeReferenceNode(field);
    expect(field).toBeDefined();
    expect(block).toBeDefined();
    if (!field || !block || !typeNode) return;

    const diagnostics = createPslDiagnosticCollector(sources);
    const result = resolveFieldTypeDescriptor({
      field,
      resolution: binder.symbolForNode(typeNode),
      enumTypeDescriptors: new Map(),
      namedTypeDescriptors: new Map(),
      diagnostics,
      sources,
      entityLabel: 'Field "AuthSession.aal"',
      binder,
      constructorEntities: new Map([
        [
          block,
          {
            entityKind: NATIVE_ENUM_DISCRIMINATOR,
            lowered: {
              entity: { typeName: 'AalLevel', members: ['aal1'] },
              entityKind: NATIVE_ENUM_DISCRIMINATOR,
              namespaceId: 'public',
              name: 'AalLevel',
              derivesValueSet: true,
            },
          },
        ],
      ]),
      codecLookup,
    });

    expect(result.ok).toBe(false);
    expect(diagnostics.toExternal()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('no resolvable namespace'),
        }),
      ]),
    );
  });
});
