import { crossRef } from '@internal/contract/types';
import { validateContractDomain } from '@internal/contract/validate-domain';
import type { SqlModelStorage, SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import type { InterpretPslDocumentToSqlContractInput } from '../src/interpreter';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import {
  createBuiltinLikeControlMutationDefaults,
  documentScopedTypes,
  interpretSqlContract,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

describe('interpretPslDocumentToSqlContract — polymorphism', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPostgresSchema = (
    schema: string,
    input: Omit<
      InterpretPslDocumentToSqlContractInput,
      | 'documents'
      | 'sources'
      | 'symbolTable'
      | 'binder'
      | 'target'
      | 'scalarColumnDescriptors'
      | 'composedExtensionContracts'
      | 'createNamespace'
      | 'capabilities'
      | 'dataTypes'
      | 'codecLookup'
      | 'generatorFunctions'
    > &
      Partial<
        Pick<
          InterpretPslDocumentToSqlContractInput,
          'composedExtensionContracts' | 'generatorFunctions' | 'dataTypes'
        >
      >,
  ) =>
    interpretSqlContract(schema, {
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      ...fixtureInterpreterTypes,
      capabilities: { sql: { scalarList: true } },
      ...input,
    });

  it('keeps same-named inheritance graphs independent across namespaces', () => {
    const inheritanceSchema = (namespace: string) => `namespace ${namespace} {
  model Bug {
    ${namespace}Detail String @map("${namespace}_detail")
    @@base(Task, "bug")
  }
  model Feature {
    ${namespace}Priority Int
    @@base(Task, "feature")
    @@map("${namespace}_features")
  }
  model Task {
    ${namespace}Id Int @id @map("${namespace}_id")
    ${namespace}Kind String
    @@discriminator(${namespace}Kind)
    @@map("${namespace}_tasks")
  }
}`;
    const standalone = 'model Bug {\n id Int @id\n @@map("standalone_bug")\n}';
    const interpret = (schema: string) => {
      const result = interpretPostgresSchema(schema, {
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.failure));
      return result.value;
    };
    const combined = interpret(
      [standalone, inheritanceSchema('alpha'), inheritanceSchema('beta')].join('\n'),
    );
    expect(() => validateContractDomain(combined)).not.toThrow();
    const envelope: unknown = JSON.parse(JSON.stringify(combined));
    expect(() => validateSqlContractFully(envelope)).not.toThrow();
    for (const namespace of ['alpha', 'beta']) {
      const isolated = interpret(inheritanceSchema(namespace));
      expect(combined.domain.namespaces[namespace]).toEqual(isolated.domain.namespaces[namespace]);
      const storage = combined.storage as SqlStorage;
      expect(storage.namespaces[namespace]).toEqual(
        (isolated.storage as SqlStorage).namespaces[namespace],
      );
      expect(combined.domain.namespaces[namespace]?.models['Task']).toMatchObject({
        discriminator: { field: `${namespace}Kind` },
        variants: { bug: crossRef('Bug', namespace), feature: crossRef('Feature', namespace) },
      });
      expect(combined.domain.namespaces[namespace]?.models['Bug']).toMatchObject({
        base: crossRef('Task', namespace),
        storage: { table: `${namespace}_tasks` },
      });
      expect(storage.namespaces[namespace]?.entries.table?.[`${namespace}_features`]).toMatchObject(
        {
          primaryKey: { columns: [`${namespace}_id`] },
          foreignKeys: [
            {
              target: {
                tableName: `${namespace}_tasks`,
                columns: [`${namespace}_id`],
                namespaceId: namespace,
              },
            },
          ],
        },
      );
    }
    expect(combined.roots).toEqual({
      standalone_bug: crossRef('Bug', 'public'),
      alpha_tasks: crossRef('Task', 'alpha'),
      beta_tasks: crossRef('Task', 'beta'),
    });
  });

  it.each([
    [
      'type Base { value String }',
      'model Variant { id Int @id\n @@base(Base, "v") }',
      'Expected model reference "Base", found compositeType',
      'PSL_INVALID_ATTRIBUTE_SYNTAX',
    ],
    [
      'namespace sibling { model Base { id Int @id } }',
      'namespace local { model Variant { id Int @id\n @@base(Base, "v") } }',
      'Cannot find entity "Base"',
      'PSL_UNRESOLVED_REFERENCE',
    ],
    [
      'model Base { id Int @id }',
      'namespace local { type Base { value String }\n model Variant { id Int @id\n @@base(Base, "v") } }',
      'Expected model reference "Base", found compositeType',
      'PSL_INVALID_ATTRIBUTE_SYNTAX',
    ],
  ])('reports checked-reference failure for %s', (base, variant, message, code) => {
    const schema = `${base}\n${variant}`;
    const result = interpretPostgresSchema(schema, {
      controlMutationDefaults: builtinControlMutationDefaults,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code,
          message,
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ offset: schema.indexOf('@@base(Base') + 7 }),
          }),
        }),
      ]);
  });

  describe('variants in other namespaces', () => {
    const baseNamespace = `namespace a {
  model Task {
    id   Int    @id
    type String
    @@discriminator(type)
    @@map("tasks")
  }
}`;

    it('references each variant by its own namespace', () => {
      const result = interpretPostgresSchema(
        `${baseNamespace}
namespace b {
  model Chore {
    effort Int
    @@base(a.Task, "chore")
    @@map("tasks")
  }
  model Epic {
    points Int
    @@base(a.Task, "b-epic")
    @@map("epics")
  }
}
namespace c {
  model Epic {
    goal String
    @@base(a.Task, "c-epic")
    @@map("epics")
  }
}`,
        { controlMutationDefaults: builtinControlMutationDefaults },
      );
      if (!result.ok) throw new Error(JSON.stringify(result.failure));
      const contract = result.value;
      expect(() => validateSqlContractFully(JSON.parse(JSON.stringify(contract)))).not.toThrow();
      const { a, b, c } = contract.domain.namespaces;
      expect(a?.models['Task']?.variants).toEqual({
        chore: crossRef('Chore', 'b'),
        'b-epic': crossRef('Epic', 'b'),
        'c-epic': crossRef('Epic', 'c'),
      });
      expect(b?.models['Chore']).toMatchObject({
        base: crossRef('Task', 'a'),
        storage: { table: 'tasks', namespaceId: 'b' },
      });
      expect(b?.models['Epic']).toMatchObject({
        base: crossRef('Task', 'a'),
        storage: { table: 'epics', namespaceId: 'b' },
      });
      expect(c?.models['Epic']).toMatchObject({
        base: crossRef('Task', 'a'),
        storage: { table: 'epics', namespaceId: 'c' },
      });
      const storage = contract.storage as SqlStorage;
      const variantTables = [
        ['b', 'tasks'],
        ['b', 'epics'],
        ['c', 'epics'],
      ] as const;
      for (const [namespace, table] of variantTables) {
        expect(storage.namespaces[namespace]?.entries.table?.[table]).toMatchObject({
          primaryKey: { columns: ['id'] },
          foreignKeys: [{ target: { namespaceId: 'a', tableName: 'tasks', columns: ['id'] } }],
        });
      }
      expect(Object.values(contract.roots)).toEqual([crossRef('Task', 'a')]);
    });

    it('diagnoses a variant without @@map', () => {
      const schema = `${baseNamespace}
namespace b {
  model Chore {
    effort Int
    @@base(a.Task, "chore")
  }
}`;
      const result = interpretPostgresSchema(schema, {
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_BASE_IN_OTHER_NAMESPACE_WITHOUT_MAP',
          message:
            'Model "b.Chore" declares @@base(a.Task, ...) without @@map, so it would share the table of "a.Task", which belongs to namespace "a". Add @@map to give "b.Chore" its own table.',
          span: expect.objectContaining({
            start: expect.objectContaining({ offset: schema.indexOf('@@base') }),
          }),
        }),
      ]);
    });

    it('names both namespaces when two variants declare the same value', () => {
      const result = interpretPostgresSchema(
        `${baseNamespace}
namespace b {
  model Epic {
    points Int
    @@base(a.Task, "epic")
    @@map("epics")
  }
}
namespace c {
  model Epic {
    goal String
    @@base(a.Task, "epic")
    @@map("epics")
  }
}`,
        { controlMutationDefaults: builtinControlMutationDefaults },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_DUPLICATE_DISCRIMINATOR_VALUE',
          message:
            'Discriminator value "epic" is used by both "b.Epic" and "c.Epic" on base model "a.Task"',
        }),
      ]);
    });

    it('names both namespaces when the base has no @@discriminator', () => {
      const result = interpretPostgresSchema(
        `namespace a {
  model Task {
    id Int @id
  }
}
namespace b {
  model Chore {
    effort Int
    @@base(a.Task, "chore")
    @@map("chores")
  }
}`,
        { controlMutationDefaults: builtinControlMutationDefaults },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_ORPHANED_BASE',
          message:
            'Model "b.Chore" declares @@base(a.Task, ...) but "a.Task" has no @@discriminator',
        }),
      ]);
    });
  });

  it('ignores polymorphism collection when the schema has no models', () => {
    const result = interpretPostgresSchema(
      `types {
  Email = String
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({});
    expect(modelsOf(result.value)).toEqual({});
    expect(documentScopedTypes(result.value)).toBeUndefined();
  });

  describe('@@discriminator and @@base — happy paths', () => {
    it('emits discriminator on base model', () => {
      const result = interpretPostgresSchema(
        `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: { bug: crossRef('Bug', 'public') },
      });
    });

    it('emits base on variant model', () => {
      const result = interpretPostgresSchema(
        `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Bug']).toMatchObject({
        base: crossRef('Task', 'public'),
      });
    });

    it('variant without @@map inherits base table (STI)', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Bug']?.storage).toMatchObject({ table: 'tasks' });
    });

    it('variant with @@map gets own table (MTI)', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Feature']?.storage).toMatchObject({ table: 'features' });
    });

    it('MTI variant storage table carries the base PK column, primary key, and FK to the base', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

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
          index: { primaryKey: true },
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
      const result = interpretPostgresSchema(
        `namespace auth {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

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
      const result = interpretPostgresSchema(
        `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const bugFields = Object.keys(modelsOf(result.value)['Bug']?.fields ?? {});
      expect(bugFields).toEqual(['severity']);
    });

    it('assembles multiple variants on the base', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          bug: crossRef('Bug', 'public'),
          feature: crossRef('Feature', 'public'),
        },
      });
      expect(modelsOf(result.value)['Bug']).toMatchObject({ base: crossRef('Task', 'public') });
      expect(modelsOf(result.value)['Feature']).toMatchObject({ base: crossRef('Task', 'public') });
    });

    it('variants are not included in roots', () => {
      const result = interpretPostgresSchema(
        `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

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
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The variant's declared column lands on the SHARED base table. It is
      // nullable in storage even though the domain field is required, because
      // the base table also hosts sibling-variant rows (Feature rows have no
      // `severity`).
      const tasks = tablesOf(result.value)['tasks'];
      expect(tasks?.columns['severity']).toMatchObject({
        codecId: 'pg/text@1',
        dataType: 'pg/text',
        nullable: true,
      });

      // The variant's own field map points at the base-table column, and the
      // emitter's storage-reference check is satisfied (the bug this fixes).
      expect((modelsOf(result.value)['Bug']!.storage as SqlModelStorage).fields).toEqual({
        severity: { column: 'severity' },
      });
    });

    it('does not leak the STI variant field onto the base domain model', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

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
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const severity = modelsOf(result.value)['Bug']?.fields['severity'];
      expect(severity).toMatchObject({ nullable: false });
    });

    it('does not emit an orphan storage table for an STI variant', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The STI variant shares the base table; it must not also produce its
      // own (empty) table or a root pointing at one.
      expect(Object.keys(tablesOf(result.value))).toEqual(['tasks']);
      expect(result.value.roots).not.toHaveProperty('Bug');
    });

    it('materializes columns for two STI variants onto the same base table', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const tasks = tablesOf(result.value)['tasks'];
      expect(tasks?.columns['severity']).toMatchObject({ nullable: true });
      expect(tasks?.columns['recurring']).toMatchObject({ nullable: true });
      expect(Object.keys(tablesOf(result.value))).toEqual(['tasks']);
    });

    it('leaves MTI variants untouched (own table keeps its own columns)', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const tables = tablesOf(result.value);
      // The MTI variant's column stays on its own table, NOT the base.
      expect(tables['tasks']?.columns).not.toHaveProperty('priority');
      expect(tables['features']?.columns['priority']).toMatchObject({ nullable: false });
    });

    it('materializes the STI column and joins the MTI variant in a mixed hierarchy', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

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
      const result = interpretPostgresSchema(
        `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

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
      const result = interpretPostgresSchema(
        `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

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
      const result = interpretPostgresSchema(
        `model Task {
  id    Int    @id @default(autoincrement())
  title String

  @@discriminator(kind)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNRESOLVED_REFERENCE',
            message: expect.stringContaining('Cannot find field'),
          }),
        ]),
      );
    });

    it('diagnoses a discriminator field that is not text', () => {
      const result = interpretPostgresSchema(
        `model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  Int

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            message: expect.stringContaining('must be text, such as String'),
          }),
        ]),
      );
    });

    it('throws an internal error when the stack names no text data types', () => {
      expect(() =>
        interpretPostgresSchema(
          `model Task {
  id   Int    @id
  type String

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
          {
            controlMutationDefaults: builtinControlMutationDefaults,
            dataTypes: { ...fixtureInterpreterTypes.dataTypes, textDataTypes: [] },
          },
        ),
      ).toThrow(
        new InternalError(
          'The stack names no text data types, so no field can be a discriminator; the target names its text types in its authoring contributions.',
        ),
      );
    });

    it('accepts a discriminator field typed by a named type based on String', () => {
      const result = interpretPostgresSchema(
        `types {
  Kind = String
}

model Task {
  id    Int    @id @default(autoincrement())
  type  Kind

  @@discriminator(type)
}

model Bug {
  severity String

  @@base(Task, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: { bug: crossRef('Bug', 'public') },
      });
    });

    it('diagnoses a discriminator field typed by a user model named String', () => {
      const result = interpretPostgresSchema(
        `model String {
  id    Int    @id
  tasks Task[]
}

model Task {
  id     Int    @id @default(autoincrement())
  typeId Int
  type   String @relation(fields: [typeId], references: [id])

  @@discriminator(type)
}

model Bug {
  severity Int

  @@base(Task, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual([
        {
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message:
            'Discriminator field "type" on model "Task" must be text, such as String, but is "String"',
          sourceId: 'schema.prisma',
          span: {
            start: { line: 11, column: 3, offset: 189 },
            end: { line: 11, column: 24, offset: 210 },
          },
        },
      ]);
    });

    it('diagnoses model with both @@discriminator and @@base', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

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
      const result = interpretPostgresSchema(
        `model Bug {
  id       Int    @id @default(autoincrement())
  severity String

  @@base(NonExistent, "bug")
}`,
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNRESOLVED_REFERENCE',
            message: expect.stringContaining('Cannot find entity "NonExistent"'),
          }),
        ]),
      );
    });

    it('diagnoses duplicate discriminator values', () => {
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

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
      const result = interpretPostgresSchema(
        `model Task {
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
        {
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(() => validateContractDomain(result.value)).not.toThrow();

      expect(modelsOf(result.value)['Task']).toMatchObject({
        discriminator: { field: 'type' },
        variants: {
          bug: crossRef('Bug', 'public'),
          feature: crossRef('Feature', 'public'),
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

    it('gives a variant with no fields of its own an empty fields object in storage', () => {
      const result = interpretPostgresSchema(
        `model Task {
  id   Int    @id
  type String

  @@discriminator(type)
  @@map("tasks")
}

model Epic {
  @@base(Task, "epic")
}`,
        { controlMutationDefaults: builtinControlMutationDefaults },
      );

      if (!result.ok) throw new Error(JSON.stringify(result.failure));
      expect(modelsOf(result.value)['Epic']?.storage).toEqual({
        table: 'tasks',
        namespaceId: 'public',
        fields: {},
      });
      expect(() =>
        validateSqlContractFully(JSON.parse(JSON.stringify(result.value))),
      ).not.toThrow();
    });
  });
});
