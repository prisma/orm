import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { AttributeSpecContext, ModelAttributeSpecFactory } from '@internal/psl-parser';
import { modelAttribute, str } from '@internal/psl-parser';
import type { SqlNamespaceInput } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

const stampModelSpec = modelAttribute('stamp', {
  positional: [{ key: 'label', type: str() }],
});

const stampFactoryContexts: AttributeSpecContext[] = [];

const stampSpecFactory: ModelAttributeSpecFactory = (ctx) => {
  stampFactoryContexts.push(ctx);
  return stampModelSpec;
};

const stampAuthoringContributions: AuthoringContributions = {
  modelAttributes: {
    stamp: {
      kind: 'modelAttribute',
      attribute: 'stamp',
      spec: stampSpecFactory,
      lower: (parsed: { readonly label: string }, ctx) => ({
        key: ctx.storageName,
        entity: {
          kind: 'stamp',
          tableName: ctx.storageName,
          modelName: ctx.modelName,
          namespaceId: ctx.namespaceId,
          label: parsed.label,
        },
      }),
    },
  },
};

function interpretWith(
  schema: string,
  authoringContributions?: AuthoringContributions,
  pslBlockDescriptors?: Parameters<typeof symbolTableInputFromParseArgs>[0]['pslBlockDescriptors'],
) {
  const capturedEntries: Record<string, Record<string, Record<string, unknown>>> = {};
  const document = symbolTableInputFromParseArgs({
    schema,
    sourceId: 'schema.prisma',
    ...(pslBlockDescriptors !== undefined ? { pslBlockDescriptors } : {}),
  });
  const createNamespace = (input: SqlNamespaceInput) => {
    capturedEntries[input.id] = { ...(capturedEntries[input.id] ?? {}), ...input.entries };
    return createTestSqlNamespace(input);
  };
  const result = interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    controlMutationDefaults: builtinControlMutationDefaults,
    composedExtensionContracts: new Map(),
    createNamespace,
    capabilities: { sql: { scalarList: true } },
    ...(authoringContributions !== undefined ? { authoringContributions } : {}),
  });
  return { result, capturedEntries };
}

function expectDiagnostic(
  schema: string,
  diagnostic: { readonly code: string; readonly message: string },
  authoringContributions?: AuthoringContributions,
): void {
  const { result } = interpretWith(schema, authoringContributions);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failure.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining(diagnostic)]),
  );
}

describe('contributed model attributes (AuthoringContributions.modelAttributes)', () => {
  it('consults the contributed descriptor and files the lowered entity under entries[attribute][key]', () => {
    const { result, capturedEntries } = interpretWith(
      `model Widget {
  id Int @id
  @@stamp("v1")
}`,
      stampAuthoringContributions,
    );

    expect(result.ok).toBe(true);
    expect(capturedEntries).toMatchObject({
      public: {
        stamp: {
          widget: { kind: 'stamp', tableName: 'widget', modelName: 'Widget', label: 'v1' },
        },
      },
    });
  });

  it('calls the descriptor spec factory with the declaring model and the composed stack facts', () => {
    stampFactoryContexts.length = 0;
    const { result } = interpretWith(
      `model Widget {
  id Int @id
  @@stamp("v1")
}`,
      stampAuthoringContributions,
    );

    expect(result.ok).toBe(true);
    expect(stampFactoryContexts).toHaveLength(1);
    const ctx = stampFactoryContexts[0];
    expect(ctx?.model.name).toBe('Widget');
    expect(Object.keys(ctx?.symbols.topLevel.models ?? {})).toContain('Widget');
    expect(ctx?.controlMutationDefaults).toBe(
      builtinControlMutationDefaults.defaultFunctionRegistry,
    );
  });

  it('threads the declaring namespace id into the lowering context', () => {
    const { result, capturedEntries } = interpretWith(
      `namespace tenant {
  model Widget {
    id Int @id
    @@stamp("in-namespace")
  }
}`,
      stampAuthoringContributions,
    );

    expect(result.ok).toBe(true);
    expect(capturedEntries['tenant']?.['stamp']?.['widget']).toMatchObject({
      namespaceId: 'tenant',
      label: 'in-namespace',
    });
  });

  it('emits PSL_DUPLICATE_ATTRIBUTE when the contributed attribute is declared twice on one model', () => {
    expectDiagnostic(
      `model Widget {
  id Int @id
  @@stamp("v1")
  @@stamp("v2")
}`,
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message: '`@@stamp` declared more than once on model "Widget".',
      },
      stampAuthoringContributions,
    );
  });

  it('emits PSL_INVALID_ATTRIBUTE_SYNTAX when the contributed attribute is missing its required argument', () => {
    expectDiagnostic(
      `model Widget {
  id Int @id
  @@stamp()
}`,
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "stamp" is missing required argument "label"',
      },
      stampAuthoringContributions,
    );
  });

  it('falls through to PSL_UNSUPPORTED_MODEL_ATTRIBUTE when no descriptor claims the attribute (unknown attribute, unchanged)', () => {
    expectDiagnostic(
      `model Widget {
  id Int @id
  @@stamp("v1")
}`,
      {
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: 'Model "Widget" uses unsupported attribute "@@stamp"',
      },
    );
  });

  it('falls through to PSL_UNSUPPORTED_MODEL_ATTRIBUTE when authoringContributions omits modelAttributes entirely (pack not composed)', () => {
    expectDiagnostic(
      `model Widget {
  id Int @id
  @@stamp("v1")
}`,
      {
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: 'Model "Widget" uses unsupported attribute "@@stamp"',
      },
      { entityTypes: {}, field: {}, pslBlockDescriptors: {}, type: {} },
    );
  });

  it('throws when a model-attribute entries slot collides with a block-produced entries kind', () => {
    // A block descriptor whose discriminator is `stamp` files entities under
    // `entries.stamp` — the same slot the `@@stamp` model attribute claims.
    const stampBlockDescriptors = {
      stamp_block: {
        kind: 'pslBlock' as const,
        keyword: 'stamp_block',
        discriminator: 'stamp',
        name: { required: true },
        parameters: {},
      },
    };
    const collidingContributions: AuthoringContributions = {
      ...stampAuthoringContributions,
      entityTypes: {
        stamp_block: {
          kind: 'entity',
          discriminator: 'stamp',
          output: { factory: (raw: unknown) => raw },
        },
      },
      pslBlockDescriptors: stampBlockDescriptors,
    };

    expect(() =>
      interpretWith(
        `namespace public {
  model Widget {
    id Int @id
    @@stamp("v1")
  }

  stamp_block my_stamp {
  }
}`,
        collidingContributions,
        stampBlockDescriptors,
      ),
    ).toThrow(/entries slot "stamp".*contributed by both/s);
  });
});
