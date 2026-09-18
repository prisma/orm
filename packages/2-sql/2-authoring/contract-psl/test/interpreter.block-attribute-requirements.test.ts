import type { AuthoringContributions } from '@internal/framework-components/authoring';
import { modelAttribute } from '@internal/psl-parser';
import type { SqlStorage } from '@internal/sql-contract/types';
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

const auditedModelSpec = modelAttribute('audited', {
  documentation: 'Allows audit rules to target this model.',
});

const auditContributions: AuthoringContributions = {
  entityTypes: {
    audit_rule: {
      kind: 'entity',
      discriminator: 'audit_rule',
      output: {
        factory: (block: {
          name: string;
          namespaceId: string;
          resolvedModelRefs?: { target?: { tableName: string } };
        }) => ({
          kind: 'audit_rule',
          name: block.name,
          namespaceId: block.namespaceId,
          targetTable: block.resolvedModelRefs?.target?.tableName,
        }),
      },
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
  const wrap = (body: string) => `namespace public {\n${body}\n}`;
  const rule = 'audit_rule track_widgets {\n target = Widget\n}';
  const model = (audited: boolean) =>
    `model Widget {\n id Int @id\n @@map("widgets")\n${audited ? '@@audited' : ''}\n}`;

  it.each([false, true])(
    'lowers a reopened rule against its mapped model (rule first: %s)',
    (ruleFirst) => {
      const members = ruleFirst ? [rule, model(true)] : [model(true), rule];
      const consolidated = interpretWith(wrap(members.join('\n')));
      const split = interpretWith(members.map(wrap).join('\n'));
      expect(consolidated.ok).toBe(true);
      expect(split.ok).toBe(true);
      if (!consolidated.ok || !split.ok) throw new Error('Expected audit rule lowering');
      expect(split.value).toEqual(consolidated.value);
      const storage = split.value.storage as SqlStorage;
      expect(storage.namespaces['public']?.entries['audit_rule']).toEqual({
        track_widgets: {
          kind: 'audit_rule',
          name: 'track_widgets',
          namespaceId: 'public',
          targetTable: 'widgets',
        },
      });
    },
  );

  it.each([false, true])(
    'checks a required model attribute across reopenings (rule first: %s)',
    (ruleFirst) => {
      const members = ruleFirst ? [rule, model(false)] : [model(false), rule];
      const result = interpretWith(members.map(wrap).join('\n'));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected missing audited attribute');
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
          message:
            '`audit_rule` block "track_widgets" targets model "Widget", which does not declare `@@audited`. Add `@@audited` to model "Widget".',
        }),
      ]);
    },
  );

  it('retains invalid extension parameter diagnostics from a later block', () => {
    const result = interpretWith(
      `${wrap(model(true))}\n${wrap('audit_rule track_widgets {\n target = Widget\n target = Missing\n}')}`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected duplicate parameter rejection');
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_EXTENSION_DUPLICATE_PARAMETER' }),
    ]);
  });

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
