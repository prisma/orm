import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
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
      codecLookup: { ...emptyCodecLookup, descriptorFor: () => undefined },
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypeLookup: postgresDataTypeLookup,
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
  it('registers the six Postgres built-in access methods', () => {
    expect(postgresIndexTypes.entries.map((e) => e.type)).toEqual([
      'btree',
      'hash',
      'gin',
      'gist',
      'spgist',
      'brin',
    ]);
  });

  it('accepts an arbitrary options object for every registered method (permissive; per-method validation is a later slice)', () => {
    for (const entry of postgresIndexTypes.entries) {
      const result = entry.options({ anything: 'goes' });
      expect(result instanceof type.errors).toBe(false);
    }
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
