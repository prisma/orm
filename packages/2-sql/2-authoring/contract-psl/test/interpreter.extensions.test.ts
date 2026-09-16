import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  documentScopedTypes,
  pgvectorAuthoringContributions,
  pgvectorExtensionPack,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarColumnDescriptors: postgresScalarTypeDescriptors,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

describe('interpretPslDocumentToSqlContract extensions', () => {
  it('rejects legacy pgvector.column attributes even when the extension is composed', () => {
    const namedTypeDocument = symbolTableInputFromParseArgs({
      schema: `types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id
  embedding Embedding1536
}
`,
      sourceId: 'schema.prisma',
    });

    const namedTypeResult = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...namedTypeDocument,
      composedExtensions: ['pgvector'],
      authoringContributions: pgvectorAuthoringContributions,
    });
    expect(namedTypeResult.ok).toBe(false);
    if (namedTypeResult.ok) return;
    expect(namedTypeResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
          message: expect.stringContaining('pgvector.column'),
        }),
      ]),
    );

    const fieldDocument = symbolTableInputFromParseArgs({
      schema: `model Document {
  id Int @id
  embedding Bytes @pgvector.column(length: 1536)
}
`,
      sourceId: 'schema.prisma',
    });
    const fieldResult = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...fieldDocument,
      composedExtensions: ['pgvector'],
      authoringContributions: pgvectorAuthoringContributions,
    });
    expect(fieldResult.ok).toBe(false);
    if (fieldResult.ok) return;
    expect(fieldResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          message: expect.stringContaining('pgvector.column'),
        }),
      ]),
    );
  });

  it('rejects attributes attached to constructor-based named types', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Embedding1536 = pgvector.Vector(1536) @pgvector.column
}

model Document {
  id Int @id
  embedding Embedding1536
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['pgvector'],
      authoringContributions: pgvectorAuthoringContributions,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
          message: expect.stringContaining('pgvector.column'),
        }),
      ]),
    );
  });

  it('preserves composed extension pack versions when refs are provided', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Embedding1536 = pgvector.Vector(1536)
}

model Document {
  id Int @id
  embedding Embedding1536
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['pgvector'],
      composedExtensionPackRefs: [pgvectorExtensionPack],
      authoringContributions: pgvectorAuthoringContributions,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extensions).toMatchObject({
      pgvector: {
        version: pgvectorExtensionPack.version,
      },
    });
  });

  it('parses stringArray arguments whose elements contain commas', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Tag = sql.Enum('Tag', ["hello, world", "a,b,c", 'plain'])
}

