import type { ContractField, ContractModel, ContractValueObject } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { blindCast } from '@internal/utils/casts';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it, vi } from 'vitest';
import {
  deduplicateImports,
  type FieldValueSetResolver,
  generateBothFieldTypesMaps,
  generateCodecTypeIntersection,
  generateContractFieldDescriptor,
  generateFieldInputTypesMap,
  generateFieldOutputTypesMap,
  generateFieldResolvedType,
  generateFieldTypesMapsByNamespace,
  generateHashTypeAliases,
  generateImportLines,
  generateModelFieldsType,
  generateModelRelationsType,
  generateModelsType,
  generateRootsType,
  generateValueObjectsDescriptorType,
  generateValueObjectType,
  generateValueObjectTypeAliases,
  renderValueSetType,
  resolveFieldType,
  serializeExecutionType,
  serializeObjectKey,
  serializeValue,
} from '../src/domain-type-generation';

/**
 * Mirrors the real primitive codecs' `renderValueLiteral`: identity codecs render the encoded value
 * directly as a literal. Tests pass this so the value-set field emit produces literal unions.
 */
function literalCodecLookup(): CodecLookup {
  const renderPrimitiveLiteral = (value: unknown): string | undefined => {
    if (typeof value === 'string') return serializeValue(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
  };
  return {
    get: () => undefined,
    targetTypesFor: () => undefined,
    renderOutputTypeFor: () => undefined,
    renderValueLiteralFor: (_id, value) => renderPrimitiveLiteral(value),
  };
}

describe('serializeValue', () => {
  it('serializes null', () => {
    expect(serializeValue(null)).toBe('null');
  });

  it('serializes undefined', () => {
    expect(serializeValue(undefined)).toBe('undefined');
  });

  it('serializes strings as double-quoted literals', () => {
    expect(serializeValue('hello')).toBe('"hello"');
  });

  it('escapes backslashes and double quotes in strings', () => {
    expect(serializeValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(serializeValue("it's")).toBe('"it\'s"');
    expect(serializeValue('back\\slash')).toBe('"back\\\\slash"');
  });

  it('serializes numbers', () => {
    expect(serializeValue(42)).toBe('42');
    expect(serializeValue(3.14)).toBe('3.14');
  });

  it('serializes booleans', () => {
    expect(serializeValue(true)).toBe('true');
    expect(serializeValue(false)).toBe('false');
  });

  it('serializes bigints', () => {
    expect(serializeValue(BigInt(123))).toBe('123n');
  });

  it('serializes arrays as readonly tuples', () => {
    expect(serializeValue(['a', 'b'])).toBe('readonly ["a", "b"]');
  });

  it('serializes objects with readonly properties', () => {
    expect(serializeValue({ key: 'val' })).toBe('{ readonly key: "val" }');
  });

  it('serializes nested objects', () => {
    const result = serializeValue({ a: { b: 1 } });
    expect(result).toBe('{ readonly a: { readonly b: 1 } }');
  });

  it('returns unknown for unsupported types', () => {
    expect(serializeValue(Symbol('test'))).toBe('unknown');
  });

  describe('injection safety', () => {
    // Lock the escape behavior so attacker-controlled (or merely weird) strings in a schema.prisma cannot break out of the emitted double-quoted literal and inject arbitrary TypeScript into contract.d.ts.

    it('escapes a string attempting to terminate the literal', () => {
      const injected = 'x"; export let foo = "bar';
      const serialized = serializeValue(injected);
      expect(serialized).toBe('"x\\"; export let foo = \\"bar"');
      // The serialized form is a single valid string literal: exactly two outer double quotes, and every inner double quote is backslash-escaped.
      expect(serialized.match(/(?<!\\)"/g)?.length).toBe(2);
    });

    it('escapes backslash-terminated strings (no lookahead break-out)', () => {
      expect(serializeValue('ends with \\')).toBe('"ends with \\\\"');
      expect(serializeValue('double\\\\back')).toBe('"double\\\\\\\\back"');
    });

    it('escapes control characters and line separators', () => {
      // Raw line terminators inside a quoted literal are a syntax error,
      // and U+2028/U+2029 terminate lines in legacy parsers.
      expect(serializeValue('a\u2028b')).toBe('"a\\u2028b"');
      expect(serializeValue('a\u2029b')).toBe('"a\\u2029b"');
      expect(serializeValue('a\nb')).toBe('"a\\nb"');
      expect(serializeValue('a\rb')).toBe('"a\\rb"');
      expect(serializeValue('a\tb')).toBe('"a\\tb"');
      expect(serializeValue('ab')).toBe('"a\\u0007b"');
    });

    it('quotes object keys that look like identifier bypass attempts', () => {
      expect(serializeObjectKey('k"; injected: "v')).toBe('"k\\"; injected: \\"v"');
      expect(serializeObjectKey('')).toBe('""');
    });
  });
});

describe('serializeObjectKey', () => {
  it('passes through valid identifiers', () => {
    expect(serializeObjectKey('foo')).toBe('foo');
    expect(serializeObjectKey('_bar')).toBe('_bar');
    expect(serializeObjectKey('$baz')).toBe('$baz');
    expect(serializeObjectKey('camelCase')).toBe('camelCase');
  });

  it('quotes keys with special characters', () => {
    expect(serializeObjectKey('has space')).toBe('"has space"');
    expect(serializeObjectKey('has-dash')).toBe('"has-dash"');
    expect(serializeObjectKey('ns/name@1')).toBe('"ns/name@1"');
    expect(serializeObjectKey('has\nnewline')).toBe('"has\\nnewline"');
    expect(serializeObjectKey('1leading-digit')).toBe('"1leading-digit"');
  });
});

describe('generateModelFieldsType', () => {
  it('returns Record<string, never> for empty fields', () => {
    expect(generateModelFieldsType({})).toBe('Record<string, never>');
  });

  it('generates field with type descriptor and nullable', () => {
    const result = generateModelFieldsType({
      name: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false },
    });
    expect(result).toBe(
      '{ readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "sql/text@1" } } }',
    );
  });

  it('generates multiple fields', () => {
    const result = generateModelFieldsType({
      id: { type: { kind: 'scalar', codecId: 'sql/int4@1' }, nullable: false },
      email: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: true },
    });
    expect(result).toContain(
      'readonly id: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "sql/int4@1" } }',
    );
    expect(result).toContain(
      'readonly email: { readonly nullable: true; readonly type: { readonly kind: "scalar"; readonly codecId: "sql/text@1" } }',
    );
  });

  it('quotes keys with special characters', () => {
    const result = generateModelFieldsType({
      'field-name': { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false },
    });
    expect(result).toContain('readonly "field-name":');
  });
});

describe('generateModelsType', () => {
  const noopStorage = () => 'Record<string, never>';

  function makeModel(overrides: Partial<ContractModel> = {}): ContractModel {
    return {
      fields: {},
      relations: {},
      storage: { storageHash: 'test' },
      ...overrides,
    };
  }

  it('returns Record<string, never> for empty models', () => {
    expect(generateModelsType({}, noopStorage)).toBe('Record<string, never>');
  });

  it('generates model with fields, relations, and storage', () => {
    const models: Record<string, ContractModel> = {
      User: makeModel({
        fields: { name: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false } },
        relations: { posts: { to: crossRef('Post'), cardinality: '1:N' } },
      }),
    };
    const result = generateModelsType(models, () => '{ readonly table: "users" }');
    expect(result).toContain('readonly User:');
    expect(result).toContain('readonly codecId: "sql/text@1"');
    expect(result).toContain('readonly namespace: "__unbound__"');
    expect(result).toContain('readonly model: "Post"');
    expect(result).toContain('readonly table: "users"');
  });

  it('quotes model names that are not bare identifiers', () => {
    const models: Record<string, ContractModel> = { 'Data Row': makeModel() };
    expect(generateModelsType(models, noopStorage)).toContain('readonly "Data Row": {');
  });

  it('sorts models by name', () => {
    const models: Record<string, ContractModel> = {
      Zebra: makeModel(),
      Alpha: makeModel(),
    };
    const result = generateModelsType(models, noopStorage);
    const alphaIdx = result.indexOf('Alpha');
    const zebraIdx = result.indexOf('Zebra');
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it('passes modelName and model to the storage callback', () => {
    const model = makeModel();
    const models: Record<string, ContractModel> = { User: model };
    const storageFn = vi.fn(() => 'Record<string, never>');
    generateModelsType(models, storageFn);
    expect(storageFn).toHaveBeenCalledWith('User', model);
  });

  it('includes owner when present', () => {
    const models: Record<string, ContractModel> = {
      Comment: makeModel({ owner: 'Post' }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain('readonly owner: "Post"');
  });

  it('includes discriminator when present', () => {
    const models: Record<string, ContractModel> = {
      Animal: makeModel({ discriminator: { field: 'type' } }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain('readonly discriminator: { readonly field: "type" }');
  });

  it('includes variants when present', () => {
    const models: Record<string, ContractModel> = {
      Animal: makeModel({ variants: { Dog: { value: 'dog' }, Cat: { value: 'cat' } } }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain('readonly variants:');
    expect(result).toContain('readonly Dog:');
    expect(result).toContain('readonly Cat:');
  });

  it('includes base when present', () => {
    const models: Record<string, ContractModel> = {
      Dog: makeModel({ base: crossRef('Animal') }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain('readonly namespace: "__unbound__"');
    expect(result).toContain('readonly model: "Animal"');
  });
});

describe('generateRootsType', () => {
  it('returns Record<string, never> for undefined roots', () => {
    expect(generateRootsType(undefined)).toBe('Record<string, never>');
  });

  it('returns Record<string, never> for empty roots', () => {
    expect(generateRootsType({})).toBe('Record<string, never>');
  });

  it('generates literal object type for roots', () => {
    const result = generateRootsType({ users: crossRef('User'), posts: crossRef('Post') });
    expect(result).toContain(
      'readonly users: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "User" }',
    );
    expect(result).toContain(
      'readonly posts: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }',
    );
  });
});

describe('generateModelRelationsType', () => {
  it('returns empty object for empty relations', () => {
    expect(generateModelRelationsType({})).toBe('Record<string, never>');
  });

  it('generates relation with to and cardinality', () => {
    const result = generateModelRelationsType({
      posts: { to: crossRef('Post'), cardinality: '1:N' },
    });
    expect(result).toContain('readonly namespace: "__unbound__"');
    expect(result).toContain('readonly model: "Post"');
    expect(result).toContain('readonly cardinality: "1:N"');
  });

  it('generates relation with on (localFields/targetFields)', () => {
    const result = generateModelRelationsType({
      author: {
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['authorId'], targetFields: ['_id'] },
      },
    });
    expect(result).toContain('readonly model: "User"');
    expect(result).toContain('readonly cardinality: "N:1"');
    expect(result).toContain('readonly localFields: readonly ["authorId"]');
    expect(result).toContain('readonly targetFields: readonly ["_id"]');
  });

  it.each([true, false])('renders nullable: %s on a to-one relation', (nullable) => {
    const result = generateModelRelationsType({
      author: {
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable,
        on: { localFields: ['authorId'], targetFields: ['_id'] },
      },
    });
    expect(result).toContain(`readonly cardinality: "N:1"; readonly nullable: ${nullable};`);
  });

  it('skips non-object relations', () => {
    const result = generateModelRelationsType({
      bad: 'not an object' as unknown as Record<string, unknown>,
    });
    expect(result).toBe('Record<string, never>');
  });

  it('generates multiple relations', () => {
    const result = generateModelRelationsType({
      author: { to: crossRef('User'), cardinality: 'N:1' },
      comments: { to: crossRef('Comment'), cardinality: '1:N' },
    });
    expect(result).toContain('readonly author:');
    expect(result).toContain('readonly comments:');
  });

  it('omits to when missing from relation', () => {
    const result = generateModelRelationsType({
      rel: { cardinality: '1:N' },
    });
    expect(result).toContain('readonly cardinality: "1:N"');
    expect(result).not.toContain('readonly to:');
  });

  it('omits cardinality when missing from relation', () => {
    const result = generateModelRelationsType({
      rel: { to: crossRef('Post') },
    });
    expect(result).toContain('readonly model: "Post"');
    expect(result).not.toContain('readonly cardinality:');
  });

  it('skips relation object with no recognized properties', () => {
    const result = generateModelRelationsType({
      empty: { unknown: true },
    });
    expect(result).toBe('Record<string, never>');
  });

  it('throws CONTRACT.RELATION_INVALID when relation has on but missing localFields/targetFields', () => {
    let thrown: unknown;
    try {
      generateModelRelationsType({
        author: {
          to: 'User',
          cardinality: 'N:1',
          on: { parentCols: ['userId'], childCols: ['id'] },
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ code: 'CONTRACT.RELATION_INVALID' });
    expect((thrown as Error).message).toContain('missing localFields or targetFields');
  });

  it('emits never for a cross-space relation (Option B non-navigable)', () => {
    const crossSpaceRef = { namespace: '__unbound__', model: 'User', space: 'supabase' };
    const result = generateModelRelationsType({
      user: {
        to: crossSpaceRef,
        cardinality: 'N:1',
        on: { localFields: ['userId'], targetFields: ['id'] },
      },
    });
    expect(result).toBe('{ readonly user: never }');
  });

  it('emits never only for cross-space relations; local relations are unaffected', () => {
    const localRef = crossRef('Post');
    const crossSpaceRef = { namespace: 'auth', model: 'User', space: 'supabase' };
    const result = generateModelRelationsType({
      posts: { to: localRef, cardinality: '1:N' },
      user: { to: crossSpaceRef, cardinality: 'N:1' },
    });
    expect(result).toContain('readonly posts: {');
    expect(result).toContain('readonly user: never');
    // local relation should not be never
    expect(result).not.toContain('readonly posts: never');
  });

  it('local relation to.space is absent and the relation is not never', () => {
    const result = generateModelRelationsType({
      author: { to: crossRef('User'), cardinality: 'N:1' },
    });
    // local relation must not be emitted as never
    expect(result).not.toContain('readonly author: never');
    // the CrossReference for a local relation must not include a `space` property
    expect(result).not.toContain('readonly space:');
  });

  it('emits through literal for N:M relations with junction metadata', () => {
    const result = generateModelRelationsType({
      tags: {
        to: crossRef('Tag'),
        cardinality: 'N:M',
        through: {
          table: 'post_tags',
          namespaceId: 'public',
          parentColumns: ['postId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
    });
    expect(result).toContain('readonly model: "Tag"');
    expect(result).toContain('readonly cardinality: "N:M"');
    expect(result).toContain('readonly through:');
    expect(result).toContain('readonly table: "post_tags"');
    expect(result).toContain('readonly namespaceId: "public"');
    expect(result).toContain('readonly parentColumns: readonly ["postId"]');
    expect(result).toContain('readonly childColumns: readonly ["tagId"]');
    expect(result).toContain('readonly targetColumns: readonly ["id"]');
  });

  it('emits through with multi-column keys', () => {
    const result = generateModelRelationsType({
      roles: {
        to: crossRef('Role'),
        cardinality: 'N:M',
        through: {
          table: 'user_roles',
          namespaceId: 'public',
          parentColumns: ['userId', 'tenantId'],
          childColumns: ['roleId'],
          targetColumns: ['id'],
        },
      },
    });
    expect(result).toContain('readonly parentColumns: readonly ["userId", "tenantId"]');
  });

  it('omits through when not present (non-N:M relations unchanged)', () => {
    const result = generateModelRelationsType({
      author: {
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['authorId'], targetFields: ['id'] },
      },
    });
    expect(result).not.toContain('readonly through:');
    expect(result).toContain('readonly localFields: readonly ["authorId"]');
  });
});

describe('deduplicateImports', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateImports([])).toEqual([]);
  });

  it('keeps unique imports', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-a', named: 'CodecTypes', alias: 'A' },
      { package: 'pkg-b', named: 'CodecTypes', alias: 'B' },
    ];
    expect(deduplicateImports(imports)).toHaveLength(2);
  });

  it('deduplicates by package+named (first wins)', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-a', named: 'CodecTypes', alias: 'First' },
      { package: 'pkg-a', named: 'CodecTypes', alias: 'Second' },
    ];
    const result = deduplicateImports(imports);
    expect(result).toHaveLength(1);
    expect(result[0]!.alias).toBe('First');
  });

  it('preserves insertion order', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-b', named: 'X', alias: 'X' },
      { package: 'pkg-a', named: 'Y', alias: 'Y' },
    ];
    const result = deduplicateImports(imports);
    expect(result[0]!.package).toBe('pkg-b');
    expect(result[1]!.package).toBe('pkg-a');
  });
});

describe('generateImportLines', () => {
  it('generates import with alias', () => {
    const imports: TypesImportSpec[] = [
      { package: '@internal/adapter', named: 'CodecTypes', alias: 'PgCodecTypes' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual(["import type { CodecTypes as PgCodecTypes } from '@internal/adapter';"]);
  });

  it('simplifies import when named === alias', () => {
    const imports: TypesImportSpec[] = [
      { package: '@internal/adapter', named: 'Vector', alias: 'Vector' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual(["import type { Vector } from '@internal/adapter';"]);
  });

  it('merges multiple named imports from the same package onto one line', () => {
    const imports: TypesImportSpec[] = [
      {
        package: '@internal/adapter-mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
      { package: '@internal/adapter-mongo/codec-types', named: 'Vector', alias: 'Vector' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual([
      "import type { CodecTypes as MongoCodecTypes, Vector } from '@internal/adapter-mongo/codec-types';",
    ]);
  });

  it('emits one line per distinct package, sorted by specifier', () => {
    const imports: TypesImportSpec[] = [
      { package: '@scope/zeta/codec-types', named: 'Numeric', alias: 'Numeric' },
      { package: '@scope/zeta/codec-types', named: 'CodecTypes', alias: 'ZetaTypes' },
      { package: '@scope/alpha/operation-types', named: 'QueryOperationTypes', alias: 'AlphaOps' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual([
      "import type { QueryOperationTypes as AlphaOps } from '@scope/alpha/operation-types';",
      "import type { CodecTypes as ZetaTypes, Numeric } from '@scope/zeta/codec-types';",
    ]);
  });
});

describe('generateCodecTypeIntersection', () => {
  it('returns Record<string, never> when no matching imports', () => {
    expect(generateCodecTypeIntersection([], 'CodecTypes')).toBe('Record<string, never>');
  });

  it('returns single alias when one match', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg', named: 'CodecTypes', alias: 'PgCodecTypes' },
    ];
    expect(generateCodecTypeIntersection(imports, 'CodecTypes')).toBe('PgCodecTypes');
  });

  it('returns intersection when multiple matches', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-a', named: 'CodecTypes', alias: 'A' },
      { package: 'pkg-b', named: 'CodecTypes', alias: 'B' },
    ];
    expect(generateCodecTypeIntersection(imports, 'CodecTypes')).toBe('A & B');
  });

  it('filters by named parameter', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg', named: 'CodecTypes', alias: 'CT' },
      { package: 'pkg', named: 'OperationTypes', alias: 'OT' },
    ];
    expect(generateCodecTypeIntersection(imports, 'OperationTypes')).toBe('OT');
  });
});

describe('generateHashTypeAliases', () => {
  it('generates storage and profile hash aliases', () => {
    const result = generateHashTypeAliases({
      storageHash: 'abc123',
      profileHash: 'def456',
    });
    expect(result).toContain('StorageHashBase<"abc123">');
    expect(result).toContain('ProfileHashBase<"def456">');
  });

  it('generates concrete execution hash when provided', () => {
    const result = generateHashTypeAliases({
      storageHash: 'abc',
      executionHash: 'exec',
      profileHash: 'prof',
    });
    expect(result).toContain('ExecutionHashBase<"exec">');
  });

  it('generates generic execution hash when not provided', () => {
    const result = generateHashTypeAliases({
      storageHash: 'abc',
      profileHash: 'prof',
    });
    expect(result).toContain('ExecutionHashBase<string>');
  });
});

describe('serializeExecutionType', () => {
  it('uses ExecutionHash alias instead of literal hash value', () => {
    const result = serializeExecutionType({
      executionHash: 'abc123',
      mutations: { defaults: [] },
    });
    expect(result).toContain('readonly executionHash: ExecutionHash');
    expect(result).not.toContain('abc123');
  });

  it('serializes non-hash fields normally', () => {
    const result = serializeExecutionType({
      executionHash: 'abc123',
      mutations: { defaults: [{ kind: 'autoIncrement' }] },
    });
    expect(result).toContain('readonly mutations:');
    expect(result).toContain('readonly kind: "autoIncrement"');
  });
});

describe('generateFieldResolvedType', () => {
  it('generates CodecTypes lookup for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
    };
    expect(generateFieldResolvedType(field)).toBe('CodecTypes["mongo/string@1"]["output"]');
  });

  it('generates suffixed type reference for value object fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
    };
    expect(generateFieldResolvedType(field)).toBe('AddressOutput');
  });

  it('wraps in ReadonlyArray for many: true', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: true,
    };
    expect(generateFieldResolvedType(field)).toBe('ReadonlyArray<AddressOutput>');
  });

  it('wraps in Readonly<Record> for dict: true', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      dict: true,
    };
    expect(generateFieldResolvedType(field)).toBe(
      'Readonly<Record<string, CodecTypes["mongo/string@1"]["output"]>>',
    );
  });

  it('appends | null for nullable: true', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
    };
    expect(generateFieldResolvedType(field)).toBe('AddressOutput | null');
  });

  it('combines many and nullable', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
      many: true,
    };
    expect(generateFieldResolvedType(field)).toBe('ReadonlyArray<AddressOutput> | null');
  });

  it('handles union types with output side', () => {
    const field: ContractField = {
      nullable: false,
      type: {
        kind: 'union',
        members: [
          { kind: 'scalar', codecId: 'mongo/string@1' },
          { kind: 'valueObject', name: 'Address' },
        ],
      },
    };
    expect(generateFieldResolvedType(field)).toBe(
      'CodecTypes["mongo/string@1"]["output"] | AddressOutput',
    );
  });

  it('generates input side for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
    };
    expect(generateFieldResolvedType(field, undefined, 'input')).toBe(
      'CodecTypes["mongo/string@1"]["input"]',
    );
  });

  it('generates input-suffixed type for value object fields on input side', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Price' },
    };
    expect(generateFieldResolvedType(field, undefined, 'input')).toBe('PriceInput');
  });

  it('generates input side for union types', () => {
    const field: ContractField = {
      nullable: false,
      type: {
        kind: 'union',
        members: [
          { kind: 'scalar', codecId: 'mongo/string@1' },
          { kind: 'valueObject', name: 'Address' },
        ],
      },
    };
    expect(generateFieldResolvedType(field, undefined, 'input')).toBe(
      'CodecTypes["mongo/string@1"]["input"] | AddressInput',
    );
  });
});

