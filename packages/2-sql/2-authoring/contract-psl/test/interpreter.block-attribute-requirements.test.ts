import type { AuthoringContributions } from '@internal/framework-components/authoring';
import { modelAttribute } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const pslBlockDescriptors = {
  audit_rule: {
    kind: 'pslBlock' as const,
    keyword: 'audit_rule',
    discriminator: 'audit_rule',
    name: { required: true },
    parameters: {
      target: { kind: 'ref' as const, refKind: 'model', scope: 'same-namespace' as const },
    },
    requiresModelAttribute: { parameter: 'target', attribute: 'audited' },
  },
};

const auditedModelSpec = modelAttribute('audited', {});

const auditContributions: AuthoringContributions = {
  entityTypes: {
    audit_rule: {
      kind: 'entity',
      discriminator: 'audit_rule',
      output: { factory: (raw: unknown) => raw },
    },
  },
  pslBlockDescriptors,
  modelAttributes: {
    audited: {
      kind: 'modelAttribute',
      attribute: 'audited',
      spec: () => auditedModelSpec,
      lower: (_parsed: Record<never, never>, ctx) => ({
        key: ctx.storageName,
        entity: { kind: 'audited', storageName: ctx.storageName },
      }),
    },
  },
};

function interpretWith(schema: string) {
  const document = symbolTableInputFromParseArgs({
    schema,
    sourceId: 'schema.prisma',
    pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    authoringContributions: auditContributions,
  });
}

describe('pslBlockDescriptors.requiresModelAttribute enforcement', () => {
  it('rejects a block whose target model lacks the required attribute, naming block and model', () => {
    const result = interpretWith(`
namespace public {
  model Widget {
    id Int @id
  }

  audit_rule track_widgets {
    target = Widget
  }
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
          message:
            '`audit_rule` block "track_widgets" targets model "Widget", which does not declare `@@audited`. Add `@@audited` to model "Widget".',
        }),
      ]),
    );
  });

  it('accepts a block whose target model declares the required attribute', () => {
    const result = interpretWith(`
namespace public {
  model Widget {
    id Int @id

    @@audited
  }

  audit_rule track_widgets {
    target = Widget
  }
}
`);
    expect(result.ok).toBe(true);
  });

  it('is order-independent: the block may precede the model declaration', () => {
    const result = interpretWith(`
namespace public {
  audit_rule track_widgets {
    target = Widget
  }

  model Widget {
    id Int @id

    @@audited
  }
}
`);
    expect(result.ok).toBe(true);
  });

  it('skips the requirement when the named parameter is absent (missing-parameter handling stays elsewhere)', () => {
    const result = interpretWith(`
namespace public {
  model Widget {
    id Int @id
  }

  audit_rule track_widgets {
  }
}
`);
    expect(
      result.ok ||
        !result.failure.diagnostics.some(
          (d) => d.code === 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
        ),
    ).toBe(true);
  });

  it('skips the requirement when the target model does not exist (unresolved-ref handling stays elsewhere)', () => {
    const result = interpretWith(`
namespace public {
  model Widget {
    id Int @id
  }

  audit_rule track_widgets {
    target = Gadget
  }
}
`);
    expect(
      result.ok ||
        !result.failure.diagnostics.some(
          (d) => d.code === 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
        ),
    ).toBe(true);
  });
});
