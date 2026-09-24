import type { AttributeSpecContext } from '@internal/psl-parser';
import { assembleAttributeSpecs, buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { resolveConfigInputs } from '../../../../packages/1-framework/3-tooling/language-server/src/config-resolution';

const configPath = join(import.meta.dirname, 'attribute-specs/_fixture/prisma.config.ts');
const mongoConfigPath = join(
  import.meta.dirname,
  'attribute-specs/_fixture-mongo/prisma.config.ts',
);

function modelSymbolFor(source: string) {
  const { document, sources } = parse(source, 'attribute-specs-consumability.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  return { symbolTable, model: symbolTable.topLevel.models['Widget'] };
}

describe('postgres attribute specs are consumable from a resolved language-server project', () => {
  it("enumerates the postgres pack's @@rls by its attribute name", async () => {
    const resolution = await resolveConfigInputs(configPath);

    const contributions = resolution.interpretation?.context.authoringContributions;
    expect(contributions).toBeDefined();
    if (contributions === undefined) return;

    const specs = assembleAttributeSpecs(contributions);

    expect('rls' in specs.model).toBe(true);
  });

  it("invokes the postgres pack's factory to obtain the @@rls spec", async () => {
    const resolution = await resolveConfigInputs(configPath);
    const interpretation = resolution.interpretation;
    expect(interpretation).toBeDefined();
    if (interpretation === undefined) return;

    const { symbolTable, model } = modelSymbolFor('model Widget {\n  id Int @id\n}\n');
    expect(model).toBeDefined();
    if (model === undefined) return;

    const ctx: AttributeSpecContext = {
      symbols: symbolTable,
      model,
      controlMutationDefaults: {
        ...interpretation.context.controlMutationDefaults,
        dataTypeEntries: interpretation.context.authoringContributions.dataTypes,
      },
    };

    const spec = assembleAttributeSpecs(interpretation.context.authoringContributions).model[
      'rls'
    ]?.(ctx);

    expect(spec).toMatchObject({
      name: 'rls',
      level: 'model',
      documentation: 'Enables PostgreSQL row-level security on this model’s table.',
    });
  });
});

describe('mongo attribute specs are consumable from a resolved language-server project', () => {
  it("enumerates the Mongo family's built-ins by attribute name", async () => {
    const resolution = await resolveConfigInputs(mongoConfigPath);

    const contributions = resolution.interpretation?.context.authoringContributions;
    expect(contributions).toBeDefined();
    if (contributions === undefined) return;

    const specs = assembleAttributeSpecs(contributions);

    expect({
      model: Object.keys(specs.model).sort(),
      field: Object.keys(specs.field).sort(),
    }).toEqual({
      model: ['base', 'discriminator', 'index', 'map', 'textIndex', 'unique'],
      field: ['id', 'map', 'relation', 'unique'],
    });
  });

  it("invokes the Mongo family's per-model index factory to obtain the @@index spec", async () => {
    const resolution = await resolveConfigInputs(mongoConfigPath);
    const interpretation = resolution.interpretation;
    expect(interpretation).toBeDefined();
    if (interpretation === undefined) return;

    const { symbolTable, model } = modelSymbolFor(
      'model Widget {\n  id ObjectId @id @map("_id")\n}\n',
    );
    expect(model).toBeDefined();
    if (model === undefined) return;

    const ctx: AttributeSpecContext = {
      symbols: symbolTable,
      model,
      controlMutationDefaults: {
        ...interpretation.context.controlMutationDefaults,
        dataTypeEntries: interpretation.context.authoringContributions.dataTypes,
      },
    };

    const spec = assembleAttributeSpecs(interpretation.context.authoringContributions).model[
      'index'
    ]?.(ctx);

    expect(spec).toMatchObject({
      name: 'index',
      level: 'model',
      documentation: 'Declares a MongoDB index over the selected fields.',
      named: {
        sparse: {
          documentation: 'Whether documents missing indexed fields are omitted from the index.',
          type: { kind: 'bool', optional: true },
        },
      },
    });
  });

  it("enumerates the SQL family's built-in attribute surface", async () => {
    const resolution = await resolveConfigInputs(configPath);
    const contributions = resolution.interpretation?.context.authoringContributions;
    expect(contributions).toBeDefined();
    if (contributions === undefined) return;

    const specs = assembleAttributeSpecs(contributions);

    expect(Object.keys(specs.model).sort()).toEqual([
      'base',
      'check',
      'control',
      'discriminator',
      'fullTextIndex',
      'id',
      'index',
      'map',
      'rls',
      'unique',
    ]);
    expect(Object.keys(specs.field).sort()).toEqual([
      'default',
      'id',
      'map',
      'noCheck',
      'relation',
      'unique',
    ]);
  });

  it("invokes the SQL family's @relation factory and enumerates its named arguments", async () => {
    const resolution = await resolveConfigInputs(configPath);
    const interpretation = resolution.interpretation;
    expect(interpretation).toBeDefined();
    if (interpretation === undefined) return;

    const { symbolTable, model } = modelSymbolFor('model Widget {\n  id Int @id\n}\n');
    const field = model?.fields['id'];
    expect(field).toBeDefined();
    if (model === undefined || field === undefined) return;

    const spec = assembleAttributeSpecs(interpretation.context.authoringContributions).field[
      'relation'
    ]?.({
      symbols: symbolTable,
      model,
      field,
      controlMutationDefaults: {
        ...interpretation.context.controlMutationDefaults,
        dataTypeEntries: interpretation.context.authoringContributions.dataTypes,
      },
    });

    expect(spec).toMatchObject({
      name: 'relation',
      level: 'field',
      documentation:
        'Defines the relation name, foreign-key fields, and referential actions for this relation.',
      named: {
        onDelete: {
          documentation: 'The referential action when a referenced row is deleted.',
          type: { kind: 'oneOf', optional: true },
        },
      },
    });
    expect(Object.keys(spec?.named ?? {}).sort()).toEqual([
      'fields',
      'index',
      'map',
      'name',
      'onDelete',
      'onUpdate',
      'references',
    ]);
  });
});
