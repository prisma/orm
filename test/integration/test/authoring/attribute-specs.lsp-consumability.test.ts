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
  const { document, sourceFile } = parse(source);
  const { table } = buildSymbolTable({ document, sourceFile, pslBlockDescriptors: {} });
  return { table, model: table.topLevel.models['Widget'] };
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

    const { table, model } = modelSymbolFor('model Widget {\n  id Int @id\n}\n');
    expect(model).toBeDefined();
    if (model === undefined) return;

    const ctx: AttributeSpecContext = {
      symbols: table,
      model,
      controlMutationDefaults:
        interpretation.context.controlMutationDefaults.defaultFunctionRegistry,
    };

    const spec = assembleAttributeSpecs(interpretation.context.authoringContributions).model[
      'rls'
    ]?.(ctx);

    expect(spec?.name).toBe('rls');
    expect(spec?.level).toBe('model');
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

    const { table, model } = modelSymbolFor('model Widget {\n  id ObjectId @id @map("_id")\n}\n');
    expect(model).toBeDefined();
    if (model === undefined) return;

    const ctx: AttributeSpecContext = {
      symbols: table,
      model,
      controlMutationDefaults:
        interpretation.context.controlMutationDefaults.defaultFunctionRegistry,
    };

    const spec = assembleAttributeSpecs(interpretation.context.authoringContributions).model[
      'index'
    ]?.(ctx);

    expect(spec?.name).toBe('index');
    expect(spec?.level).toBe('model');
  });
});