describe('generateValueObjectType', () => {
  const addressVo: ContractValueObject = {
    fields: {
      street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
      city: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
      zip: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
    },
  };
  const valueObjects: Record<string, ContractValueObject> = { Address: addressVo };

  it('generates object type with all fields', () => {
    const result = generateValueObjectType('Address', addressVo, valueObjects);
    expect(result).toContain('readonly street: CodecTypes["mongo/string@1"]["output"]');
    expect(result).toContain('readonly city: CodecTypes["mongo/string@1"]["output"]');
    expect(result).toContain('readonly zip: CodecTypes["mongo/string@1"]["output"]');
  });

  it('handles value object field referencing another value object (output)', () => {
    const companyVo: ContractValueObject = {
      fields: {
        name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
      },
    };
    const vos = { ...valueObjects, Company: companyVo };
    const result = generateValueObjectType('Company', companyVo, vos);
    expect(result).toContain('readonly address: AddressOutput');
  });

  it('handles value object field referencing another value object (input)', () => {
    const companyVo: ContractValueObject = {
      fields: {
        name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
      },
    };
    const vos = { ...valueObjects, Company: companyVo };
    const result = generateValueObjectType('Company', companyVo, vos, 'input');
    expect(result).toContain('readonly address: AddressInput');
  });

  it('handles self-referencing value object (no infinite recursion)', () => {
    const navItemVo: ContractValueObject = {
      fields: {
        label: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        children: {
          nullable: false,
          type: { kind: 'valueObject', name: 'NavItem' },
          many: true,
        },
      },
    };
    const vos = { NavItem: navItemVo };
    const result = generateValueObjectType('NavItem', navItemVo, vos);
    expect(result).toContain('readonly children: ReadonlyArray<NavItemOutput>');
  });

  it('returns Record<string, never> for empty value object', () => {
    const emptyVo: ContractValueObject = { fields: {} };
    expect(generateValueObjectType('Empty', emptyVo, {})).toBe('Record<string, never>');
  });
});

