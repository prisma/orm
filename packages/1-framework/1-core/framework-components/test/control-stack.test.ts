import type { JsonValue } from '@internal/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import type { CreateControlStackInput } from '../src/control/control-stack';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
  buildExtensionLoadOrder,
  createControlStack,
  extractCodecLookup,
  extractCodecTypeImports,
  extractComponentIds,
  extractQueryOperationTypeImports,
  validateScalarTypeCodecIds,
} from '../src/control/control-stack';
import type { Codec } from '../src/shared/codec';
import type { AnyCodecDescriptor } from '../src/shared/codec-descriptor';
import type { CodecLookup } from '../src/shared/codec-types';
import type { ComponentDescriptor } from '../src/shared/framework-components';
import { isRuntimeError } from '../src/shared/runtime-error';

function createDescriptor<K extends string = 'target'>(
  overrides: Partial<ComponentDescriptor<string>> & { kind?: K } = {} as Partial<
    ComponentDescriptor<string>
  > & { kind?: K },
): ComponentDescriptor<K> {
  return {
    kind: 'target' as K,
    id: 'test',
    version: '0.0.1',
    ...overrides,
  } as ComponentDescriptor<K>;
}

// Tests only exercise metadata extraction; stub shapes satisfy the runtime paths
function stubInput(input: Record<string, unknown>): CreateControlStackInput {
  return input as unknown as CreateControlStackInput;
}

