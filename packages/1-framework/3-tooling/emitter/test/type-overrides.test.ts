import type {
  Contract,
  ContractField,
  ContractModelBase,
  StorageBase,
} from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  generateFieldTypeOverridesMap,
  renderCodecTypeOverride,
  renderTypeOverride,
  renderTypeOverridesMap,
  renderValueSetOverride,
  resolveFieldTypeOverride,
} from '../src/domain-type-generation';

const literalLookup: CodecLookup = {
  get: () => undefined,
  renderOutputTypeFor: (id, params) =>
    id === 'demo/vector@1' ? `Vector<${params['length']}>` : undefined,
  renderInputTypeFor: (id, params) =>
    id === 'demo/vector@1' ? `VectorInput<${params['length']}>` : undefined,
  renderValueLiteralFor: (_id, value) => (typeof value === 'string' ? `"${value}"` : undefined),
};

describe('renderValueSetOverride', () => {
  it('gives both sides when every value has a literal type', () => {
    expect(renderValueSetOverride(['low', 'high'], 'demo/text@1', literalLookup)).toEqual({
      output: '"low" | "high"',
      input: '"low" | "high"',
    });
  });

  it('keeps the input side when only it has literal types', () => {
    const inputOnly: CodecLookup = {
      ...literalLookup,
      renderValueLiteralFor: (_id, value, side) =>
        side === 'input' && typeof value === 'string' ? `"${value}"` : undefined,
    };
    expect(renderValueSetOverride(['low'], 'demo/text@1', inputOnly)).toEqual({ input: '"low"' });
  });
});

