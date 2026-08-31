import type { Contract } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';

function modelsOf(ir: Contract): Record<string, unknown> {
  return ir.domain.namespaces[UNBOUND_NAMESPACE_ID]!.models;
}

import { buildSymbolTable, type SymbolTable } from '@internal/psl-parser';
import type { SourceFile } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';
import { expectInvalidAttributeSyntax } from './interpreter-test-helpers';

const mongoScalarTypeDescriptors: ReadonlyMap<string, string> = new Map([
  ['String', 'mongo/string@1'],
  ['Int', 'mongo/int32@1'],
  ['Boolean', 'mongo/bool@1'],
  ['DateTime', 'mongo/date@1'],
  ['ObjectId', 'mongo/objectId@1'],
  ['Float', 'mongo/double@1'],
]);

const mongoTargetTypes: Record<string, readonly string[]> = {
  'mongo/string@1': ['string'],
  'mongo/int32@1': ['int'],
  'mongo/bool@1': ['bool'],
  'mongo/date@1': ['date'],
  'mongo/objectId@1': ['objectId'],
  'mongo/double@1': ['double'],
};

const mongoCodecLookup: CodecLookup = {
  get(id: string) {
    const targetTypes = mongoTargetTypes[id];
    if (!targetTypes) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => mongoTargetTypes[id],
  renderOutputTypeFor: () => undefined,
};

function mongoCollectionsOf(ir: { readonly storage: unknown }): Record<string, unknown> {
  const storage = ir.storage as {
    namespaces: Record<string, { entries: { collection: Record<string, unknown> } }>;
  };
  return storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.collection;
}

function buildSymbolTableInput(schema: string): {
  symbolTable: SymbolTable;
  sourceFile: SourceFile;
  sourceId: string;
} {
  const { document, sourceFile } = parse(schema);
  const { table } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: {},
  });
  return { symbolTable: table, sourceFile, sourceId: 'test.prisma' };
}

function interpret(schema: string) {
  return interpretPslDocumentToMongoContract({
    ...buildSymbolTableInput(schema),
    scalarTypeCodecIds: mongoScalarTypeDescriptors,
    codecLookup: mongoCodecLookup,
  });
}

function interpretOk(schema: string) {
  const result = interpret(schema);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected ok result');
  return result.value;
}