describe('generateContractFieldDescriptor', () => {
  it('generates scalar field descriptor', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
    };
    const result = generateContractFieldDescriptor('name', field);
    expect(result).toBe(
      'readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
  });

  it('generates value object field descriptor', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
    };
    const result = generateContractFieldDescriptor('homeAddress', field);
    expect(result).toBe(
      'readonly homeAddress: { readonly nullable: true; readonly type: { readonly kind: "valueObject"; readonly name: "Address" } }',
    );
  });

  it('includes many modifier', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: true,
    };
    const result = generateContractFieldDescriptor('addresses', field);
    expect(result).toContain('; readonly many: true');
  });

  it('includes dict modifier', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      dict: true,
    };
    const result = generateContractFieldDescriptor('labels', field);
    expect(result).toContain('; readonly dict: true');
  });

  it('includes typeParams for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/vector@1', typeParams: { length: 1536 } },
    };
    const result = generateContractFieldDescriptor('embedding', field);
    expect(result).toContain('readonly typeParams: { readonly length: 1536 }');
  });
});

describe('generateValueObjectsDescriptorType', () => {
  it('returns Record<string, never> for undefined', () => {
    expect(generateValueObjectsDescriptorType(undefined)).toBe('Record<string, never>');
  });

  it('returns Record<string, never> for empty', () => {
    expect(generateValueObjectsDescriptorType({})).toBe('Record<string, never>');
  });

  it('generates descriptor with fields for each value object', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
      },
    };
    const result = generateValueObjectsDescriptorType(valueObjects);
    expect(result).toContain('readonly Address: { readonly fields:');
    expect(result).toContain('readonly kind: "scalar"');
    expect(result).toContain('readonly codecId: "mongo/string@1"');
  });
});

