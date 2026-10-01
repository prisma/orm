import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { postgresTargetDescriptorMeta } from '../src/core/descriptor-meta';
import { postgresIndexTypes } from '../src/core/index-types';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      type: {
        Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
      },
    },
  },
]);

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string) {
  const { document, sources } = parse(source, 'index-types.test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
  });
  return interpretPslDocumentToSqlContract({
    documents: [document],
    dataTypeLookup: postgresDataTypeLookup,
    symbolTable,
    sources,
    capabilities: {},
    target: postgresTargetDescriptorMeta,
    scalarColumnDescriptors: scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
  });
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

  it('lets btree and hash back a foreign key, and nothing else', () => {
    expect(postgresIndexTypes.entries.filter((e) => e.backsForeignKey).map((e) => e.type)).toEqual([
      'btree',
      'hash',
    ]);
  });
});

describe('fullText options', () => {
  const fullText = postgresIndexTypes.entries.find((entry) => entry.type === 'fullText')!;
  const accepts = (options: Record<string, unknown>) =>
    !(fullText.options(options) instanceof type.errors);

  it('accepts weight groups and a language', () => {
    expect(accepts({ fields: [['title', 'subtitle'], ['body']], language: 'english' })).toBe(true);
  });

  it.each([
    ['fields without a language', { fields: [['title']] }],
    ['a language without fields', { language: 'english' }],
    ['no weight group', { fields: [], language: 'english' }],
    ['an empty weight group', { fields: [['title'], []], language: 'english' }],
    [
      'more than four weight groups',
      { fields: [['a'], ['b'], ['c'], ['d'], ['e']], language: 'english' },
    ],
    ['a field named twice', { fields: [['title'], ['title']], language: 'english' }],
    ['an empty field name', { fields: [['']], language: 'english' }],
    ['a field that is not a name', { fields: [[1]], language: 'english' }],
    ['a language Postgres does not ship', { fields: [['title']], language: 'klingon' }],
    ['any other option', { fields: [['title']], language: 'english', fastupdate: 'off' }],
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