describe('extractCodecTypeImports', () => {
  it('returns empty array for descriptors without codec types', () => {
    const result = extractCodecTypeImports([createDescriptor()]);
    expect(result).toEqual([]);
  });

  it('extracts base codec type import', () => {
    const result = extractCodecTypeImports([
      createDescriptor({
        types: {
          codecTypes: {
            import: {
              package: '@internal/adapter-mongo/codec-types',
              named: 'CodecTypes',
              alias: 'MongoCodecTypes',
            },
          },
        },
      }),
    ]);
    expect(result).toEqual([
      {
        package: '@internal/adapter-mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
    ]);
  });

  it('extracts typeImports alongside base import', () => {
    const result = extractCodecTypeImports([
      createDescriptor({
        types: {
          codecTypes: {
            import: { package: '@test/codec-types', named: 'CodecTypes', alias: 'T' },
            typeImports: [{ package: '@test/extra', named: 'Extra', alias: 'E' }],
          },
        },
      }),
    ]);
    expect(result).toHaveLength(2);
  });
});

describe('extractQueryOperationTypeImports', () => {
  it('returns empty array for descriptors without query operation types', () => {
    const result = extractQueryOperationTypeImports([createDescriptor()]);
    expect(result).toEqual([]);
  });

  it('extracts query operation type import', () => {
    const result = extractQueryOperationTypeImports([
      createDescriptor({
        types: {
          queryOperationTypes: {
            import: { package: '@test/qops', named: 'QOps', alias: 'Q' },
          },
        },
      }),
    ]);
    expect(result).toEqual([{ package: '@test/qops', named: 'QOps', alias: 'Q' }]);
  });
});

describe('extractComponentIds', () => {
  it('collects IDs in order: family, target, adapter, extensions', () => {
    const result = extractComponentIds(
      { id: 'family-1' },
      { id: 'target-1' },
      { id: 'adapter-1' },
      [{ id: 'ext-1' }, { id: 'ext-2' }],
    );
    expect(result).toEqual(['family-1', 'target-1', 'adapter-1', 'ext-1', 'ext-2']);
  });

  it('deduplicates IDs preserving first occurrence', () => {
    const result = extractComponentIds({ id: 'shared' }, { id: 'shared' }, { id: 'shared' }, [
      { id: 'shared' },
    ]);
    expect(result).toEqual(['shared']);
  });

  it('handles undefined adapter', () => {
    const result = extractComponentIds({ id: 'fam' }, { id: 'target' }, undefined, [{ id: 'ext' }]);
    expect(result).toEqual(['fam', 'target', 'ext']);
  });
});

describe('assembleAuthoringContributions', () => {
  it('returns empty namespaces for descriptors without authoring', () => {
    const result = assembleAuthoringContributions([createDescriptor()]);
    expect(result).toEqual({
      field: {},
      type: {},
      entityTypes: {},
      pslBlockDescriptors: {},
      modelAttributes: {},
      attributeSpecs: { model: {}, field: {} },
    });
  });

  it('merges field namespaces from multiple descriptors', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          field: {
            ns1: { kind: 'fieldPreset', output: { codecId: 'a@1', nativeType: 'text' } },
          },
        },
      }),
      createDescriptor({
        id: 'other',
        authoring: {
          field: {
            ns2: { kind: 'fieldPreset', output: { codecId: 'b@1', nativeType: 'int' } },
          },
        },
      }),
    ]);
    expect(Object.keys(result.field)).toEqual(['ns1', 'ns2']);
  });

  it('throws on duplicate field preset paths', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            field: {
              dup: { kind: 'fieldPreset', output: { codecId: 'a@1', nativeType: 'text' } },
            },
          },
        }),
        createDescriptor({
          id: 'other',
          authoring: {
            field: {
              dup: { kind: 'fieldPreset', output: { codecId: 'b@1', nativeType: 'int' } },
            },
          },
        }),
      ]),
    ).toThrow(/Duplicate authoring field helper "dup"/);
  });

  it('lands top-level type constructors from a descriptor in the merged namespace', () => {
    const stringConstructor = {
      kind: 'typeConstructor',
      output: { codecId: 'pg/text@1', nativeType: 'text' },
    } as const;
    const result = assembleAuthoringContributions([
      createDescriptor({
        kind: 'adapter',
        id: 'adapter-a',
        authoring: { type: { String: stringConstructor } },
      }),
    ]);
    expect(result.type['String']).toEqual(stringConstructor);
  });

  it('rejects two descriptors contributing the same top-level type constructor naming both', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          id: 'adapter-a',
          authoring: {
            type: {
              String: { kind: 'typeConstructor', output: { codecId: 'a@1', nativeType: 'text' } },
            },
          },
        }),
        createDescriptor({
          id: 'adapter-b',
          authoring: {
            type: {
              String: { kind: 'typeConstructor', output: { codecId: 'b@1', nativeType: 'text' } },
            },
          },
        }),
      ]),
    ).toThrow(
      /Duplicate authoring type helper "String"\. Descriptor "adapter-b" conflicts with "adapter-a"/,
    );
  });

  it('rejects a type constructor whose template references an argument index that does not exist', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          id: 'adapter-a',
          authoring: {
            type: {
              Sized: {
                kind: 'typeConstructor',
                args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
                output: {
                  codecId: 'a/sized@1',
                  nativeType: 'sized',
                  typeParams: { length: { kind: 'arg', index: 2 } },
                },
              },
            },
          },
        }),
      ]),
    ).toThrow(
      'Invalid authoring type constructor "Sized" contributed by descriptor "adapter-a". ' +
        'output.typeParams.length references argument 2, but the constructor declares 1 argument(s). ' +
        'Declare the argument or correct the reference index.',
    );
  });

  it('rejects a nested type constructor with a dangling arg-ref naming its dotted path', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          id: 'ext-vendor',
          authoring: {
            type: {
              vendor: {
                Odd: {
                  kind: 'typeConstructor',
                  output: {
                    codecId: 'a/odd@1',
                    nativeType: 'odd',
                    typeParams: { size: { kind: 'arg', index: 0 } },
                  },
                },
              },
            },
          },
        }),
      ]),
    ).toThrow(
      'Invalid authoring type constructor "vendor.Odd" contributed by descriptor "ext-vendor". ' +
        'output.typeParams.size references argument 0, but the constructor declares 0 argument(s). ' +
        'Declare the argument or correct the reference index.',
    );
  });

  it('rejects a dangling arg-ref inside an arg-ref default', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          id: 'adapter-a',
          authoring: {
            type: {
              Sized: {
                kind: 'typeConstructor',
                args: [{ kind: 'number', name: 'length', integer: true, optional: true }],
                output: {
                  codecId: 'a/sized@1',
                  nativeType: 'sized',
                  typeParams: {
                    length: { kind: 'arg', index: 0, default: { kind: 'arg', index: 5 } },
                  },
                },
              },
            },
          },
        }),
      ]),
    ).toThrow(
      'Invalid authoring type constructor "Sized" contributed by descriptor "adapter-a". ' +
        'output.typeParams.length references argument 5, but the constructor declares 1 argument(s). ' +
        'Declare the argument or correct the reference index.',
    );
  });

  it('rejects a plain type constructor without an output template', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          id: 'adapter-a',
          authoring: {
            type: {
              Odd: { kind: 'typeConstructor', output: { codecId: 'a/odd@1' } },
            },
          },
        }),
      ]),
    ).toThrow(
      'Invalid authoring type constructor "Odd" contributed by descriptor "adapter-a". ' +
        'The output declares no storage type template and no entityRefArg; a plain constructor must declare one.',
    );
  });

  it('accepts typeParams references to optional arguments without defaults (omitted-key semantics)', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        id: 'adapter-a',
        authoring: {
          type: {
            VarCharish: {
              kind: 'typeConstructor',
              args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
              output: {
                codecId: 'a/varcharish@1',
                nativeType: 'character varying',
                typeParams: { length: { kind: 'arg', index: 0 } },
              },
            },
          },
        },
      }),
    ]);
    expect(Object.keys(result.type)).toEqual(['VarCharish']);
  });

  it('accepts an entityRefArg constructor without an output template', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        id: 'target-a',
        authoring: {
          type: {
            enum: {
              kind: 'typeConstructor',
              entityRefArg: { index: 0, entityKind: 'native_enum' },
              output: { codecId: 'a/enum@1' },
            },
          },
        },
      }),
    ]);
    expect(Object.keys(result.type)).toEqual(['enum']);
  });

  it('assembles the single declared valueObjectStorageType', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        id: 'adapter-a',
        authoring: {
          type: {
            Rich: { kind: 'typeConstructor', output: { codecId: 'a/rich@1', nativeType: 'rich' } },
          },
          valueObjectStorageType: 'Rich',
        },
      }),
      createDescriptor({ id: 'other' }),
    ]);
    expect(result.valueObjectStorageType).toBe('Rich');
  });

  it('leaves valueObjectStorageType absent when no descriptor declares it', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          type: {
            Rich: { kind: 'typeConstructor', output: { codecId: 'a/rich@1', nativeType: 'rich' } },
          },
        },
      }),
    ]);
    expect(result.valueObjectStorageType).toBeUndefined();
    expect('valueObjectStorageType' in result).toBe(false);
  });

  it('resolves a valueObjectStorageType contributed by another descriptor', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        id: 'target-a',
        authoring: {
          type: {
            Rich: { kind: 'typeConstructor', output: { codecId: 'a/rich@1', nativeType: 'rich' } },
          },
        },
      }),
      createDescriptor({
        id: 'adapter-a',
        authoring: { valueObjectStorageType: 'Rich' },
      }),
    ]);
    expect(result.valueObjectStorageType).toBe('Rich');
  });

  it('rejects two descriptors both declaring valueObjectStorageType naming both', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          id: 'adapter-a',
          authoring: {
            type: {
              Rich: {
                kind: 'typeConstructor',
                output: { codecId: 'a/rich@1', nativeType: 'rich' },
              },
            },
            valueObjectStorageType: 'Rich',
          },
        }),
        createDescriptor({
          id: 'adapter-b',
          authoring: { valueObjectStorageType: 'Rich' },
        }),
      ]),
    ).toThrow(
      /Duplicate authoring valueObjectStorageType declaration\. Descriptor "adapter-b" conflicts with "adapter-a"/,
    );
  });

  it('rejects a valueObjectStorageType that names no constructor in the assembled namespace', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          id: 'adapter-a',
          authoring: {
            type: {
              Rich: {
                kind: 'typeConstructor',
                output: { codecId: 'a/rich@1', nativeType: 'rich' },
              },
            },
            valueObjectStorageType: 'Missing',
          },
        }),
      ]),
    ).toThrow(
      /Invalid authoring valueObjectStorageType "Missing" declared by descriptor "adapter-a"/,
    );
  });

  it('rejects a valueObjectStorageType that names a constructor that is not bare-eligible', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          id: 'adapter-a',
          authoring: {
            type: {
              Sized: {
                kind: 'typeConstructor',
                args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
                output: { codecId: 'a/sized@1', nativeType: 'sized' },
              },
            },
            valueObjectStorageType: 'Sized',
          },
        }),
      ]),
    ).toThrow(
      /Invalid authoring valueObjectStorageType "Sized" declared by descriptor "adapter-a"/,
    );
  });

  it('merges top-level String alongside namespaced sql.String', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        id: 'family-sql',
        authoring: {
          type: {
            sql: {
              String: {
                kind: 'typeConstructor',
                output: { codecId: 'sql/varchar@1', nativeType: 'character varying' },
              },
            },
          },
        },
      }),
      createDescriptor({
        id: 'adapter-a',
        authoring: {
          type: {
            String: {
              kind: 'typeConstructor',
              output: { codecId: 'pg/text@1', nativeType: 'text' },
            },
          },
        },
      }),
    ]);
    expect(Object.keys(result.type).sort()).toEqual(['String', 'sql']);
    expect(result.type['String']).toMatchObject({ output: { codecId: 'pg/text@1' } });
    expect(result.type['sql']).toMatchObject({
      String: { output: { codecId: 'sql/varchar@1' } },
    });
  });

  it('rejects malformed descriptor values during merge instead of recursing into primitives', () => {
    // A descriptor missing `output` fails the canonical leaf guard but is a plain object, so the walker would historically recurse INTO it and, on the second registration of the same path, try to walk through the inner `'fieldPreset'` string of the `kind` property — either silently mangling state or infinite-looping. The walker now rejects the malformed value with a clear path-aware error.
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            field: {
              malformed: { kind: 'fieldPreset' } as unknown as never,
            },
          },
        }),
        createDescriptor({
          id: 'other',
          authoring: {
            field: {
              malformed: { kind: 'fieldPreset' } as unknown as never,
            },
          },
        }),
      ]),
    ).toThrow(/Invalid authoring field helper "malformed\.kind"/);
  });

  it('rejects field preset and type constructor path collisions', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            field: {
              custom: {
                Json: { kind: 'fieldPreset', output: { codecId: 'a@1', nativeType: 'json' } },
              },
            },
          },
        }),
        createDescriptor({
          id: 'other',
          authoring: {
            type: {
              custom: {
                Json: {
                  kind: 'typeConstructor',
                  output: { codecId: 'b@1', nativeType: 'jsonb' },
                },
              },
            },
          },
        }),
      ]),
    ).toThrow(/Ambiguous authoring registry path "custom.Json"/);
  });

  it('merges entityTypes namespaces from multiple descriptors', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          entityTypes: {
            enum: {
              kind: 'entity',
              discriminator: 'test-enum',
              output: { factory: () => ({}) },
            },
          },
        },
      }),
      createDescriptor({
        id: 'other',
        authoring: {
          entityTypes: {
            demo: {
              kind: 'entity',
              discriminator: 'demo-entity',
              output: { factory: () => ({}) },
            },
          },
        },
      }),
    ]);
    expect(Object.keys(result.entityTypes)).toEqual(['enum', 'demo']);
  });

  function makeDeclarativePslBlockDescriptor(
    discriminator: string,
    keyword: string = discriminator,
  ) {
    return {
      kind: 'pslBlock' as const,
      keyword,
      discriminator,
      name: { required: true },
      parameters: {},
    };
  }

  it('merges pslBlockDescriptors namespaces from multiple descriptors', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          entityTypes: {
            policyEntity: {
              kind: 'entity',
              discriminator: 'postgres-policy',
              output: { factory: () => ({}) },
            },
            roleEntity: {
              kind: 'entity',
              discriminator: 'postgres-role',
              output: { factory: () => ({}) },
            },
          },
          pslBlockDescriptors: {
            policyBlock: makeDeclarativePslBlockDescriptor('postgres-policy'),
          },
        },
      }),
      createDescriptor({
        id: 'other',
        authoring: {
          pslBlockDescriptors: {
            roleBlock: makeDeclarativePslBlockDescriptor('postgres-role'),
          },
        },
      }),
    ]);
    expect(Object.keys(result.pslBlockDescriptors)).toEqual(['policyBlock', 'roleBlock']);
  });

  it('throws on duplicate pslBlockDescriptors paths from different descriptors', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            entityTypes: {
              fooEntity: {
                kind: 'entity',
                discriminator: 'fake-foo',
                output: { factory: () => ({}) },
              },
            },
            pslBlockDescriptors: {
              foo: makeDeclarativePslBlockDescriptor('fake-foo'),
            },
          },
        }),
        createDescriptor({
          id: 'other',
          authoring: {
            pslBlockDescriptors: {
              foo: makeDeclarativePslBlockDescriptor('fake-foo'),
            },
          },
        }),
      ]),
    ).toThrow(/Duplicate authoring pslBlock helper "foo"/);
  });

  it('accepts pslBlockDescriptors + entityTypes sharing the same path with matching discriminators', () => {
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          entityTypes: {
            policy: {
              kind: 'entity',
              discriminator: 'postgres-policy',
              output: { factory: () => ({}) },
            },
          },
          pslBlockDescriptors: {
            policy: makeDeclarativePslBlockDescriptor('postgres-policy'),
          },
        },
      }),
    ]);
    expect(Object.keys(result.entityTypes)).toEqual(['policy']);
    expect(Object.keys(result.pslBlockDescriptors)).toEqual(['policy']);
  });

  it('rejects a pslBlockDescriptors contribution with no matching entityTypes factory', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            pslBlockDescriptors: {
              fooBlock: makeDeclarativePslBlockDescriptor('fake-foo'),
            },
          },
        }),
      ]),
    ).toThrow(/pslBlock.*"fake-foo".*entityType/);
  });

  it('rejects a malformed pslBlockDescriptors entry that carries descriptor-shaped keys but is not a valid declarative descriptor', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            pslBlockDescriptors: {
              // Carries kind + discriminator but missing required fields (keyword, name, parameters).
              broken: {
                kind: 'pslBlock',
                discriminator: 'fake-foo',
              } as unknown as never,
            },
          },
        }),
      ]),
    ).toThrow(/Malformed authoring pslBlock contribution at "broken"/);
  });

  it('descends into a pslBlockDescriptors sub-namespace whose key is "kind" or "discriminator" without triggering malformed check', () => {
    // A sub-namespace keyed "kind" or "discriminator" that does not itself
    // look like a descriptor must descend normally.
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            entityTypes: {
              kind: {
                nested: {
                  kind: 'entity',
                  discriminator: 'test-entity-in-kind-ns',
                  output: { factory: () => ({}) },
                },
              },
              discriminator: {
                nested: {
                  kind: 'entity',
                  discriminator: 'test-entity-in-discriminator-ns',
                  output: { factory: () => ({}) },
                },
              },
            },
          },
        }),
      ]),
    ).not.toThrow();
  });

  it('rejects two pslBlockDescriptors contributions sharing a keyword', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            entityTypes: {
              policyA: {
                kind: 'entity',
                discriminator: 'shared-disc',
                output: { factory: () => ({}) },
              },
              policyB: {
                kind: 'entity',
                discriminator: 'shared-disc-b',
                output: { factory: () => ({}) },
              },
            },
            pslBlockDescriptors: {
              // Different discriminators — that alone is fine (N:1 below) —
              // but the same keyword, which is the parser's real dispatch key.
              policyA: makeDeclarativePslBlockDescriptor('shared-disc', 'shared_keyword'),
              policyB: makeDeclarativePslBlockDescriptor('shared-disc-b', 'shared_keyword'),
            },
          },
        }),
      ]),
    ).toThrow(/Duplicate pslBlock key "shared_keyword".*"policyA".*"policyB"/);
  });

  it('raises a structured runtime error for a duplicate pslBlock keyword', () => {
    let caught: unknown;
    try {
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            entityTypes: {
              policyA: {
                kind: 'entity',
                discriminator: 'shared-disc',
                output: { factory: () => ({}) },
              },
              policyB: {
                kind: 'entity',
                discriminator: 'shared-disc-b',
                output: { factory: () => ({}) },
              },
            },
            pslBlockDescriptors: {
              policyA: makeDeclarativePslBlockDescriptor('shared-disc', 'shared_keyword'),
              policyB: makeDeclarativePslBlockDescriptor('shared-disc-b', 'shared_keyword'),
            },
          },
        }),
      ]);
    } catch (error) {
      caught = error;
    }
    expect(isRuntimeError(caught)).toBe(true);
    if (isRuntimeError(caught)) {
      expect(caught.code).toBe('RUNTIME.DUPLICATE_AUTHORING_DISCRIMINATOR');
      expect(caught.category).toBe('RUNTIME');
      expect(caught.details).toEqual({
        label: 'pslBlock',
        key: 'shared_keyword',
        existingPath: 'policyA',
        path: 'policyB',
      });
    }
  });

  it('allows two pslBlockDescriptors contributions sharing a discriminator when their keywords differ (N:1)', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            entityTypes: {
              shapeEntity: {
                kind: 'entity',
                discriminator: 'shape',
                output: { factory: () => ({}) },
              },
            },
            pslBlockDescriptors: {
              shapeCircle: makeDeclarativePslBlockDescriptor('shape', 'shape_circle'),
              shapeSquare: makeDeclarativePslBlockDescriptor('shape', 'shape_square'),
            },
          },
        }),
      ]),
    ).not.toThrow();
  });

  it('rejects two entityTypes contributions sharing a discriminator', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            entityTypes: {
              enumA: {
                kind: 'entity',
                discriminator: 'shared-entity-disc',
                output: { factory: () => ({}) },
              },
              enumB: {
                kind: 'entity',
                discriminator: 'shared-entity-disc',
                output: { factory: () => ({}) },
              },
            },
          },
        }),
      ]),
    ).toThrow(/Duplicate entityType key "shared-entity-disc".*"enumA".*"enumB"/);
  });

  it('accepts entityTypes-only contributions without a matching pslBlockDescriptors entry (standalone factory is allowed)', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            entityTypes: {
              enum: {
                kind: 'entity',
                discriminator: 'test-enum',
                output: { factory: () => ({}) },
              },
            },
          },
        }),
      ]),
    ).not.toThrow();
  });

  it('does not mutate source pack sub-namespace objects when merging', () => {
    // Pack A owns the `id` sub-namespace with one leaf.
    // Pack B adds a second leaf under the same sub-namespace.
    // After merging, pack A's original object must not contain pack B's key.
    const packAAuthoring = {
      field: {
        id: {
          alpha: { kind: 'fieldPreset' as const, output: { codecId: 'a@1', nativeType: 'text' } },
        },
      },
    };
    const packBAuthoring = {
      field: {
        id: {
          beta: { kind: 'fieldPreset' as const, output: { codecId: 'b@1', nativeType: 'int4' } },
        },
      },
    };

    const result = assembleAuthoringContributions([
      createDescriptor({ authoring: packAAuthoring }),
      createDescriptor({ id: 'pack-b', authoring: packBAuthoring }),
    ]);

    expect(Object.keys(result.field['id'] as object)).toEqual(['alpha', 'beta']);
    // Pack A's original sub-namespace object must be untouched.
    expect(packAAuthoring.field.id).not.toHaveProperty('beta');
  });

  it('composing the same pack objects twice does not throw', () => {
    // Simulates two calls to assembleAuthoringContributions (or createControlStack) within the
    // same process using the same singleton pack descriptors. Without the shallow-copy fix,
    // the first call mutates the family pack's id sub-namespace, so the second call finds both
    // leaves already present in the source object and throws "Duplicate authoring field helper".
    const packADescriptor = createDescriptor({
      authoring: {
        field: {
          id: {
            alpha: {
              kind: 'fieldPreset' as const,
              output: { codecId: 'a@1', nativeType: 'text' },
            },
          },
        },
      },
    });
    const packBDescriptor = createDescriptor({
      id: 'pack-b',
      authoring: {
        field: {
          id: {
            beta: {
              kind: 'fieldPreset' as const,
              output: { codecId: 'b@1', nativeType: 'int4' },
            },
          },
        },
      },
    });

    const first = assembleAuthoringContributions([packADescriptor, packBDescriptor]);
    expect(Object.keys(first.field['id'] as object)).toEqual(['alpha', 'beta']);

    // Second composition with the same singletons must not throw.
    expect(() => assembleAuthoringContributions([packADescriptor, packBDescriptor])).not.toThrow();
  });

  it('still throws when the same leaf path is contributed by two different packs', () => {
    expect(() =>
      assembleAuthoringContributions([
        createDescriptor({
          authoring: {
            field: {
              id: {
                shared: {
                  kind: 'fieldPreset' as const,
                  output: { codecId: 'a@1', nativeType: 'text' },
                },
              },
            },
          },
        }),
        createDescriptor({
          id: 'pack-b',
          authoring: {
            field: {
              id: {
                shared: {
                  kind: 'fieldPreset' as const,
                  output: { codecId: 'b@1', nativeType: 'int4' },
                },
              },
            },
          },
        }),
      ]),
    ).toThrow(/Duplicate authoring field helper "id\.shared"/);
  });

  it('preserves prototype-carrying objects in sub-namespaces through composition', () => {
    // A sub-namespace whose value is a class instance with a prototype getter.
    // Before the fix, mergeAuthoringNamespaces used isPlainNamespaceObject which
    // matched any non-null non-array object, so it would shallow-copy the class
    // instance ({ ...instance }), stripping the prototype and making the getter
    // return undefined. With the fix, only plain objects ({} prototype or null)
    // are shallow-copied; class instances are passed by reference.
    class SubNs {
      get leafDescriptor() {
        return {
          kind: 'entity' as const,
          discriminator: 'proto-entity',
          output: { factory: () => ({}) },
        };
      }
    }
    const subNsInstance = new SubNs();

    // Wrap the instance behind a plain outer namespace so mergeAuthoringNamespaces
    // receives subNsInstance as the sourceValue for key 'sub'.
    const result = assembleAuthoringContributions([
      createDescriptor({
        authoring: {
          entityTypes: {
            sub: subNsInstance as unknown as Record<
              string,
              { kind: 'entity'; discriminator: string; output: { factory: () => object } }
            >,
          },
        },
      }),
    ]);

    // The sub-namespace value must be the original instance (prototype intact),
    // not a shallow-copied plain object with an undefined getter.
    expect(result.entityTypes['sub']).toBe(subNsInstance);
    expect((result.entityTypes['sub'] as unknown as SubNs).leafDescriptor).toBeDefined();
  });

  it('deep-copies nested plain-object sub-namespaces so composing the same pack twice does not throw or mutate', () => {
    // depth-3: pack A owns field.a.b.alpha; pack B adds field.a.b.beta.
    // Before the deep-copy fix, shallow-copying `a` on first assignment left
    // `a.b` shared with pack A's original. On the second composition, pack B
    // recursing into `a.b` would find `beta` already present (mutated in by the
    // first run) and throw "Duplicate authoring field helper".
    const packADescriptor = createDescriptor({
      authoring: {
        field: {
          a: {
            b: {
              alpha: {
                kind: 'fieldPreset' as const,
                output: { codecId: 'a@1', nativeType: 'text' },
              },
            },
          },
        },
      },
    });
    const packBDescriptor = createDescriptor({
      id: 'pack-b',
      authoring: {
        field: {
          a: {
            b: {
              beta: {
                kind: 'fieldPreset' as const,
                output: { codecId: 'b@1', nativeType: 'int4' },
              },
            },
          },
        },
      },
    });

    const first = assembleAuthoringContributions([packADescriptor, packBDescriptor]);
    expect(Object.keys((first.field['a'] as Record<string, unknown>)['b'] as object)).toEqual([
      'alpha',
      'beta',
    ]);

    // Second composition with the same singletons must not throw.
    expect(() => assembleAuthoringContributions([packADescriptor, packBDescriptor])).not.toThrow();
    // Pack A's original nested object must be untouched.
    expect(packADescriptor.authoring?.field?.['a']).not.toHaveProperty(['b', 'beta']);
  });
});