describe('generateValueObjectTypeAliases', () => {
  it('returns empty string for undefined', () => {
    expect(generateValueObjectTypeAliases(undefined)).toBe('');
  });

  it('returns empty string for empty', () => {
    expect(generateValueObjectTypeAliases({})).toBe('');
  });

  it('generates output and input type alias pairs for each value object', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
      },
    };
    const result = generateValueObjectTypeAliases(valueObjects);
    expect(result).toContain('export type AddressOutput =');
    expect(result).toContain('export type AddressInput =');
    expect(result).toContain('readonly street: CodecTypes["mongo/string@1"]["output"]');
    expect(result).toContain('readonly street: CodecTypes["mongo/string@1"]["input"]');
    expect(result).not.toMatch(/export type Address =/);
  });

  it('generates multiple type alias pairs', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
      },
      GeoPoint: {
        fields: {
          lat: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/double@1' } },
          lng: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/double@1' } },
        },
      },
    };
    const result = generateValueObjectTypeAliases(valueObjects);
    expect(result).toContain('export type AddressOutput =');
    expect(result).toContain('export type AddressInput =');
    expect(result).toContain('export type GeoPointOutput =');
    expect(result).toContain('export type GeoPointInput =');
  });
});

type CodecStub = Codec & {
  readonly targetTypes?: readonly string[];
  readonly renderOutputType?: (params: Record<string, unknown>) => string | undefined;
};