describe('interpretPslDocumentToMongoContract — polymorphism', () => {
  describe('@@discriminator and @@base — happy paths', () => {
    it('emits discriminator on base model', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(modelsOf(ir)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: { Bug: { value: 'bug' } },
      });
    });

    it('emits base on variant model', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(modelsOf(ir)['Bug']).toMatchObject({ base: crossRef('Task') });
    });

    it('variant inherits base collection (single-collection)', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(modelsOf(ir)['Bug']).toMatchObject({ storage: { collection: 'tasks' } });
    });

    it('assembles multiple variants on the base', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }

        model Feature {
          id       ObjectId @id @map("_id")
          priority Int

          @@base(Task, "feature")
        }
      `);

      expect(modelsOf(ir)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      });
      expect(modelsOf(ir)['Bug']).toMatchObject({ base: crossRef('Task') });
      expect(modelsOf(ir)['Feature']).toMatchObject({ base: crossRef('Task') });
    });

    it('variants are not included in roots', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(ir.roots).toHaveProperty('tasks', crossRef('Task'));
      expect(Object.values(ir.roots)).not.toContainEqual(crossRef('Bug'));
    });

    it('restores base as root when variant explicitly @@map()s to same collection', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@map("tasks")
        }
      `);

      expect(ir.roots).toHaveProperty('tasks', crossRef('Task'));
      expect(Object.values(ir.roots)).not.toContainEqual(crossRef('Bug'));
    });
  });

  describe('@@discriminator and @@base — diagnostics', () => {
    it('diagnoses orphaned @@discriminator (no @@base declarations)', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_ORPHANED_DISCRIMINATOR' })]),
      );
    });

    it('diagnoses orphaned @@base (target model has no @@discriminator)', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_ORPHANED_BASE' })]),
      );
    });

    it('diagnoses missing discriminator field on base model', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String

          @@discriminator(kind)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
            message: expect.stringContaining('does not exist'),
          }),
        ]),
      );
    });

    it('diagnoses non-String discriminator field', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  Int

          @@discriminator(type)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: expect.stringContaining('must be of type String'),
          }),
        ]),
      );
    });

    it('diagnoses model with both @@discriminator and @@base', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String
          kind     String

          @@base(Task, "bug")
          @@discriminator(kind)
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_DISCRIMINATOR_AND_BASE' })]),
      );
    });

    it('diagnoses @@base targeting non-existent model', () => {
      const result = interpret(`
        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(NonExistent, "bug")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PSL_BASE_TARGET_NOT_FOUND' })]),
      );
    });

    it('emits one syntax diagnostic for a malformed variant @@map', () => {
      const result = interpret(`
        model Task {
          id   ObjectId @id @map("_id")
          type String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          severity String

          @@base(Task, "bug")
          @@map(42)
        }
      `);

      expectInvalidAttributeSyntax(result, /Expected a string literal/);
    });

    it('diagnoses variant with @@map to different collection', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@map("bugs")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_MONGO_VARIANT_SEPARATE_COLLECTION' }),
        ]),
      );
    });
  });

  describe('FL-09: variant collection suppression', () => {
    it('does not create separate storage collection entries for variant models', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }

        model Feature {
          id       ObjectId @id @map("_id")
          priority Int

          @@base(Task, "feature")
        }
      `);

      expect(Object.keys(mongoCollectionsOf(ir))).toEqual(['tasks']);
    });

    it('merges variant indexes into base collection', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
          @@index([title])
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@index([severity])
        }
      `);

      const collections = mongoCollectionsOf(ir) as Record<
        string,
        {
          indexes?: Array<{
            keys: Array<{ field: string; direction: number }>;
            partialFilterExpression?: Record<string, unknown>;
          }>;
        }
      >;
      const tasksColl = collections['tasks'];
      expect(tasksColl?.indexes).toBeDefined();
      const titleIdx = tasksColl?.indexes?.find((idx) => idx.keys.some((k) => k.field === 'title'));
      const severityIdx = tasksColl?.indexes?.find((idx) =>
        idx.keys.some((k) => k.field === 'severity'),
      );
      expect(titleIdx).toBeDefined();
      expect(severityIdx).toBeDefined();
      expect(titleIdx?.partialFilterExpression).toBeUndefined();
      expect(severityIdx?.partialFilterExpression).toEqual({ type: 'bug' });
    });

    it('merges variant indexes when variant maps to same collection as base', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
          @@index([title])
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@map("tasks")
          @@index([severity])
        }
      `);

      const collections = mongoCollectionsOf(ir) as Record<
        string,
        {
          indexes?: Array<{
            keys: Array<{ field: string; direction: number }>;
            partialFilterExpression?: Record<string, unknown>;
          }>;
        }
      >;
      const tasksColl = collections['tasks'];
      expect(tasksColl?.indexes).toBeDefined();
      const titleIdx = tasksColl?.indexes?.find((idx) => idx.keys.some((k) => k.field === 'title'));
      const severityIdx = tasksColl?.indexes?.find((idx) =>
        idx.keys.some((k) => k.field === 'severity'),
      );
      expect(titleIdx?.partialFilterExpression).toBeUndefined();
      expect(severityIdx?.partialFilterExpression).toEqual({ type: 'bug' });
    });
  });

  describe('FL-09: polymorphic index scoping', () => {
    it('AND-merges a user-supplied filter on other keys with the discriminator scope', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@index([severity], filter: "{\\"active\\": true}")
        }
      `);

      const collections = mongoCollectionsOf(ir) as Record<
        string,
        {
          indexes?: Array<{
            keys: Array<{ field: string; direction: number }>;
            partialFilterExpression?: Record<string, unknown>;
          }>;
        }
      >;
      const severityIdx = collections['tasks']?.indexes?.find((idx) =>
        idx.keys.some((k) => k.field === 'severity'),
      );
      expect(severityIdx?.partialFilterExpression).toEqual({ active: true, type: 'bug' });
    });

    it('is idempotent when user filter already sets the discriminator to the matching value', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@index([severity], filter: "{\\"type\\": \\"bug\\"}")
        }
      `);

      const collections = mongoCollectionsOf(ir) as Record<
        string,
        {
          indexes?: Array<{
            keys: Array<{ field: string; direction: number }>;
            partialFilterExpression?: Record<string, unknown>;
          }>;
        }
      >;
      const severityIdx = collections['tasks']?.indexes?.find((idx) =>
        idx.keys.some((k) => k.field === 'severity'),
      );
      expect(severityIdx?.partialFilterExpression).toEqual({ type: 'bug' });
    });

    it('emits PSL_INVALID_INDEX with the index attribute span when user filter conflicts with the discriminator value', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@index([severity], filter: "{\\"type\\": \\"feature\\"}")
        }
      `);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      const conflict = result.failure.diagnostics.find(
        (d) => d.code === 'PSL_INVALID_INDEX' && d.message.includes('discriminator'),
      );
      expect(conflict).toBeDefined();
      expect(conflict?.message).toMatch(/type/);
      expect(conflict?.message).toMatch(/feature/);
      expect(conflict?.message).toMatch(/bug/);
      expect(conflict?.span).toBeDefined();
      expect(conflict?.span?.start.offset).toBeGreaterThan(0);
      expect(conflict?.span?.end.offset).toBeGreaterThan(conflict?.span?.start.offset ?? 0);
    });

    it('rejects a variant indexing a base-inherited field', () => {
      const result = interpret(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
          @@index([title])
        }
      `);

      const diag = expectInvalidAttributeSyntax(result, /Expected one of/);
      expect(diag.span?.start.offset).toBeGreaterThan(0);
    });
  });

  describe('FL-10: polymorphic validators', () => {
    it('generates validator with oneOf for variant-specific fields', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }

        model Feature {
          id       ObjectId @id @map("_id")
          priority Int

          @@base(Task, "feature")
        }
      `);

      const collections = mongoCollectionsOf(ir) as Record<
        string,
        { validator?: { jsonSchema: Record<string, unknown> } }
      >;
      const validator = collections['tasks']?.validator;
      expect(validator).toBeDefined();
      const schema = validator?.jsonSchema;
      expect(schema).toHaveProperty('properties._id');
      expect(schema).toHaveProperty('properties.title');
      expect(schema).toHaveProperty('properties.type');
      expect(schema).toHaveProperty('oneOf');
      const oneOf = schema?.['oneOf'] as Array<Record<string, unknown>>;
      expect(oneOf).toHaveLength(2);
    });

    it('emits oneOf with discriminator constraint even when no variant has extra fields', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id    ObjectId @id @map("_id")

          @@base(Task, "bug")
        }
      `);

      const collections = mongoCollectionsOf(ir) as Record<
        string,
        { validator?: { jsonSchema: Record<string, unknown> } }
      >;
      const validator = collections['tasks']?.validator;
      expect(validator).toBeDefined();
      const schema = validator?.jsonSchema;
      expect(schema).toHaveProperty('oneOf');
      const oneOf = schema?.['oneOf'] as Array<Record<string, unknown>>;
      expect(oneOf).toHaveLength(1);
      expect(oneOf[0]).toMatchObject({
        properties: { type: { enum: ['bug'] } },
        required: ['type'],
      });
    });

    it('uses storage-mapped discriminator field name in validator', () => {
      const ir = interpretOk(`
        model Task {
          id    ObjectId @id @map("_id")
          title String
          type  String   @map("_type")

          @@discriminator(type)
          @@map("tasks")
        }

        model Bug {
          id       ObjectId @id @map("_id")
          severity String

          @@base(Task, "bug")
        }
      `);

      const collections = mongoCollectionsOf(ir) as Record<
        string,
        { validator?: { jsonSchema: Record<string, unknown> } }
      >;
      const validator = collections['tasks']?.validator;
      expect(validator).toBeDefined();
      const schema = validator?.jsonSchema;
      expect(schema).toHaveProperty('properties._type');
      expect(schema).not.toHaveProperty('properties.type');
      expect(schema).toHaveProperty('oneOf');
      const oneOf = schema?.['oneOf'] as Array<Record<string, unknown>> | undefined;
      expect(oneOf).toBeDefined();
      expect(oneOf![0]).toMatchObject({
        properties: { _type: { enum: ['bug'] } },
      });
      expect(oneOf![0]!['required']).toContain('_type');
    });
  });
});