describe('renderCodecTypeOverride', () => {
  it('gives the type text the codec renders on each side', () => {
    expect(renderCodecTypeOverride('demo/vector@1', { length: 3 }, literalLookup)).toEqual({
      output: 'Vector<3>',
      input: 'VectorInput<3>',
    });
  });

  it('gives nothing without type parameters, without a lookup, or for a codec that renders nothing', () => {
    expect([
      renderCodecTypeOverride('demo/vector@1', undefined, literalLookup),
      renderCodecTypeOverride('demo/vector@1', { length: 3 }, undefined),
      renderCodecTypeOverride('demo/text@1', { length: 3 }, literalLookup),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it('leaves out text that is not a safe type expression', () => {
    const unsafe: CodecLookup = {
      get: () => undefined,
      renderOutputTypeFor: () => 'import("fs")',
      renderInputTypeFor: () => 'string',
    };
    expect(renderCodecTypeOverride('demo/x@1', { a: 1 }, unsafe)).toEqual({ input: 'string' });
  });
});

const addressRef = {
  kind: 'valueObject',
  plane: 'storage',
  namespaceId: 'shared',
  entityKind: 'valueObject',
  entityName: 'Address',
} as const;

describe('resolveFieldTypeOverride', () => {
  const scalar = (typeParams?: Record<string, unknown>): ContractField => ({
    nullable: true,
    many: { elementNullable: false },
    type: {
      kind: 'scalar',
      codecId: 'demo/vector@1',
      ...(typeParams === undefined ? {} : { typeParams }),
    },
  });

  it('takes the value set before the codec, without the field modifiers', () => {
    expect(
      resolveFieldTypeOverride(scalar({ length: 3 }), literalLookup, {
        encodedValues: ['a', 'b'],
        codecId: 'demo/text@1',
      }),
    ).toEqual({ output: '"a" | "b"', input: '"a" | "b"' });
  });

  it('falls back to the codec text when the value set has no literal types', () => {
    expect(
      resolveFieldTypeOverride(scalar({ length: 3 }), literalLookup, {
        encodedValues: [1],
        codecId: 'demo/int@1',
      }),
    ).toEqual({ output: 'Vector<3>', input: 'VectorInput<3>' });
  });

  it('gives nothing for a scalar whose type parameters are empty or absent', () => {
    expect([
      resolveFieldTypeOverride(scalar({}), literalLookup, undefined),
      resolveFieldTypeOverride(scalar(), literalLookup, undefined),
    ]).toEqual([undefined, undefined]);
  });

  it('gives nothing for a value object or union field, which the shared generic types itself', () => {
    const valueObject: ContractField = {
      nullable: true,
      many: false,
      type: addressRef,
    };
    const union: ContractField = {
      nullable: false,
      type: {
        kind: 'union',
        members: [{ kind: 'scalar', codecId: 'demo/text@1' }, addressRef],
      },
    };
    expect([
      resolveFieldTypeOverride(valueObject, literalLookup, undefined),
      resolveFieldTypeOverride(union, literalLookup, {
        encodedValues: ['a'],
        codecId: 'demo/text@1',
      }),
    ]).toEqual([undefined, undefined]);
  });
});

describe('renderTypeOverride', () => {
  it('writes only the sides an override has', () => {
    expect([
      renderTypeOverride({ output: 'A' }),
      renderTypeOverride({ input: 'B' }),
      renderTypeOverride({ output: 'A', input: 'B' }),
    ]).toEqual([
      '{ readonly output: A }',
      '{ readonly input: B }',
      '{ readonly output: A; readonly input: B }',
    ]);
  });
});

describe('renderTypeOverridesMap', () => {
  it('orders every level by name and leaves out entries with no override', () => {
    expect(
      renderTypeOverridesMap([
        [['public', 'User', 'role'], { output: 'R' }],
        [['auth', 'Session', 'id'], undefined],
        [['public', 'Post', 'state'], { input: 'S' }],
        [['public', 'User', 'kind'], { output: 'K', input: 'K' }],
        [['auth', 'Account', 'tier'], { output: 'T' }],
      ]),
    ).toBe(
      '{ readonly auth: { readonly Account: { readonly tier: { readonly output: T } } }; readonly public: { readonly Post: { readonly state: { readonly input: S } }; readonly User: { readonly kind: { readonly output: K; readonly input: K }; readonly role: { readonly output: R } } } }',
    );
  });

  it('is empty without overrides', () => {
    expect(renderTypeOverridesMap([[['public', 'User', 'id'], undefined]])).toBe('{  }');
  });

  it('nests as many levels as the path has', () => {
    expect(renderTypeOverridesMap([[['public', 'models', 'User', 'role'], { output: 'R' }]])).toBe(
      '{ readonly public: { readonly models: { readonly User: { readonly role: { readonly output: R } } } } }',
    );
  });
});

const kindEnum = {
  codecId: 'demo/text@1',
  members: [
    { name: 'Home', value: 'home' },
    { name: 'Work', value: 'work' },
  ],
} as const;

const kindRef = {
  plane: 'domain',
  entityKind: 'enum',
  namespaceId: 'public',
  entityName: 'Kind',
} as const;

function model(fields: Record<string, ContractField>): ContractModelBase {
  return { fields, relations: {}, storage: {} };
}

describe('generateFieldTypeOverridesMap', () => {
  it('collects the override of each model field, from its value set or its codec', () => {
    const contract = {
      domain: {
        namespaces: {
          public: {
            models: {
              User: model({
                id: {
                  nullable: false,
                  many: false,
                  type: { kind: 'scalar', codecId: 'demo/int@1' },
                },
                mood: {
                  nullable: false,
                  many: false,
                  type: { kind: 'scalar', codecId: 'demo/text@1' },
                },
                embedding: {
                  nullable: false,
                  many: false,
                  type: { kind: 'scalar', codecId: 'demo/vector@1', typeParams: { length: 2 } },
                },
              }),
            },
          },
        },
      },
      storage: { namespaces: {} },
    } satisfies Pick<Contract, 'domain'> & { storage: Pick<StorageBase, 'namespaces'> };
    const resolveValueSet = (_model: string, field: string) =>
      field === 'mood' ? { encodedValues: ['up', 'down'], codecId: 'demo/text@1' } : undefined;

    expect(generateFieldTypeOverridesMap(contract, literalLookup, resolveValueSet)).toBe(
      '{ readonly public: { readonly models: { readonly User: { readonly embedding: { readonly output: Vector<2>; readonly input: VectorInput<2> }; readonly mood: { readonly output: "up" | "down"; readonly input: "up" | "down" } } } } }',
    );
  });

  it('reads a reference to a domain enum from the domain, for a model field, without asking the family', () => {
    const contract = {
      domain: {
        namespaces: {
          public: {
            enum: { Kind: kindEnum },
            models: {
              User: model({
                kind: {
                  nullable: false,
                  many: false,
                  type: { kind: 'scalar', codecId: 'demo/text@1' },
                  valueSet: kindRef,
                },
              }),
            },
          },
        },
      },
      storage: { namespaces: {} },
    } satisfies Pick<Contract, 'domain'> & { storage: Pick<StorageBase, 'namespaces'> };
    const resolveValueSet = () => ({ encodedValues: ['storage'], codecId: 'demo/text@1' });

    expect(generateFieldTypeOverridesMap(contract, literalLookup, resolveValueSet)).toBe(
      '{ readonly public: { readonly models: { readonly User: { readonly kind: { readonly output: "home" | "work"; readonly input: "home" | "work" } } } } }',
    );
  });

  it('collects the override of each value object field, keyed by its storage namespace, from the storage value set its value set names or its codec text', () => {
    const contract = {
      domain: { namespaces: { public: { models: {} } } },
      storage: {
        namespaces: {
          shared: {
            id: 'shared',
            entries: {
              valueSet: { Kind: { values: ['home', 'work'] } },
              valueObject: {
                Address: {
                  fields: {
                    street: { nullable: false, type: { kind: 'scalar', codecId: 'demo/text@1' } },
                    kind: {
                      nullable: true,
                      type: { kind: 'scalar', codecId: 'demo/text@1' },
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: 'shared',
                        entityName: 'Kind',
                      },
                    },
                    embedding: {
                      nullable: false,
                      type: { kind: 'scalar', codecId: 'demo/vector@1', typeParams: { length: 2 } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as const satisfies Pick<Contract, 'domain'> & { storage: Pick<StorageBase, 'namespaces'> };

    expect(generateFieldTypeOverridesMap(contract, literalLookup, undefined)).toBe(
      '{ readonly shared: { readonly valueObjects: { readonly Address: { readonly embedding: { readonly output: Vector<2>; readonly input: VectorInput<2> }; readonly kind: { readonly output: "home" | "work"; readonly input: "home" | "work" } } } } }',
    );
  });

  it('gives no override for a value object field whose value set storage does not have', () => {
    const contract = {
      domain: { namespaces: { public: { models: {} } } },
      storage: {
        namespaces: {
          shared: {
            id: 'shared',
            entries: {
              valueObject: {
                Address: {
                  fields: {
                    kind: {
                      nullable: false,
                      type: { kind: 'scalar', codecId: 'demo/text@1' },
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: 'shared',
                        entityName: 'Kind',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as const satisfies Pick<Contract, 'domain'> & { storage: Pick<StorageBase, 'namespaces'> };
    const resolveValueSet = () => ({ encodedValues: ['storage'], codecId: 'demo/text@1' });

    expect(generateFieldTypeOverridesMap(contract, literalLookup, resolveValueSet)).toBe('{  }');
  });
});