function stubCodec(overrides: Partial<CodecStub> & { id: string }): CodecStub {
  return {
    targetTypes: [],
    decode: (w: unknown) => w,
    encodeJson: (v: unknown) => v,
    decodeJson: (j: unknown) => j,
    ...overrides,
  } as unknown as CodecStub;
}

function stubCodecLookup(codecs: Record<string, CodecStub>): CodecLookup {
  return {
    get: (id) => codecs[id],
    targetTypesFor: (id) => codecs[id]?.targetTypes,
    renderOutputTypeFor: (id, params) => codecs[id]?.renderOutputType?.(params),
  };
}

describe('generateFieldResolvedType', () => {
  it('uses codec renderOutputType when typeParams are present', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: (p) => `Char<${p['length']}>`,
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: { length: 36 } },
    };
    expect(generateFieldResolvedType(field, lookup)).toBe('Char<36>');
  });

  it('falls back to CodecTypes lookup when no codecLookup provided', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/int4@1' },
    };
    expect(generateFieldResolvedType(field)).toBe('CodecTypes["pg/int4@1"]["output"]');
  });

  it('falls back to CodecTypes when renderOutputType returns unsafe expression', () => {
    const lookup = stubCodecLookup({
      'test@1': stubCodec({
        id: 'test@1',
        renderOutputType: () => 'import("fs")',
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'test@1', typeParams: { x: 1 } },
    };
    expect(generateFieldResolvedType(field, lookup)).toBe('CodecTypes["test@1"]["output"]');
  });

  it('falls back to CodecTypes when codec has no renderOutputType', () => {
    const lookup = stubCodecLookup({
      'pg/int4@1': stubCodec({ id: 'pg/int4@1' }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/int4@1', typeParams: { x: 1 } },
    };
    expect(generateFieldResolvedType(field, lookup)).toBe('CodecTypes["pg/int4@1"]["output"]');
  });

  it('falls back to CodecTypes when typeParams is empty', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: () => 'Char<36>',
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: {} },
    };
    expect(generateFieldResolvedType(field, lookup)).toBe('CodecTypes["pg/char@1"]["output"]');
  });
});