describe('extractCodecLookup', () => {
  const stubCodec = (id: string) =>
    ({
      id,
      encode: async (v: unknown) => v,
      decode: async (v: unknown) => v,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    }) as unknown as Codec;

  const stubDescriptor = (id: string): AnyCodecDescriptor => ({
    codecId: id,
    traits: [],
    targetTypes: [],
    paramsSchema: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ value: undefined }),
      },
    } as unknown as StandardSchemaV1<void>,
    isParameterized: false,
    factory: () => () => stubCodec(id),
  });

  it('builds a lookup from codec descriptors across components', () => {
    const lookup = extractCodecLookup([
      { id: 'desc-1', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
      { id: 'desc-2', types: { codecTypes: { codecDescriptors: [stubDescriptor('b@1')] } } },
    ]);
    expect(lookup.get('a@1')?.id).toBe('a@1');
    expect(lookup.get('b@1')?.id).toBe('b@1');
  });

  it('returns undefined for unknown codec ids', () => {
    const lookup = extractCodecLookup([
      { id: 'desc', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
    ]);
    expect(lookup.get('z@1')).toBeUndefined();
  });

  it('throws on duplicate codec ids from different descriptors', () => {
    expect(() =>
      extractCodecLookup([
        { id: 'desc-1', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
        { id: 'desc-2', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
      ]),
    ).toThrow(/Duplicate codec descriptor for codecId "a@1"/);
  });

  it('forCodecRef resolves a known codec ref', () => {
    const lookup = extractCodecLookup([
      { id: 'desc', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
    ]);
    const codec = lookup.forCodecRef({ codecId: 'a@1' });
    expect(codec.id).toBe('a@1');
  });

  it('forCodecRef throws CONTRACT.CODEC_DESCRIPTOR_MISSING for unknown codec ids', () => {
    const lookup = extractCodecLookup([
      { id: 'desc', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
    ]);
    expect(() => lookup.forCodecRef({ codecId: 'nope@1' })).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING' }),
    );
  });

  it('renderValueLiteralFor delegates to the descriptor renderValueLiteral', () => {
    const descriptorWithValueRenderer: AnyCodecDescriptor = {
      ...stubDescriptor('text@1'),
      renderValueLiteral: (value: unknown) =>
        typeof value === 'string' ? `'${value}'` : undefined,
    };
    const lookup = extractCodecLookup([
      { id: 'desc', types: { codecTypes: { codecDescriptors: [descriptorWithValueRenderer] } } },
    ]);
    expect(lookup.renderValueLiteralFor?.('text@1', 'low', 'output')).toBe("'low'");
    expect(lookup.renderValueLiteralFor?.('text@1', 42, 'output')).toBeUndefined();
  });

  it('renderValueLiteralFor returns undefined for unknown codec ids', () => {
    const lookup = extractCodecLookup([
      { id: 'desc', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
    ]);
    expect(lookup.renderValueLiteralFor?.('unknown@1', 'val', 'output')).toBeUndefined();
  });

  it('renderValueLiteralFor returns undefined when the codec has no renderValueLiteral', () => {
    const lookup = extractCodecLookup([
      { id: 'desc', types: { codecTypes: { codecDescriptors: [stubDescriptor('a@1')] } } },
    ]);
    expect(lookup.renderValueLiteralFor?.('a@1', 'val', 'output')).toBeUndefined();
  });
});

describe('assembleControlMutationDefaults', () => {
  const stubLower = () => ({
    ok: true as const,
    value: { kind: 'storage' as const, defaultValue: { kind: 'literal' as const, value: 0 } },
  });

  it('returns empty registry and generators when no descriptors contribute', () => {
    const result = assembleControlMutationDefaults([createDescriptor()]);
    expect(result.defaultFunctionRegistry.size).toBe(0);
    expect(result.generatorDescriptors).toEqual([]);
  });

  it('merges function registries from multiple descriptors', () => {
    const result = assembleControlMutationDefaults([
      createDescriptor({
        id: 'desc-a',
        controlMutationDefaults: {
          defaultFunctionRegistry: new Map([['now', { lower: stubLower }]]),
          generatorDescriptors: [],
        },
      }),
      createDescriptor({
        id: 'desc-b',
        controlMutationDefaults: {
          defaultFunctionRegistry: new Map([['uuid', { lower: stubLower }]]),
          generatorDescriptors: [{ id: 'uuidv4', applicableCodecIds: ['pg/text@1'] }],
        },
      }),
    ]);
    expect(result.defaultFunctionRegistry.size).toBe(2);
    expect(result.defaultFunctionRegistry.has('now')).toBe(true);
    expect(result.defaultFunctionRegistry.has('uuid')).toBe(true);
    expect(result.generatorDescriptors).toHaveLength(1);
  });

  it('throws on duplicate function name', () => {
    expect(() =>
      assembleControlMutationDefaults([
        createDescriptor({
          id: 'desc-a',
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map([['now', { lower: stubLower }]]),
            generatorDescriptors: [],
          },
        }),
        createDescriptor({
          id: 'desc-b',
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map([['now', { lower: stubLower }]]),
            generatorDescriptors: [],
          },
        }),
      ]),
    ).toThrow(/Duplicate mutation default function "now".*"desc-b".*"desc-a"/);
  });

  it('throws on duplicate generator id', () => {
    expect(() =>
      assembleControlMutationDefaults([
        createDescriptor({
          id: 'desc-a',
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map(),
            generatorDescriptors: [{ id: 'uuidv4', applicableCodecIds: ['a@1'] }],
          },
        }),
        createDescriptor({
          id: 'desc-b',
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map(),
            generatorDescriptors: [{ id: 'uuidv4', applicableCodecIds: ['b@1'] }],
          },
        }),
      ]),
    ).toThrow(/Duplicate mutation default generator id "uuidv4".*"desc-b".*"desc-a"/);
  });
});

