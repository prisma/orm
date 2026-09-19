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
  PslExtensionBlock,
} from '@internal/framework-components/authoring';
import type { AnyCodecDescriptor, CodecLookup } from '@internal/framework-components/codec';
import { buildSymbolTable, createPslDiagnosticCollector } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlValueSetDerivingEntityTypeOutput } from '@internal/sql-contract/value-set-derivation-hook';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { resolveFieldTypeDescriptor } from '../src/psl-column-resolution';
import {
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const NATIVE_ENUM_DISCRIMINATOR = 'test-native-enum';
const PLAIN_REF_DISCRIMINATOR = 'test-plain-ref';

const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  native_enum: {
    kind: 'pslBlock',
    keyword: 'native_enum',
    discriminator: NATIVE_ENUM_DISCRIMINATOR,
    name: { required: true },
    parameters: {},
    variadicParameters: true,
  },
  plain_ref: {
    kind: 'pslBlock',
    keyword: 'plain_ref',
    discriminator: PLAIN_REF_DISCRIMINATOR,
    name: { required: true },
    parameters: {},
    variadicParameters: true,
  },
};

type TestNativeEnum = { readonly typeName: string; readonly members: readonly string[] };
type TestPlainRef = { readonly name: string };

function lowerTestNativeEnum(block: PslExtensionBlock): TestNativeEnum {
  return { typeName: block.name, members: Object.keys(block.parameters) };
}

function lowerTestPlainRef(block: PslExtensionBlock): TestPlainRef {
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
} satisfies AuthoringEntityTypeFactoryOutput<PslExtensionBlock, TestNativeEnum> &
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

type EntityRefColumnResult = { readonly typeParams?: Record<string, unknown> } & {
  readonly nativeType: string;
};

function makeCodecDescriptor(options: {
  readonly codecId: string;
  readonly columnFromEntity?: (entity: unknown) => EntityRefColumnResult | undefined;
}): AnyCodecDescriptor {
  return {
    codecId: options.codecId,
    traits: ['equality'],
    targetTypes: ['text'],
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
  columnFromEntity: (entity) => {
    const enumEntity = entity as TestNativeEnum;
    return { typeParams: { typeName: enumEntity.typeName }, nativeType: enumEntity.typeName };
  },
});

const plainRefCodec = makeCodecDescriptor({
  codecId: 'test/plain-ref@1',
  columnFromEntity: (entity) => {
    const plainEntity = entity as TestPlainRef;
    return { nativeType: plainEntity.name };
  },
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

const codecLookup: CodecLookup = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
  descriptorFor: (id) => codecsById.get(id),
};

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
  target: postgresTarget,
  scalarColumnDescriptors: postgresScalarTypeDescriptors,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
  codecLookup,
} as const;

function interpretWith(schema: string) {
  const document = symbolTableInputFromParseArgs({
    schema,
    sourceId: 'schema.prisma',
    pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    ...baseInput,
    ...document,
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
    // `nativeType` / `typeParams.typeName` stay bare here: schema-qualification
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
                    nativeType: 'AalLevel',
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
                  ref: { codecId: 'test/plain-ref@1', nativeType: 'AnyName' },
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

  it('rejects an unresolvable entity ref with PSL_UNKNOWN_ENTITY_REF', () => {
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
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_UNKNOWN_ENTITY_REF' })]),
    );
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
    // Composite-type field resolution never threads a namespace id or
    // namespace-extension-entities map (`buildValueObjects` in the
    // interpreter), so this diagnostic is unreachable end-to-end once the
    // generic entity lookup requires a namespace-scoped map to find
    // anything. Drive `resolveFieldTypeDescriptor` directly instead, with a
    // hand-built `namespaceExtensionEntities` that has already resolved the
    // ref (mirroring what a real namespace lowering pass would have
    // produced) but no `namespaceId` — a combination the exported function
    // signature permits even though production never produces it.
    const { document, sources } = parse(
      `
model AuthSession {
  id Int @id
  aal pg.enum(AalLevel)
}
`,
      'schema.prisma',
    );
    const { symbolTable } = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors,
    });
    const field = symbolTable.topLevel.models['AuthSession']?.fields['aal'];
    expect(field).toBeDefined();
    if (!field) return;

    const diagnostics = createPslDiagnosticCollector(sources);
    const result = resolveFieldTypeDescriptor({
      field,
      enumTypeDescriptors: new Map(),
      namedTypeDescriptors: new Map(),
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      authoringContributions,
      composedExtensions: new Set(),
      familyId: 'sql',
      targetId: 'postgres',
      diagnostics,
      sources,
      entityLabel: 'Field "AuthSession.aal"',
      namespaceExtensionEntities: {
        [NATIVE_ENUM_DISCRIMINATOR]: { AalLevel: { typeName: 'AalLevel', members: ['aal1'] } },
        valueSet: { AalLevel: { kind: 'valueSet', values: ['aal1'] } },
      },
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