describe('generateFieldOutputTypesMap', () => {
  it('generates map entries with codec-dispatched rendering', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: (p) => `Char<${p['length']}>`,
      }),
    });
    const models: Record<string, ContractModel> = {
      User: {
        fields: {
          id: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: { length: 36 } },
          },
          name: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
          },
        },
        relations: {},
        storage: { fields: {}, table: 'user' },
      },
    };
    const result = generateFieldOutputTypesMap(models, lookup);
    expect(result).toContain('Char<36>');
    expect(result).toContain('CodecTypes["pg/text@1"]["output"]');
  });

  it('returns Record<string, never> for empty models', () => {
    expect(generateFieldOutputTypesMap(undefined)).toBe('Record<string, never>');
    expect(generateFieldOutputTypesMap({})).toBe('Record<string, never>');
  });

  it('references {Name}Output for value object fields', () => {
    const models: Record<string, ContractModel> = {
      Product: {
        fields: {
          price: {
            nullable: false,
            type: { kind: 'valueObject', name: 'Price' },
          },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateFieldOutputTypesMap(models);
    expect(result).toContain('readonly price: PriceOutput');
  });
});

describe('generateFieldInputTypesMap', () => {
  it('generates input-side codec lookups', () => {
    const models: Record<string, ContractModel> = {
      User: {
        fields: {
          name: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'mongo/string@1' },
          },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateFieldInputTypesMap(models);
    expect(result).toContain('CodecTypes["mongo/string@1"]["input"]');
  });

  it('references {Name}Input for value object fields', () => {
    const models: Record<string, ContractModel> = {
      Product: {
        fields: {
          price: {
            nullable: false,
            type: { kind: 'valueObject', name: 'Price' },
          },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateFieldInputTypesMap(models);
    expect(result).toContain('readonly price: PriceInput');
  });

  it('returns Record<string, never> for empty models', () => {
    expect(generateFieldInputTypesMap(undefined)).toBe('Record<string, never>');
    expect(generateFieldInputTypesMap({})).toBe('Record<string, never>');
  });
});

describe('generateBothFieldTypesMaps', () => {
  it('generates both output and input maps in a single pass', () => {
    const models: Record<string, ContractModel> = {
      User: {
        fields: {
          _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateBothFieldTypesMaps(models);
    expect(result.output).toContain('CodecTypes["mongo/objectId@1"]["output"]');
    expect(result.input).toContain('CodecTypes["mongo/objectId@1"]["input"]');
  });

  it('returns Record<string, never> for empty models on both sides', () => {
    const result = generateBothFieldTypesMaps(undefined);
    expect(result.output).toBe('Record<string, never>');
    expect(result.input).toBe('Record<string, never>');
  });
});

describe('resolveFieldType', () => {
  it('returns both input and output for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
    };
    const result = resolveFieldType(field);
    expect(result.output).toBe('CodecTypes["mongo/string@1"]["output"]');
    expect(result.input).toBe('CodecTypes["mongo/string@1"]["input"]');
  });

  it('returns suffixed types for value object fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Price' },
    };
    const result = resolveFieldType(field);
    expect(result.output).toBe('PriceOutput');
    expect(result.input).toBe('PriceInput');
  });

  it('uses renderOutputType only for output side of parameterized codecs', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: (p) => `Char<${p['length']}>`,
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: { length: 36 } },
    };
    const result = resolveFieldType(field, lookup);
    expect(result.output).toBe('Char<36>');
    expect(result.input).toBe('CodecTypes["pg/char@1"]["input"]');
  });

  it('uses renderInputType for the input side when the codec renders one (enum literal union)', () => {
    const union = "'a' | 'b'";
    const lookup: CodecLookup = {
      get: () => undefined,
      targetTypesFor: () => undefined,
      renderOutputTypeFor: () => union,
      renderInputTypeFor: () => union,
    };
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/enum@1', typeParams: { values: ['a', 'b'] } },
    };
    const result = resolveFieldType(field, lookup);
    expect(result.output).toBe(union);
    expect(result.input).toBe(union);
  });

  it('falls back to the codec input type when the lookup renders no custom input', () => {
    const lookup: CodecLookup = {
      get: () => undefined,
      targetTypesFor: () => undefined,
      renderOutputTypeFor: () => '"a" | "b"',
    };
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/enum@1', typeParams: { values: ['a', 'b'] } },
    };
    const result = resolveFieldType(field, lookup);
    expect(result.output).toBe('"a" | "b"');
    expect(result.input).toBe('CodecTypes["pg/enum@1"]["input"]');
  });
});