describe('createControlStack', () => {
  it('assembles all component state from family + target + adapter + extensions', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'sql' }),
        target: createDescriptor({
          kind: 'target',
          id: 'target',
          types: {
            codecTypes: {
              import: { package: '@test/codec', named: 'C', alias: 'TC' },
            },
          },
        }),
        adapter: createDescriptor({
          kind: 'adapter',
          id: 'adapter',
          types: {
            codecTypes: {
              typeImports: [{ package: '@test/param', named: 'P', alias: 'TP' }],
            },
            queryOperationTypes: {
              import: { package: '@test/qops', named: 'Q', alias: 'TQ' },
            },
          },
          authoring: {
            type: {
              myType: {
                kind: 'typeConstructor',
                output: { codecId: 'a@1', nativeType: 'text' },
              },
            },
          },
        }),
        extensions: [],
      }),
    );

    expect(state.codecTypeImports).toHaveLength(2);
    expect(state.queryOperationTypeImports).toHaveLength(1);
    expect(state.extensionIds).toEqual(['sql', 'target', 'adapter']);
    expect(Object.keys(state.authoringContributions.type)).toEqual(['myType']);
  });

  it('preserves ID ordering: family, target, adapter, extensions', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'fam' }),
        target: createDescriptor({ kind: 'target', id: 'tgt' }),
        adapter: createDescriptor({ kind: 'adapter', id: 'adp' }),
        extensions: [
          createDescriptor({ kind: 'extension', id: 'ext1' }),
          createDescriptor({ kind: 'extension', id: 'ext2' }),
        ],
      }),
    );
    expect(state.extensionIds).toEqual(['fam', 'tgt', 'adp', 'ext1', 'ext2']);
  });

  it('works with family + target only (Mongo case)', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'mongo' }),
        target: createDescriptor({
          kind: 'target',
          id: 'mongo',
          types: {
            codecTypes: {
              import: {
                package: '@internal/adapter-mongo/codec-types',
                named: 'CodecTypes',
                alias: 'MongoCodecTypes',
              },
            },
          },
        }),
      }),
    );

    expect(state.codecTypeImports).toHaveLength(1);
    expect(state.extensionIds).toEqual(['mongo']);
  });

  it('returns empty state when descriptors have no types', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'fam' }),
        target: createDescriptor({ kind: 'target', id: 'tgt' }),
      }),
    );
    expect(state.codecTypeImports).toEqual([]);
    expect(state.queryOperationTypeImports).toEqual([]);
    expect(state.extensionIds).toEqual(['fam', 'tgt']);
    expect(state.authoringContributions).toEqual({
      field: {},
      type: {},
      entityTypes: {},
      pslBlockDescriptors: {},
      modelAttributes: {},
      attributeSpecs: { model: {}, field: {} },
    });
    expect(state.scalarTypes).toEqual([]);
  });

  it('derives scalarTypes from top-level zero-arg constructors in the assembled namespace', () => {
    const state = createControlStack(
      stubInput({
        family: createDescriptor({
          kind: 'family',
          id: 'sql',
          authoring: {
            type: {
              sql: {
                String: {
                  kind: 'typeConstructor',
                  args: [{ kind: 'number', name: 'length' }],
                  output: { codecId: 'sql/varchar@1', nativeType: 'character varying' },
                },
              },
            },
          },
        }),
        target: createDescriptor({ kind: 'target', id: 'tgt' }),
        adapter: createDescriptor({
          kind: 'adapter',
          id: 'adp',
          authoring: {
            type: {
              String: {
                kind: 'typeConstructor',
                output: { codecId: 'pg/text@1', nativeType: 'text' },
              },
              Int: {
                kind: 'typeConstructor',
                output: { codecId: 'pg/int4@1', nativeType: 'int4' },
              },
            },
          },
        }),
      }),
    );
    expect(state.scalarTypes).toEqual(['String', 'Int']);
  });
});

