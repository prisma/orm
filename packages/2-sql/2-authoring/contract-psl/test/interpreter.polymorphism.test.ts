import { crossRef } from '@internal/contract/types';
import { validateContractDomain } from '@internal/contract/validate-domain';
import type { SqlModelStorage, SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  documentScopedTypes,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

describe('interpretPslDocumentToSqlContract — polymorphism', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<
      InterpretPslDocumentToSqlContractInput,
      | 'target'
      | 'scalarColumnDescriptors'
      | 'composedExtensionContracts'
      | 'createNamespace'
      | 'capabilities'
    > &
      Partial<Pick<InterpretPslDocumentToSqlContractInput, 'composedExtensionContracts'>>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
      ...input,
    });

  it('ignores polymorphism collection when the schema has no models', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Email = String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({});
    expect(modelsOf(result.value)).toEqual({});
    expect(documentScopedTypes(result.value)).toMatchObject({
      Email: {
        codecId: 'pg/text@1',
        nativeType: 'text',
      },
    });
  });

  describe('@@discriminator and @@base — happy paths', () => {
    it('emits discriminator on base model', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: { Bug: { value: 'bug' } },
      });
    });

    it('emits base on variant model', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Bug']).toMatchObject({
        base: crossRef('Task', 'public'),
      });
    });

    it('variant without @@map inherits base table (STI)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Bug']?.storage).toMatchObject({ table: 'tasks' });
    });

    it('variant with @@map gets own table (MTI)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Feature']?.storage).toMatchObject({ table: 'features' });
    });

    it('MTI variant storage table carries the base PK column, primary key, and FK to the base', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The variant lives in its own table, so the ORM joins it to the base on
      // the shared primary key (`tasks.id = features.id`). That requires the
      // base PK column to be materialised on the variant storage table.
      const storage = result.value.storage as SqlStorage;
      const featureTable = storage.namespaces['public']!.entries.table?.['features'];
      expect(featureTable?.columns['id']).toMatchObject({ nullable: false });
      expect(featureTable?.columns['priority']).toBeDefined();
      expect(featureTable?.primaryKey).toMatchObject({ columns: ['id'] });
      expect(featureTable?.foreignKeys).toEqual([
        expect.objectContaining({
          source: expect.objectContaining({ tableName: 'features', columns: ['id'] }),
          target: expect.objectContaining({ tableName: 'tasks', columns: ['id'] }),
          onDelete: 'cascade',
        }),
      ]);
      expect(featureTable?.indexes).toEqual([]);

      // The link column is storage-only: the domain variant stays thin so
      // variant create/read surfaces are not forced to carry an `id` field.
      const feature = modelsOf(result.value)['Feature'];
      expect(Object.keys(feature?.fields ?? {})).toEqual(['priority']);
      expect((feature?.storage as SqlModelStorage | undefined)?.fields).toEqual({
        priority: { column: 'priority' },
      });
    });

    it('MTI variant FK carries the base namespace when the base lives in a non-default namespace', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `namespace auth {
  model Task {
    id    Int    @id @default(autoincrement())
    title String
    type  String

    @@discriminator(type)
    @@map("tasks")
  }

  model Feature {
    priority Int

    @@base(Task, "feature")
    @@map("features")
  }
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The variant FK references the base table; its target coordinate must
      // carry the base's namespace (`auth`), not silently fall back to the
      // default namespace — mirroring the regular relation-FK path.
      const storage = result.value.storage as SqlStorage;
      const featureTable = storage.namespaces['auth']!.entries.table?.['features'];
      expect(featureTable?.foreignKeys).toEqual([
        expect.objectContaining({
          source: expect.objectContaining({
            namespaceId: 'auth',
            tableName: 'features',
            columns: ['id'],
          }),
          target: expect.objectContaining({
            namespaceId: 'auth',
            tableName: 'tasks',
            columns: ['id'],
          }),
          onDelete: 'cascade',
        }),
      ]);
      expect(featureTable?.indexes).toEqual([]);
    });

    it('variant models contain only their own fields (thin)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const bugFields = Object.keys(modelsOf(result.value)['Bug']?.fields ?? {});
      expect(bugFields).toEqual(['severity']);
    });

    it('assembles multiple variants on the base', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      });
      expect(modelsOf(result.value)['Bug']).toMatchObject({ base: crossRef('Task', 'public') });
      expect(modelsOf(result.value)['Feature']).toMatchObject({ base: crossRef('Task', 'public') });
    });

    it('variants are not included in roots', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.roots).toHaveProperty('Task', crossRef('Task', 'public'));
      expect(Object.values(result.value.roots)).not.toContainEqual(crossRef('Bug', 'public'));
    });
  });

  describe('STI variant storage columns', () => {
    function tablesOf(contract: { storage: unknown }) {
      const storage = contract.storage as SqlStorage;
      const ns = storage.namespaces['public'];
      return ns !== undefined ? (ns.entries.table ?? {}) : {};
    }

    it('materializes an STI variant column onto the base table (nullable in storage)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The variant's declared column lands on the SHARED base table. It is
      // nullable in storage even though the domain field is required, because
      // the base table also hosts sibling-variant rows (Feature rows have no
      // `severity`).
      const tasks = tablesOf(result.value)['tasks'];
      expect(tasks?.columns['severity']).toMatchObject({
        codecId: 'pg/text@1',
        nativeType: 'text',
        nullable: true,
      });

      // The variant's own field map points at the base-table column, and the
      // emitter's storage-reference check is satisfied (the bug this fixes).
      expect((modelsOf(result.value)['Bug']!.storage as SqlModelStorage).fields).toEqual({
        severity: { column: 'severity' },
      });
    });

    it('does not leak the STI variant field onto the base domain model', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // `severity` belongs to `Bug`, not `Task`: it is a base-table column but
      // not a base domain/storage field, so it never appears in a base query's
      // default projection.
      const task = modelsOf(result.value)['Task'];
      expect(Object.keys(task?.fields ?? {})).not.toContain('severity');
      expect(Object.keys((task?.storage as SqlModelStorage)?.fields ?? {})).not.toContain(
        'severity',
      );
    });

    it('keeps the STI variant domain field at its declared (required) nullability', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const severity = modelsOf(result.value)['Bug']?.fields['severity'];
      expect(severity).toMatchObject({ nullable: false });
    });

    it('does not emit an orphan storage table for an STI variant', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The STI variant shares the base table; it must not also produce its
      // own (empty) table or a root pointing at one.
      expect(Object.keys(tablesOf(result.value))).toEqual(['tasks']);
      expect(result.value.roots).not.toHaveProperty('Bug');
    });

    it('materializes columns for two STI variants onto the same base table', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}

model Chore {
  recurring Boolean

  @@base(Task, "chore")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const tasks = tablesOf(result.value)['tasks'];
      expect(tasks?.columns['severity']).toMatchObject({ nullable: true });
      expect(tasks?.columns['recurring']).toMatchObject({ nullable: true });
      expect(Object.keys(tablesOf(result.value))).toEqual(['tasks']);
    });

    it('leaves MTI variants untouched (own table keeps its own columns)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const tables = tablesOf(result.value);
      // The MTI variant's column stays on its own table, NOT the base.
      expect(tables['tasks']?.columns).not.toHaveProperty('priority');
      expect(tables['features']?.columns['priority']).toMatchObject({ nullable: false });
    });

    it('materializes the STI column and joins the MTI variant in a mixed hierarchy', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const tables = tablesOf(result.value);
      expect(tables['tasks']?.columns['severity']).toMatchObject({ nullable: true });
      expect(tables['tasks']?.columns).not.toHaveProperty('priority');
      expect(tables['features']?.columns['priority']).toMatchObject({ nullable: false });
      expect(Object.keys(tables).sort()).toEqual(['features', 'tasks']);
    });
  });

  describe('@@discriminator and @@base — diagnostics', () => {
    it('diagnoses orphaned @@discriminator (no @@base declarations)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_ORPHANED_DISCRIMINATOR',
          }),
        ]),
      );
    });

    it('diagnoses orphaned @@base (target model has no @@discriminator)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_ORPHANED_BASE',
          }),
        ]),
      );
    });

    it('diagnoses missing discriminator field on base model', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String

  @@discriminator(kind)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

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
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  Int

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

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
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String
  kind     String

  @@base(Task, "bug")
  @@discriminator(kind)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_DISCRIMINATOR_AND_BASE',
          }),
        ]),
      );
    });

    it('diagnoses @@base targeting non-existent model', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bug {
  id       Int    @id @default(autoincrement())
  severity String

  @@base(NonExistent, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_BASE_TARGET_NOT_FOUND',
          }),
        ]),
      );
    });

    it('diagnoses duplicate discriminator values', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}

model OtherBug {
  description String

  @@base(Task, "bug")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_DUPLICATE_DISCRIMINATOR_VALUE',
          }),
        ]),
      );
    });
  });

  describe('end-to-end: PSL → interpret → domain validation', () => {
    it('emitted polymorphic contract passes domain validation', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

model Bug {
  severity String

  @@base(Task, "bug")
}

model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(() => validateContractDomain(result.value)).not.toThrow();

      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      });
      expect(modelsOf(result.value)['Bug']).toMatchObject({ base: crossRef('Task', 'public') });
      expect(modelsOf(result.value)['Feature']).toMatchObject({ base: crossRef('Task', 'public') });
      expect(modelsOf(result.value)['Bug']?.storage).toMatchObject({ table: 'tasks' });
      expect(modelsOf(result.value)['Feature']?.storage).toMatchObject({ table: 'features' });
      expect(Object.values(result.value.roots)).not.toContainEqual(crossRef('Bug', 'public'));
      expect(Object.values(result.value.roots)).not.toContainEqual(crossRef('Feature', 'public'));
      expect(result.value.roots).toHaveProperty('tasks', crossRef('Task', 'public'));
    });
  });
});