describe('generateBothFieldTypesMaps with resolveFieldValueSet', () => {
  it('narrows a scalar enum field to its value-set members on both sides', () => {
    const models: Record<string, ContractModel> = {
      Post: {
        fields: {
          priority: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            valueSet: {
              plane: 'domain',
              entityKind: 'enum',
              namespaceId: 'public',
              entityName: 'Priority',
            },
          },
          title: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
          },
        },
        relations: {},
        storage: {},
      },
    };
    const resolveFieldValueSet: FieldValueSetResolver = (_modelName, fieldName) =>
      fieldName === 'priority'
        ? { encodedValues: ['low', 'high', 'urgent'], codecId: 'pg/text@1' }
        : undefined;
    const result = generateBothFieldTypesMaps(
      models,
      literalCodecLookup(),
      undefined,
      resolveFieldValueSet,
    );
    expect(result.output).toContain('readonly priority: "low" | "high" | "urgent"');
    expect(result.input).toContain('readonly priority: "low" | "high" | "urgent"');
    expect(result.output).toContain('readonly title: CodecTypes["pg/text@1"]["output"]');
  });

  it('falls through to the codec channel for non-enum scalar fields', () => {
    const models: Record<string, ContractModel> = {
      Post: {
        fields: {
          title: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
          },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateBothFieldTypesMaps(
      models,
      literalCodecLookup(),
      undefined,
      () => undefined,
    );
    expect(result.output).toContain('readonly title: CodecTypes["pg/text@1"]["output"]');
  });
});

describe('generateBothFieldTypesMaps with resolveFieldTypeParams', () => {
  // SQL `typeRef`-shaped columns carry their `typeParams` on a named `storage.types[ref]` entry rather than inline on the framework's domain `ContractField`. The framework emit path consults a per-family resolver (`EmissionSpi.resolveFieldTypeParams`) to recover those typeParams so the codec's `renderOutputType` runs and the parameterized output type is emitted instead of the generic `CodecTypes[...]['output']` fallback.

  it('uses resolved typeParams from the family resolver when domain field has none', () => {
    const lookup = stubCodecLookup({
      'pg/vector@1': stubCodec({
        id: 'pg/vector@1',
        renderOutputType: (p) => `Vector<${p['length']}>`,
      }),
    });
    const models: Record<string, ContractModel> = {
      Post: {
        fields: {
          embedding: {
            nullable: true,
            type: { kind: 'scalar', codecId: 'pg/vector@1' },
          },
        },
        relations: {},
        storage: {},
      },
    };
    const resolveFieldTypeParams = (
      modelName: string,
      fieldName: string,
      _model: ContractModel,
    ): Record<string, unknown> | undefined =>
      modelName === 'Post' && fieldName === 'embedding' ? { length: 1536 } : undefined;
    const result = generateBothFieldTypesMaps(models, lookup, resolveFieldTypeParams);
    expect(result.output).toContain('readonly embedding: Vector<1536> | null');
    expect(result.output).not.toContain('CodecTypes["pg/vector@1"]["output"]');
  });

  it('prefers inline typeParams over the resolver (regression guard)', () => {
    const lookup = stubCodecLookup({
      'pg/vector@1': stubCodec({
        id: 'pg/vector@1',
        renderOutputType: (p) => `Vector<${p['length']}>`,
      }),
    });
    const models: Record<string, ContractModel> = {
      Post: {
        fields: {
          embedding: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/vector@1', typeParams: { length: 768 } },
          },
        },
        relations: {},
        storage: {},
      },
    };
    const resolveFieldTypeParams = (
      _modelName: string,
      _fieldName: string,
      _model: ContractModel,
    ): Record<string, unknown> | undefined => ({ length: 1536 });
    const result = generateBothFieldTypesMaps(models, lookup, resolveFieldTypeParams);
    expect(result.output).toContain('readonly embedding: Vector<768>');
    expect(result.output).not.toContain('Vector<1536>');
  });
});