describe('validateScalarTypeCodecIds', () => {
  it('returns errors naming type and codec for unregistered codec IDs on zero-arg constructors', () => {
    const namespace = {
      String: {
        kind: 'typeConstructor' as const,
        output: { codecId: 'missing/codec@1', nativeType: 'text' },
      },
    };
    const lookup: CodecLookup = {
      get: () => undefined,
      targetTypesFor: () => undefined,
      renderOutputTypeFor: () => undefined,
    };
    const errors = validateScalarTypeCodecIds(namespace, lookup);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /Scalar type "String" references codec "missing\/codec@1" which is not registered/,
    );
  });

  it('returns empty array when all codec IDs are registered', () => {
    const namespace = {
      String: {
        kind: 'typeConstructor' as const,
        output: { codecId: 'test/text@1', nativeType: 'text' },
      },
    };
    const lookup: CodecLookup = {
      get: (id: string) =>
        id === 'test/text@1'
          ? {
              id,
              encode: async (v: unknown) => v,
              decode: async (v: unknown) => v,
              encodeJson: (v: unknown) => v as JsonValue,
              decodeJson: (v: JsonValue) => v,
            }
          : undefined,
      targetTypesFor: (id: string) => (id === 'test/text@1' ? ['text'] : undefined),
      renderOutputTypeFor: () => undefined,
    };
    const errors = validateScalarTypeCodecIds(namespace, lookup);
    expect(errors).toEqual([]);
  });

  it('ignores parameterized constructors — only top-level zero-arg scalars are checked', () => {
    const namespace = {
      Vector: {
        kind: 'typeConstructor' as const,
        args: [{ kind: 'number' as const, name: 'dimensions' }],
        output: { codecId: 'missing/vector@1', nativeType: 'vector' },
      },
    };
    const lookup: CodecLookup = {
      get: () => undefined,
      targetTypesFor: () => undefined,
      renderOutputTypeFor: () => undefined,
    };
    expect(validateScalarTypeCodecIds(namespace, lookup)).toEqual([]);
  });
});

