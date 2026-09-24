import type { PrismaNextConfig } from '@internal/config-loader';
import * as configLoader from '@internal/config-loader';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
} from '@internal/framework-components/control';
import type { AttributeSpecContext, AttributeSpecNamespace } from '@internal/psl-parser';
import { assembleAttributeSpecs, fieldAttribute, modelAttribute } from '@internal/psl-parser';
import { ok } from '@internal/utils/result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfigInputs } from '../src/config-resolution';
import { runPipeline } from '../src/pipeline';
import { providePslSignatureHelp } from '../src/signature-help';

vi.mock('@internal/config-loader', { spy: true });

const rlsSpec = modelAttribute('rls', {
  documentation: 'Enables row-level security on the model.',
});
const markerSpec = fieldAttribute('marker', {
  documentation: 'Marks the field for the family contribution.',
});

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

  async function importAttributeSpecs(relativePath: string, exportName: string) {
    const module = (await import(new URL(relativePath, import.meta.url).href)) as Record<
      string,
      AttributeSpecNamespace
    >;
    const attributeSpecs = module[exportName];
    if (!attributeSpecs) throw new Error('missing attribute namespace');
    return attributeSpecs;
  }

  function expectBaseSpecSignatureHelp(attributeSpecs: AttributeSpecNamespace) {
    const authoringContributions = assembleAuthoringContributions([
      { id: 'actual-family', authoring: { attributeSpecs } },
    ]);
    const controlMutationDefaults = assembleControlMutationDefaults([]);
    const source = 'model Variant {\n @@base(Missing, "v")\n}\nmodel Base { id Int }';
    const pipeline = runPipeline('schema.prisma', source, {
      scalarTypes: ['Int'],
      pslBlockDescriptors: {},
      authoringContributions,
      controlMutationDefaults,
    });
    const model = pipeline.symbolTable.topLevel.models['Variant'];
    if (!model) throw new Error('missing variant');
    const spec = assembleAttributeSpecs(authoringContributions).model['base']?.({
      symbols: pipeline.symbolTable,
      model,
      controlMutationDefaults: {
        defaultFunctionRegistry: controlMutationDefaults.defaultFunctionRegistry,
        dataTypeEntries: {},
      },
    });
    expect(spec).toMatchObject({
      name: 'base',
      positional: [
        {
          key: 'base',
          type: { kind: 'entityRef', expected: { kind: 'model' }, label: 'model reference' },
        },
        { key: 'value', type: { kind: 'str' } },
      ],
    });
    expect(pipeline.diagnostics).toEqual([]);
    const signature = providePslSignatureHelp({
      document: pipeline.document,
      sourceFile: pipeline.sourceFile,
      position: pipeline.sourceFile.positionAt(source.indexOf('Missing')),
      clientSupportsLabelOffsets: true,
      candidates: {
        symbolTable: pipeline.symbolTable,
        pslBlockDescriptors: {},
        authoringContributions,
        controlMutationDefaults,
      },
    });
    expect(signature?.signatures[0]?.label).toBe('@@base(model reference, string)');
  }

  it('provides signature help from the SQL @@base spec factory', async () => {
    expectBaseSpecSignatureHelp(
      await importAttributeSpecs(
        '../../../../2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts',
        'sqlAttributeSpecs',
      ),
    );
  });

  it('provides signature help from the Mongo @@base spec factory', async () => {
    expectBaseSpecSignatureHelp(
      await importAttributeSpecs(
        '../../../../2-mongo-family/2-authoring/contract-psl/src/mongo-attribute-specs.ts',
        'mongoAttributeSpecs',
      ),
    );
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

    const pipeline = runPipeline(
      'attribute-spec-consumability.psl',
      'model Widget {\n  id Int @id\n}\n',
      result.controlStack,
    );
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
      controlMutationDefaults: {
        ...interpretation.context.controlMutationDefaults,
        dataTypeEntries: interpretation.context.authoringContributions.dataTypes,
      },
    });
    expect(spec).toMatchObject({
      name: 'marker',
      level: 'field',
      documentation: 'Marks the field for the family contribution.',
    });
  });

  it('invokes the enumerated factory to obtain the attribute spec', async () => {
    vi.spyOn(configLoader, 'loadConfig').mockResolvedValue(
      ok({ config: pslProjectConfig(), diagnostics: [] }),
    );

    const result = await resolveConfigInputs('/abs/prisma.config.ts');
    const interpretation = result.interpretation;
    expect(interpretation).toBeDefined();
    if (interpretation === undefined) return;

    const pipeline = runPipeline(
      'attribute-spec-consumability.psl',
      'model Widget {\n  id Int @id\n}\n',
      result.controlStack,
    );
    const model = pipeline.symbolTable.topLevel.models['Widget'];
    expect(model).toBeDefined();
    if (model === undefined) return;

    const ctx: AttributeSpecContext = {
      symbols: pipeline.symbolTable,
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
      documentation: 'Enables row-level security on the model.',
    });
  });
});
