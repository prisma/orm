import type { ContractField, ContractModel, ContractValueObject } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it, vi } from 'vitest';
import {
  deduplicateImports,
  generateCodecTypeIntersection,
  generateContractFieldDescriptor,
  generateHashTypeAliases,
  generateImportLines,
  generateModelFieldsType,
  generateModelRelationsType,
  generateModelsType,
  generateRootsType,
  generateValueObjectsDescriptorType,
  generateValueObjectTypeAliases,
  renderValueSetOverride,
  renderValueSetType,
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
  it('types an empty field map as an object with no keys, not a string index', () => {
    expect(generateModelFieldsType({})).toBe('{}');
  });

  it.each([{}, { many: false as const }])('omits scalar cardinality for %j', (cardinality) => {
    const result = generateModelFieldsType({
      name: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false, ...cardinality },
    });
    expect(result).toBe(
      '{ readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "sql/text@1" } } }',
    );
  });

  it('generates multiple fields', () => {
    const result = generateModelFieldsType({
      id: { type: { kind: 'scalar', codecId: 'sql/int4@1' }, nullable: false, many: false },
      email: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: true, many: false },
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
      'field-name': {
        type: { kind: 'scalar', codecId: 'sql/text@1' },
        nullable: false,
        many: false,
      },
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
        fields: {
          name: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false, many: false },
        },
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
      Animal: makeModel({
        variants: { dog: crossRef('Dog', 'public'), cat: crossRef('Cat', 'pets') },
      }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain(
      'readonly variants: { readonly cat: { readonly namespace: "pets" & NamespaceId; readonly model: "Cat" }; readonly dog: { readonly namespace: "public" & NamespaceId; readonly model: "Dog" } }',
    );
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
        package: '@test/mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
      { package: '@test/mongo/codec-types', named: 'Vector', alias: 'Vector' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual([
      "import type { CodecTypes as MongoCodecTypes, Vector } from '@test/mongo/codec-types';",
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

describe('generateContractFieldDescriptor', () => {
  it('omits explicit scalar cardinality from field descriptors', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      many: false,
    };
    const result = generateContractFieldDescriptor('name', field);
    expect(result).toBe(
      'readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
  });

  it('renders a value object field type as the coordinate of its storage value object', () => {
    const field: ContractField = {
      nullable: true,
      type: {
        kind: 'valueObject',
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'valueObject',
        entityName: 'Address',
      },
      many: false,
    };
    const result = generateContractFieldDescriptor('homeAddress', field);
    expect(result).toBe(
      'readonly homeAddress: { readonly nullable: true; readonly type: { readonly kind: "valueObject"; readonly plane: "storage"; readonly namespaceId: "public"; readonly entityKind: "valueObject"; readonly entityName: "Address" } }',
    );
  });

  it('includes the non-nullable list descriptor', () => {
    const field: ContractField = {
      nullable: false,
      type: {
        kind: 'valueObject',
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'valueObject',
        entityName: 'Address',
      },
      many: { elementNullable: false },
    };
    const result = generateContractFieldDescriptor('addresses', field);
    expect(result).toContain('; readonly many: { readonly elementNullable: false }');
  });

  it('includes element nullability inside the list descriptor', () => {
    const field: ContractField = {
      nullable: false,
      type: {
        kind: 'valueObject',
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'valueObject',
        entityName: 'Address',
      },
      many: { elementNullable: true },
    };
    expect(generateContractFieldDescriptor('addresses', field)).toBe(
      'readonly addresses: { readonly nullable: false; readonly type: { readonly kind: "valueObject"; readonly plane: "storage"; readonly namespaceId: "public"; readonly entityKind: "valueObject"; readonly entityName: "Address" }; readonly many: { readonly elementNullable: true } }',
    );
  });

  it('includes dict modifier', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      dict: true,
      many: false,
    };
    const result = generateContractFieldDescriptor('labels', field);
    expect(result).toContain('; readonly dict: true');
  });

  it('includes typeParams for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/vector@1', typeParams: { length: 1536 } },
      many: false,
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
          street: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'mongo/string@1' },
            many: false,
          },
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
  it('returns empty string without value objects', () => {
    expect(generateValueObjectTypeAliases([])).toBe('');
  });

  it('reads each value object from the shared generic at the storage namespace that holds it', () => {
    expect(
      generateValueObjectTypeAliases([
        ['Address', 'public'],
        ['Point', '__unbound__'],
      ]).split('\n'),
    ).toEqual([
      "type ValueObjectOutputTypes = ValueObjectTypesFromStorage<ContractBase['storage']['namespaces'], CodecTypes, ParameterizedOutputTypeFunctions, FieldTypeOverrides, \"output\">;",
      "type ValueObjectInputTypes = ValueObjectTypesFromStorage<ContractBase['storage']['namespaces'], CodecTypes, ParameterizedOutputTypeFunctions, FieldTypeOverrides, \"input\">;",
      'export type AddressOutput = ValueObjectOutputTypes["public"]["Address"];',
      'export type AddressInput = ValueObjectInputTypes["public"]["Address"];',
      'export type PointOutput = ValueObjectOutputTypes["__unbound__"]["Point"];',
      'export type PointInput = ValueObjectInputTypes["__unbound__"]["Point"];',
    ]);
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

describe('renderValueSetOverride', () => {
  it('keeps the side whose values have literal types when the other side has none', () => {
    const lookup: CodecLookup = {
      get: () => undefined,
      renderOutputTypeFor: () => undefined,
      renderValueLiteralFor: (_id, value, side) =>
        side === 'output' && typeof value === 'string' ? `"${value}"` : undefined,
    };
    expect(renderValueSetOverride(['low', 'high'], 'demo/text@1', lookup)).toEqual({
      output: '"low" | "high"',
    });
  });

  it('gives no type override when neither side has literal types', () => {
    expect(renderValueSetOverride(['low'], 'demo/text@1', undefined)).toBeUndefined();
  });
});