describe('resolveFieldType value-set narrowing edge cases', () => {
  const priorityRef = {
    plane: 'domain' as const,
    namespaceId: 'public',
    entityKind: 'enum' as const,
    entityName: 'Priority',
  };

  it('renders numeric value-set members as plain literals', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/int4@1' },
      valueSet: priorityRef,
    };
    const result = resolveFieldType(field, literalCodecLookup(), undefined, {
      encodedValues: [1, 10],
      codecId: 'pg/int4@1',
    });
    expect(result.output).toBe('1 | 10');
    expect(result.input).toBe('1 | 10');
  });

  it('renders boolean value-set members as plain literals', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/bool@1' },
      valueSet: priorityRef,
    };
    const result = resolveFieldType(field, literalCodecLookup(), undefined, {
      encodedValues: [true, false],
      codecId: 'pg/bool@1',
    });
    expect(result.output).toBe('true | false');
  });

  it('applies nullability on top of the narrowed union', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: priorityRef,
    };
    const result = resolveFieldType(field, literalCodecLookup(), undefined, {
      encodedValues: ['low'],
      codecId: 'pg/text@1',
    });
    expect(result.output).toBe('"low" | null');
    expect(result.input).toBe('"low" | null');
  });

  it('falls through to the codec channel when no resolved value-set is supplied', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: priorityRef,
    };
    const result = resolveFieldType(field, literalCodecLookup(), undefined, undefined);
    expect(result.output).toBe('CodecTypes["pg/text@1"]["output"]');
  });

  it('falls through to the codec channel when the value set is empty', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: priorityRef,
    };
    const result = resolveFieldType(field, literalCodecLookup(), undefined, {
      encodedValues: [],
      codecId: 'pg/text@1',
    });
    expect(result.output).toBe('CodecTypes["pg/text@1"]["output"]');
  });

  it('falls through to the codec channel when a value is non-literal-expressible', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/jsonb@1' },
      valueSet: priorityRef,
    };
    const result = resolveFieldType(field, literalCodecLookup(), undefined, {
      encodedValues: [{ nested: 1 }],
      codecId: 'pg/jsonb@1',
    });
    expect(result.output).toBe('CodecTypes["pg/jsonb@1"]["output"]');
  });

  it('does not narrow non-scalar (union) fields even with a resolved value-set present', () => {
    const field: ContractField = {
      nullable: false,
      type: {
        kind: 'union',
        members: [
          { kind: 'scalar', codecId: 'pg/text@1' },
          { kind: 'valueObject', name: 'Address' },
        ],
      },
      valueSet: priorityRef,
    };
    const result = resolveFieldType(field, literalCodecLookup(), undefined, {
      encodedValues: ['low', 'high'],
      codecId: 'pg/text@1',
    });
    expect(result.output).toBe('CodecTypes["pg/text@1"]["output"] | AddressOutput');
    expect(result.input).toBe('CodecTypes["pg/text@1"]["input"] | AddressInput');
    expect(result.output).not.toContain('"low"');
  });
});

describe('renderValueSetType', () => {
  it('renders a literal union via the codec renderValueLiteral', () => {
    expect(renderValueSetType(['low', 'high'], 'pg/text@1', 'output', literalCodecLookup())).toBe(
      '"low" | "high"',
    );
  });

  it('returns undefined for an empty value set', () => {
    expect(renderValueSetType([], 'pg/text@1', 'output', literalCodecLookup())).toBeUndefined();
  });

  it('returns undefined when the lookup has no renderValueLiteralFor', () => {
    const lookup: CodecLookup = {
      get: () => undefined,
      targetTypesFor: () => undefined,
      renderOutputTypeFor: () => undefined,
    };
    expect(renderValueSetType(['low'], 'pg/text@1', 'output', lookup)).toBeUndefined();
  });

  it('returns undefined when any value is not literal-expressible', () => {
    expect(
      renderValueSetType([{ nested: 1 }], 'pg/jsonb@1', 'output', literalCodecLookup()),
    ).toBeUndefined();
  });
});

describe('generateFieldTypesMapsByNamespace edge cases', () => {
  it('returns Record<string, never> when no namespaces are supplied', () => {
    const result = generateFieldTypesMapsByNamespace([]);
    expect(result.output).toBe('Record<string, never>');
    expect(result.input).toBe('Record<string, never>');
  });

  it('emits Record<string, never> for a model with no fields', () => {
    const result = generateBothFieldTypesMaps({
      Empty: { fields: {}, relations: {}, storage: {} },
    });
    expect(result.output).toContain('readonly Empty: Record<string, never>');
    expect(result.input).toContain('readonly Empty: Record<string, never>');
  });

  it('skips falsy entries in the models map', () => {
    // The map's value type allows `ContractModelBase`, but a contract that
    // arrives through JSON deserialization could have a falsy value at a
    // model slot (corruption / partial parse). The emitter silently skips
    // those rather than throwing — the `if (!model) continue` guard.
    const models = blindCast<
      Record<string, ContractModel>,
      'test fixture: deliberately constructs a falsy slot to exercise the skip branch'
    >({
      Skipped: undefined,
      Real: {
        fields: { name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
        relations: {},
        storage: {},
      },
    });
    const result = generateBothFieldTypesMaps(models);
    expect(result.output).not.toContain('Skipped');
    expect(result.output).toContain('readonly Real:');
  });
});

describe('serializeCrossReference with space', () => {
  it('includes the space discriminator when the ref carries one', () => {
    const result = generateRootsType({ user: crossRef('User', 'public', 'authSpace') });
    expect(result).toContain('readonly space: "authSpace"');
  });
});

describe('generateValueObjectsDescriptorType empty-field branch', () => {
  it("renders a value object with no fields as 'Record<string, never>'", () => {
    const result = generateValueObjectsDescriptorType({
      EmptyVO: { fields: {} },
    });
    expect(result).toContain('readonly EmptyVO: { readonly fields: Record<string, never> }');
  });
});

describe('serializeValue object key order', () => {
  it('sorts object keys, so the literal type does not depend on how the value was built', () => {
    expect(serializeValue({ field: 'email', direction: 1 })).toBe(
      serializeValue({ direction: 1, field: 'email' }),
    );
    expect(serializeValue({ field: 'email', direction: 1 })).toBe(
      '{ readonly direction: 1; readonly field: "email" }',
    );
  });

  it('keeps array order, which is meaningful', () => {
    expect(serializeValue([{ b: 1 }, { a: 2 }])).toBe(
      'readonly [{ readonly b: 1 }, { readonly a: 2 }]',
    );
  });
});