function makeExtension(
  id: string,
  deps: readonly string[] = [],
): { id: string; contractSpace?: { contractJson: { extensions?: Record<string, unknown> } } } {
  return {
    id,
    contractSpace:
      deps.length > 0
        ? {
            contractJson: {
              extensions: Object.fromEntries(deps.map((dep) => [dep, {}])),
            },
          }
        : { contractJson: {} },
  };
}

describe('buildExtensionLoadOrder', () => {
  it('returns an empty list when no extensions are provided', () => {
    expect(buildExtensionLoadOrder([])).toEqual([]);
  });

  it('returns a single extension with no dependencies in a one-element list', () => {
    const ext = makeExtension('a');
    expect(buildExtensionLoadOrder([ext])).toEqual(['a']);
  });

  it('places a dependency before the extension that depends on it (linear A→B→C chain)', () => {
    const a = makeExtension('a');
    const b = makeExtension('b', ['a']);
    const c = makeExtension('c', ['b']);
    const order = buildExtensionLoadOrder([c, b, a]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('handles an extension with multiple dependencies', () => {
    const a = makeExtension('a');
    const b = makeExtension('b');
    const c = makeExtension('c', ['a', 'b']);
    const order = buildExtensionLoadOrder([c, a, b]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('places a declared dependency before the pack that depends on it', () => {
    const a = makeExtension('a');
    const b = makeExtension('b', ['a']);
    const order = buildExtensionLoadOrder([b, a]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('throws when a declared dependency is absent from the provided set', () => {
    const b = makeExtension('b', ['missing-pack']);
    expect(() => buildExtensionLoadOrder([b])).toThrow(/missing dependency|add .* to extensions/i);
    expect(() => buildExtensionLoadOrder([b])).toThrow(/missing-pack/);
  });

  it('rejects a 2-cycle (A↔B) and names both members in the error', () => {
    const a = makeExtension('a', ['b']);
    const b = makeExtension('b', ['a']);
    expect(() => buildExtensionLoadOrder([a, b])).toThrow(/cycle/i);
    expect(() => buildExtensionLoadOrder([a, b])).toThrow(/a/);
    expect(() => buildExtensionLoadOrder([a, b])).toThrow(/b/);
  });

  it('rejects a 3-cycle (A→B→C→A) and names the cycle members in the error', () => {
    const a = makeExtension('a', ['c']);
    const b = makeExtension('b', ['a']);
    const c = makeExtension('c', ['b']);
    expect(() => buildExtensionLoadOrder([a, b, c])).toThrow(/cycle/i);
    const msg = (() => {
      try {
        buildExtensionLoadOrder([a, b, c]);
        return '';
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    })();
    expect(msg).toMatch(/a/);
    expect(msg).toMatch(/b/);
    expect(msg).toMatch(/c/);
  });

  it('extensions without contractSpace are treated as having no declared dependencies', () => {
    const plain = { id: 'plain' };
    const withSpace = makeExtension('withSpace', ['plain']);
    const order = buildExtensionLoadOrder([withSpace, plain]);
    expect(order.indexOf('plain')).toBeLessThan(order.indexOf('withSpace'));
  });

  it('extensions with contractSpace but empty extensions have no declared dependencies', () => {
    const a = makeExtension('a');
    const b = makeExtension('b');
    const order = buildExtensionLoadOrder([a, b]);
    expect(order).toContain('a');
    expect(order).toContain('b');
  });

  it('createControlStack throws on a 2-cycle in extension dependencies', () => {
    const a = {
      ...createDescriptor({ kind: 'extension' as const, id: 'ext-a' }),
      contractSpace: { contractJson: { extensions: { 'ext-b': {} } } },
    };
    const b = {
      ...createDescriptor({ kind: 'extension' as const, id: 'ext-b' }),
      contractSpace: { contractJson: { extensions: { 'ext-a': {} } } },
    };
    expect(() =>
      createControlStack(
        stubInput({
          family: createDescriptor({ kind: 'family', id: 'sql' }),
          target: createDescriptor({ kind: 'target', id: 'postgres' }),
          extensions: [a, b],
        }),
      ),
    ).toThrow(/cycle/i);
  });

  it('assembles extensions in dependency order even when input lists dependent before dependency', () => {
    const dep = {
      ...createDescriptor({ kind: 'extension' as const, id: 'dep' }),
      contractSpace: { contractJson: {} },
    };
    const consumer = {
      ...createDescriptor({ kind: 'extension' as const, id: 'consumer' }),
      contractSpace: { contractJson: { extensions: { dep: {} } } },
    };
    // Input order: consumer first (would fail ordering if not reordered)
    const stack = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'sql' }),
        target: createDescriptor({ kind: 'target', id: 'postgres' }),
        extensions: [consumer, dep],
      }),
    );
    const extIds = stack.extensions.map((e: { id: string }) => e.id);
    expect(extIds.indexOf('dep')).toBeLessThan(extIds.indexOf('consumer'));
  });
});

describe('createControlStack extensionContracts', () => {
  it('maps each contract-space extension id to its contractJson, in extensions order', () => {
    const depContract = { targetFamily: 'sql', space: 'dep' };
    const consumerContract = {
      targetFamily: 'sql',
      space: 'consumer',
      extensions: { dep: {} },
    };
    const dep = {
      ...createDescriptor({ kind: 'extension' as const, id: 'dep' }),
      contractSpace: { contractJson: depContract },
    };
    const consumer = {
      ...createDescriptor({ kind: 'extension' as const, id: 'consumer' }),
      contractSpace: { contractJson: consumerContract },
    };
    const stack = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'sql' }),
        target: createDescriptor({ kind: 'target', id: 'postgres' }),
        extensions: [consumer, dep],
      }),
    );

    expect([...stack.extensionContracts.keys()]).toEqual(stack.extensions.map((e) => e.id));
    expect(stack.extensionContracts.get('dep')).toBe(depContract);
    expect(stack.extensionContracts.get('consumer')).toBe(consumerContract);
  });

  it('omits extensions without a contract space', () => {
    const withSpaceContract = { targetFamily: 'sql', space: 'with-space' };
    const withSpace = {
      ...createDescriptor({ kind: 'extension' as const, id: 'with-space' }),
      contractSpace: { contractJson: withSpaceContract },
    };
    const plain = createDescriptor({ kind: 'extension' as const, id: 'plain' });
    const stack = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'sql' }),
        target: createDescriptor({ kind: 'target', id: 'postgres' }),
        extensions: [withSpace, plain],
      }),
    );

    expect(stack.extensionContracts.has('plain')).toBe(false);
    expect([...stack.extensionContracts.keys()]).toEqual(['with-space']);
  });

  it('is empty without extensions', () => {
    const stack = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'sql' }),
        target: createDescriptor({ kind: 'target', id: 'postgres' }),
      }),
    );

    expect(stack.extensionContracts.size).toBe(0);
  });

  it('extensionIds prefixes component ids and is not the extensions id list', () => {
    // Pins the difference so consumers deriving pack ids map over extensions
    // instead of reusing extensionIds.
    const ext = {
      ...createDescriptor({ kind: 'extension' as const, id: 'ext1' }),
      contractSpace: { contractJson: {} },
    };
    const stack = createControlStack(
      stubInput({
        family: createDescriptor({ kind: 'family', id: 'fam' }),
        target: createDescriptor({ kind: 'target', id: 'tgt' }),
        adapter: createDescriptor({ kind: 'adapter', id: 'adp' }),
        extensions: [ext],
      }),
    );

    const packIds = stack.extensions.map((e) => e.id);
    expect(packIds).toEqual(['ext1']);
    expect(stack.extensionIds).toEqual(['fam', 'tgt', 'adp', 'ext1']);
    expect(stack.extensionIds).not.toEqual(packIds);
  });
});
