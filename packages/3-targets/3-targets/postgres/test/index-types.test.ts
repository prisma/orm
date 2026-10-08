import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import { defineIndexTypes, indexTypeRegistryOf } from '@internal/sql-contract/index-types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import { postgresTargetDescriptorMeta } from '../src/core/descriptor-meta';
import { FULL_TEXT_INDEX_TYPE, fullTextIndexType } from '../src/core/full-text-index-definition';
import { postgresAccessMethodOf, postgresIndexTypes } from '../src/core/index-types';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);
const postgresCodecLookup = createPostgresBuiltinCodecLookup();

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      type: {
        Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1' } },
      },
    },
  },
]);

const scalarTypeDescriptors = new Map<string, { codecId: string }>([
  ['Int', { codecId: 'pg/int4@1' }],
]);

const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> =
  Object.fromEntries(
    [...scalarTypeDescriptors].map(([name, output]) => [
      name,
      { kind: 'typeConstructor' as const, output },
    ]),
  );

function interpret(source: string) {
  const bound = bindPslSchema(source, {
    sourceId: 'index-types.test.psl',
    context: {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...scalarTypeConstructors, ...assembled.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: postgresCodecLookup,
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypes: { entries: assembled.dataTypes, lookup: postgresDataTypeLookup },
      resolvedInputs: [],
      capabilities: {},
    },
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresTargetDescriptorMeta,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

function modelWithIndexType(indexType: string): string {
  return `
model Widgets {
  id   Int @id
  code Int
  @@index([code], type: "${indexType}")
}
`;
}

describe('postgresIndexTypes', () => {
  const accessMethods = ['btree', 'hash', 'gin', 'gist', 'spgist', 'brin'];

  it('registers the six Postgres built-in access methods and the full-text index', () => {
    expect(postgresIndexTypes.entries.map((e) => e.type)).toEqual([...accessMethods, 'fullText']);
  });

  it('accepts an arbitrary options object for every access method', () => {
    for (const entry of postgresIndexTypes.entries.filter((e) => accessMethods.includes(e.type))) {
      const result = entry.options({ anything: 'goes' });
      expect(result instanceof type.errors).toBe(false);
    }
  });

  it('creates a fullText index as a gin index', () => {
    expect(postgresAccessMethodOf('fullText')).toBe('gin');
    expect(postgresAccessMethodOf('btree')).toBe('btree');
  });

  it('registers fullText as the target, which converts it into a gin index', () => {
    const registry = indexTypeRegistryOf({ id: 'postgres', indexTypes: postgresIndexTypes });

    expect(registry.get(FULL_TEXT_INDEX_TYPE)).toMatchObject({ accessMethod: 'gin' });
  });

  it('refuses fullText registered by an extension pack, which cannot convert it', () => {
    const copied = defineIndexTypes().add(FULL_TEXT_INDEX_TYPE, fullTextIndexType);

    expect(() =>
      indexTypeRegistryOf({ id: 'postgres' }, [{ id: 'copied-full-text', indexTypes: copied }]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        meta: { indexType: 'fullText', accessMethod: 'gin', packId: 'copied-full-text' },
      }),
    );
  });
});

describe('fullText options', () => {
  const fullText = postgresIndexTypes.entries.find((entry) => entry.type === 'fullText')!;
  const accepts = (options: Record<string, unknown>) =>
    !(fullText.options(options) instanceof type.errors);

  it('accepts weight groups and a language', () => {
    expect(accepts({ weightGroups: [['title', 'subtitle'], ['body']], language: 'english' })).toBe(
      true,
    );
  });

  it.each([
    ['weight groups without a language', { weightGroups: [['title']] }],
    ['a language without weight groups', { language: 'english' }],
    ['no weight group', { weightGroups: [], language: 'english' }],
    ['an empty weight group', { weightGroups: [['title'], []], language: 'english' }],
    [
      'more than four weight groups',
      { weightGroups: [['a'], ['b'], ['c'], ['d'], ['e']], language: 'english' },
    ],
    ['a field named twice', { weightGroups: [['title'], ['title']], language: 'english' }],
    ['an empty field name', { weightGroups: [['']], language: 'english' }],
    ['a field that is not a name', { weightGroups: [[1]], language: 'english' }],
    ['a language Postgres does not ship', { weightGroups: [['title']], language: 'klingon' }],
    ['any other option', { weightGroups: [['title']], language: 'english', fastupdate: 'off' }],
  ])('rejects %s', (_label, options) => {
    expect(accepts(options)).toBe(false);
  });
});

describe('postgresTargetDescriptorMeta', () => {
  it('declares its index types via postgresIndexTypes', () => {
    expect(postgresTargetDescriptorMeta.indexTypes).toBe(postgresIndexTypes);
  });
});

describe('contract build registers postgres index types end-to-end', () => {
  it('accepts @@index(..., type: "gin")', () => {
    const result = interpret(modelWithIndexType('gin'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.table['Widgets']?.indexes.map((idx) => idx.type)).toEqual(['gin']);
  });

  it('accepts @@index(..., type: "hash")', () => {
    const result = interpret(modelWithIndexType('hash'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.table['Widgets']?.indexes.map((idx) => idx.type)).toEqual(['hash']);
  });

  it('still rejects a bogus, unregistered index type — registering real methods does not disable the check', () => {
    expect(() => interpret(modelWithIndexType('bogus'))).toThrow(/unregistered index type "bogus"/);
  });
});
