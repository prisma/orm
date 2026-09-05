import type { PrismaNextConfig } from '@internal/config-loader';
import * as configLoader from '@internal/config-loader';
import type { AttributeSpecContext } from '@internal/psl-parser';
import { assembleAttributeSpecs, fieldAttribute, modelAttribute } from '@internal/psl-parser';
import { ok } from '@internal/utils/result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfigInputs } from '../src/config-resolution';
import { runPipeline } from '../src/pipeline';

vi.mock('@internal/config-loader', { spy: true });

const rlsSpec = modelAttribute('rls', {});
const markerSpec = fieldAttribute('marker', {});

const familyPack = {
  kind: 'family',
  id: 'demo-family',
  version: '0.0.1',
  authoring: {
    attributeSpecs: {
      model: {},
      field: { marker: () => markerSpec },
    },
  },
};

const targetPack = {
  kind: 'target',
  id: 'demo-target',
  version: '0.0.1',
  authoring: {
    modelAttributes: {
      security: {
        rlsMarker: {
          kind: 'modelAttribute',
          attribute: 'rls',
          spec: () => rlsSpec,
          lower: () => undefined,
        },
      },
    },
  },
};

function pslProjectConfig(): PrismaNextConfig {
  return {
    family: familyPack,
    target: targetPack,
    extensions: [],
    contract: {
      source: {
        format: 'psl',
        inputs: ['/abs/schema.prisma'],
        load: async () => ({}) as never,
        interpret: () => ({}) as never,
      },
    },
  } as unknown as PrismaNextConfig;
}

describe('assembled attribute specs are consumable from a resolved project', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('enumerates a contributed model attribute by its claimed name', async () => {
    vi.spyOn(configLoader, 'loadConfig').mockResolvedValue(
      ok({ config: pslProjectConfig(), diagnostics: [] }),
    );

    const result = await resolveConfigInputs('/abs/prisma.config.ts');

    const contributions = result.interpretation?.context.authoringContributions;
    expect(contributions).toBeDefined();
    if (contributions === undefined) return;

    const specs = assembleAttributeSpecs(contributions);

    expect('rls' in specs.model).toBe(true);
    expect(Object.keys(contributions.modelAttributes)).toEqual(['security']);
  });

  it('enumerates a family-registered field attribute and invokes its factory', async () => {
    vi.spyOn(configLoader, 'loadConfig').mockResolvedValue(
      ok({ config: pslProjectConfig(), diagnostics: [] }),
    );

    const result = await resolveConfigInputs('/abs/prisma.config.ts');
    const interpretation = result.interpretation;
    expect(interpretation).toBeDefined();
    if (interpretation === undefined) return;

    const pipeline = runPipeline('model Widget {\n  id Int @id\n}\n', result.controlStack);
    const model = pipeline.symbolTable.topLevel.models['Widget'];
    const field = model?.fields['id'];
    expect(field).toBeDefined();
    if (model === undefined || field === undefined) return;

    const specs = assembleAttributeSpecs(interpretation.context.authoringContributions);
    expect(Object.keys(specs.field)).toEqual(['marker']);

    const spec = specs.field['marker']?.({
      symbols: pipeline.symbolTable,
      model,
      field,
      controlMutationDefaults:
        interpretation.context.controlMutationDefaults.defaultFunctionRegistry,
    });
    expect(spec).toMatchObject({ name: 'marker', level: 'field' });
  });

  it('invokes the enumerated factory to obtain the attribute spec', async () => {
    vi.spyOn(configLoader, 'loadConfig').mockResolvedValue(
      ok({ config: pslProjectConfig(), diagnostics: [] }),
    );

    const result = await resolveConfigInputs('/abs/prisma.config.ts');
    const interpretation = result.interpretation;
    expect(interpretation).toBeDefined();
    if (interpretation === undefined) return;

    const pipeline = runPipeline('model Widget {\n  id Int @id\n}\n', result.controlStack);
    const model = pipeline.symbolTable.topLevel.models['Widget'];
    expect(model).toBeDefined();
    if (model === undefined) return;

    const ctx: AttributeSpecContext = {
      symbols: pipeline.symbolTable,
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