model Post {
  id Int @id
  tag Tag
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      authoringContributions: {
        type: {
          sql: {
            Enum: {
              kind: 'typeConstructor',
              args: [{ kind: 'string' }, { kind: 'stringArray' }],
              output: {
                codecId: 'custom/enum@1',
                nativeType: 'enum',
                typeParams: {
                  name: { kind: 'arg', index: 0 },
                  values: { kind: 'arg', index: 1 },
                },
              },
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(documentScopedTypes(result.value)).toMatchObject({
      Tag: {
        codecId: 'custom/enum@1',
        nativeType: 'enum',
        typeParams: { name: 'Tag', values: ['hello, world', 'a,b,c', 'plain'] },
      },
    });
  });

  it('instantiates family-owned and extension-owned constructor expressions from shared authoring contributions', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  ShortName = sql.String(length: 35)
  Embedding1536 = pgvector.Vector(1536)
}

model Document {
  id Int @id
  shortName ShortName
  embedding Embedding1536
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['pgvector'],
      authoringContributions: {
        type: {
          sql: {
            String: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
              output: {
                codecId: 'custom/varchar@1',
                nativeType: 'character varying',
                typeParams: {
                  length: { kind: 'arg', index: 0 },
                },
              },
            },
          },
          pgvector: {
            Vector: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
              output: {
                codecId: 'custom/vector@1',
                nativeType: 'vector',
                typeParams: {
                  length: { kind: 'arg', index: 0 },
                },
              },
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(documentScopedTypes(result.value)).toMatchObject({
      ShortName: {
        codecId: 'custom/varchar@1',
        nativeType: 'character varying',
        typeParams: { length: 35 },
      },
      Embedding1536: {
        codecId: 'custom/vector@1',
        nativeType: 'vector',
        typeParams: { length: 1536 },
      },
    });
  });

  it('instantiates inline field constructor expressions from shared authoring contributions', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Document {
  id Int @id
  shortName sql.String(length: 35)
  embedding pgvector.Vector(length: 1536)?
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: ['pgvector'],
      authoringContributions: {
        type: {
          sql: {
            String: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
              output: {
                codecId: 'custom/varchar@1',
                nativeType: 'character varying',
                typeParams: {
                  length: { kind: 'arg', index: 0 },
                },
              },
            },
          },
          pgvector: {
            Vector: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
              output: {
                codecId: 'custom/vector@1',
                nativeType: 'vector',
                typeParams: {
                  length: { kind: 'arg', index: 0 },
                },
              },
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(documentScopedTypes(result.value) ?? {}).toEqual({});
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Document: {
                columns: {
                  shortName: {
                    codecId: 'custom/varchar@1',
                    nativeType: 'character varying',
                    nullable: false,
                  },
                  embedding: {
                    codecId: 'custom/vector@1',
                    nativeType: 'vector',
                    nullable: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('instantiates constructor expressions with JS-like object literal arguments', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  ShortName = sql.String({ length: 35, label: 'short' })
}

model Document {
  id Int @id
  shortName ShortName
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      authoringContributions: {
        type: {
          sql: {
            String: {
              kind: 'typeConstructor',
              args: [
                {
                  kind: 'object',
                  properties: {
                    length: { kind: 'number', integer: true, minimum: 1 },
                    label: { kind: 'string', optional: true },
                  },
                },
              ],
              output: {
                codecId: 'custom/varchar@1',
                nativeType: 'character varying',
                typeParams: {
                  length: { kind: 'arg', index: 0, path: ['length'] },
                  label: { kind: 'arg', index: 0, path: ['label'] },
                },
              },
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(documentScopedTypes(result.value)).toMatchObject({
      ShortName: {
        codecId: 'custom/varchar@1',
        nativeType: 'character varying',
        typeParams: {
          length: 35,
          label: 'short',
        },
      },
    });
  });

  describe('object literal constructor arguments', () => {
    const objectArgContributions = {
      type: {
        sql: {
          String: {
            kind: 'typeConstructor' as const,
            args: [
              {
                kind: 'object' as const,
                properties: {
                  length: { kind: 'number' as const, integer: true, minimum: 1 },
                  label: { kind: 'string' as const, optional: true },
                },
              },
            ],
            output: {
              codecId: 'custom/varchar@1',
              nativeType: 'character varying',
              typeParams: {
                length: { kind: 'arg' as const, index: 0, path: ['length'] },
                label: { kind: 'arg' as const, index: 0, path: ['label'] },
              },
            },
          },
        },
      },
    };

    const interpretWith = (schema: string) =>
      interpretPslDocumentToSqlContract({
        ...baseInput,
        ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
        authoringContributions: objectArgContributions,
      });

    it('accepts strict JSON with double-quoted keys', () => {
      const result = interpretWith(`types {
  Short = sql.String({ "length": 35, "label": "short" })
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(documentScopedTypes(result.value)).toMatchObject({
        Short: { typeParams: { length: 35, label: 'short' } },
      });
    });

    it('rejects an object literal that is missing a required property', () => {
      const result = interpretWith(`types {
  Short = sql.String({ label: 'short' })
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' }),
        ]),
      );
    });

    it('rejects an object literal with an unknown property', () => {
      const result = interpretWith(`types {
  Short = sql.String({ length: 35, bogus: 'x' })
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' }),
        ]),
      );
    });

    it('rejects an object literal with a wrong-typed property', () => {
      const result = interpretWith(`types {
  Short = sql.String({ length: 'not a number' })
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' }),
        ]),
      );
    });

    it('rejects malformed object literal syntax (unclosed brace)', () => {
      const result = interpretWith(`types {
  Short = sql.String({ length: 35 )
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
    });

    it('rejects a top-level non-object literal', () => {
      const result = interpretWith(`types {
  Short = sql.String([1, 2, 3])
}

model Doc {
  id Int @id
  s Short
}
`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' }),
        ]),
      );
    });
  });

  it('routes lowered extension entities to entries[discriminator] via explicit createNamespace', () => {
    const capturedEntries: Record<string, Record<string, Record<string, unknown>>> = {};
    const pslBlockDescriptors = {
      test_block: {
        kind: 'pslBlock' as const,
        keyword: 'test_block',
        discriminator: 'test-custom-block',
        name: { required: true },
        parameters: {},
      },
    };
    const authoringContributions = {
      entityTypes: {
        test: {
          kind: 'entity' as const,
          discriminator: 'test-custom-block',
          output: {
            factory: (raw: unknown) => raw,
          },
        },
      },
      pslBlockDescriptors,
    };
    const createNamespace = (input: SqlNamespaceInput): SqlNamespaceBase => {
      capturedEntries[input.id] = {
        ...(capturedEntries[input.id] ?? {}),
        ...input.entries,
      };
      return createTestSqlNamespace(input);
    };

    const symbolTableInput = symbolTableInputFromParseArgs({
      schema: `
namespace public {
  model Foo {
    id Int @id
  }

  test_block my_entry {
  }
}
`,
      sourceId: 'schema.prisma',
      pslBlockDescriptors,
    });

    const result = interpretPslDocumentToSqlContract({
      ...symbolTableInput,
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      authoringContributions,
      createNamespace,
      capabilities: { sql: { scalarList: true } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(capturedEntries).toMatchObject({
      public: {
        'test-custom-block': {
          my_entry: expect.objectContaining({ kind: 'test-custom-block' }),
        },
      },
    });
  });

  describe('top-level extension blocks', () => {
    const topThingPslBlockDescriptors = {
      top_thing: {
        kind: 'pslBlock' as const,
        keyword: 'top_thing',
        discriminator: 'top-thing',
        name: { required: true },
        parameters: {},
      },
    };
    const topThingAuthoringContributions = {
      entityTypes: {
        topThing: {
          kind: 'entity' as const,
          discriminator: 'top-thing',
          output: {
            factory: (raw: unknown) => raw,
          },
        },
      },
      pslBlockDescriptors: topThingPslBlockDescriptors,
    };

    it('lowers a top-level block into the default namespace bucket, like top-level models', () => {
      const capturedEntries: Record<string, Record<string, Record<string, unknown>>> = {};
      const createNamespace = (input: SqlNamespaceInput): SqlNamespaceBase => {
        capturedEntries[input.id] = {
          ...(capturedEntries[input.id] ?? {}),
          ...input.entries,
        };
        return createTestSqlNamespace(input);
      };

      const symbolTableInput = symbolTableInputFromParseArgs({
        schema: `
top_thing my_entry {
}

model Foo {
  id Int @id
}
`,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: topThingPslBlockDescriptors,
      });

      const result = interpretPslDocumentToSqlContract({
        ...symbolTableInput,
        target: postgresTarget,
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
        composedExtensionContracts: new Map(),
        authoringContributions: topThingAuthoringContributions,
        createNamespace,
        capabilities: { sql: { scalarList: true } },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(capturedEntries['public']).toMatchObject({
        'top-thing': {
          my_entry: expect.objectContaining({ kind: 'top-thing', name: 'my_entry' }),
        },
      });
    });

    it('accepts a blocks-only `namespace unbound { … }` alongside named namespaces and lowers its blocks into the unbound bucket', () => {
      const capturedEntries: Record<string, Record<string, Record<string, unknown>>> = {};
      const createNamespace = (input: SqlNamespaceInput): SqlNamespaceBase => {
        capturedEntries[input.id] = {
          ...(capturedEntries[input.id] ?? {}),
          ...input.entries,
        };
        return createTestSqlNamespace(input);
      };

      const symbolTableInput = symbolTableInputFromParseArgs({
        schema: `
namespace unbound {
  top_thing my_entry {
  }
}

namespace auth {
  model Foo {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: topThingPslBlockDescriptors,
      });

      const result = interpretPslDocumentToSqlContract({
        ...symbolTableInput,
        target: postgresTarget,
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
        composedExtensionContracts: new Map(),
        authoringContributions: topThingAuthoringContributions,
        createNamespace,
        capabilities: { sql: { scalarList: true } },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(capturedEntries['__unbound__']).toMatchObject({
        'top-thing': {
          my_entry: expect.objectContaining({ kind: 'top-thing', name: 'my_entry' }),
        },
      });
      expect(result.value.storage.namespaces['__unbound__']).toBeDefined();
    });

    it('the raw sentinel spelling `namespace __unbound__ { … }` lowers blocks into the unbound bucket like the `unbound` spelling', () => {
      const capturedEntries: Record<string, Record<string, Record<string, unknown>>> = {};
      const createNamespace = (input: SqlNamespaceInput): SqlNamespaceBase => {
        capturedEntries[input.id] = {
          ...(capturedEntries[input.id] ?? {}),
          ...input.entries,
        };
        return createTestSqlNamespace(input);
      };

      const symbolTableInput = symbolTableInputFromParseArgs({
        schema: `
namespace __unbound__ {
  top_thing my_entry {
  }
}

namespace auth {
  model Foo {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: topThingPslBlockDescriptors,
      });

      const result = interpretPslDocumentToSqlContract({
        ...symbolTableInput,
        target: postgresTarget,
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
        composedExtensionContracts: new Map(),
        authoringContributions: topThingAuthoringContributions,
        createNamespace,
        capabilities: { sql: { scalarList: true } },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(capturedEntries['__unbound__']).toMatchObject({
        'top-thing': {
          my_entry: expect.objectContaining({ kind: 'top-thing', name: 'my_entry' }),
        },
      });
    });
  });

  describe('extension entity merge collisions across reopened namespace spellings', () => {
    const thingPslBlockDescriptors = {
      thing: {
        kind: 'pslBlock' as const,
        keyword: 'thing',
        discriminator: 'thing',
        name: { required: true },
        parameters: {},
      },
    };
    const thingAuthoringContributions = {
      entityTypes: {
        thing: {
          kind: 'entity' as const,
          discriminator: 'thing',
          output: { factory: (raw: unknown) => raw },
        },
      },
      pslBlockDescriptors: thingPslBlockDescriptors,
    };

    it('rejects two reopened unbound spellings declaring the same named entity under the same entries kind', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `namespace unbound {
  thing shared {
  }
}

namespace __unbound__ {
  thing shared {
  }
}
`,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: thingPslBlockDescriptors,
      });

      const result = interpretPslDocumentToSqlContract({
        ...baseInput,
        ...document,
        authoringContributions: thingAuthoringContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_DUPLICATE_EXTENSION_ENTITY',
            message: expect.stringContaining('shared'),
          }),
        ]),
      );
    });

    it('allows disjoint entity names across the two unbound spellings and unions them into the unbound bucket', () => {
      const capturedEntries: Record<string, Record<string, Record<string, unknown>>> = {};
      const createNamespace = (input: SqlNamespaceInput): SqlNamespaceBase => {
        capturedEntries[input.id] = {
          ...(capturedEntries[input.id] ?? {}),
          ...input.entries,
        };
        return createTestSqlNamespace(input);
      };

      const document = symbolTableInputFromParseArgs({
        schema: `namespace unbound {
  thing entry_a {
  }
}

namespace __unbound__ {
  thing entry_b {
  }
}
`,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: thingPslBlockDescriptors,
      });

      const result = interpretPslDocumentToSqlContract({
        ...baseInput,
        ...document,
        authoringContributions: thingAuthoringContributions,
        createNamespace,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(capturedEntries['__unbound__']).toMatchObject({
        thing: {
          entry_a: expect.objectContaining({ name: 'entry_a' }),
          entry_b: expect.objectContaining({ name: 'entry_b' }),
        },
      });
    });
  });
});
