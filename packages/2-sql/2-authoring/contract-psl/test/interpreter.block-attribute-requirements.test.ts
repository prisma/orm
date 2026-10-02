import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { PslBlockSpecDescriptor } from '@internal/psl-parser';
import { entityRef, modelAttribute, optional, structBlock } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import { interpretSqlContract, postgresScalarTypeDescriptors, postgresTarget } from './fixtures';

const pslBlockDescriptors = {
  audit_rule: {
    kind: 'pslBlock' as const,
    keyword: 'audit_rule',
    discriminator: 'audit_rule',
    name: { required: true },
    spec: () =>
      structBlock({
        parameters: {
          target: {
            type: optional(entityRef({ kind: 'model' })),
            documentation: 'The audited model.',
          },
        },
      }),
    requiresModelAttribute: { parameter: 'target', attribute: 'audited' },
  } satisfies PslBlockSpecDescriptor,
};

const auditedModelSpec = modelAttribute('audited', {
  documentation: 'Allows audit rules to target this model.',
});

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
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    dataTypes: fixtureDataTypeSupport,
    capabilities: { sql: { scalarList: true } },
    authoringContributions: auditContributions,
  });
}

describe('pslBlockDescriptors.requiresModelAttribute enforcement', () => {
  it.each([
    ['', ''],
    ['public', 'public'],
    ['public', ''],
    ['unbound', 'unbound'],
    ['__unbound__', '__unbound__'],
  ])(
    'resolves mapped references from namespace "%s" to namespace "%s"',
    (namespace, modelNamespace) => {
      const block = 'audit_rule track_widgets {\n  target = Widget\n}';
      const model = `model Widget {
  id Int @id
  @@map("mapped_widgets")
  @@audited
}`;
      const result = interpretWith(
        [
          namespace === '' ? block : `namespace ${namespace} {\n${block}\n}`,
          modelNamespace === '' ? model : `namespace ${modelNamespace} {\n${model}\n}`,
        ].join('\n'),
      );
      expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
      if (!result.ok) return;
      const namespaceId = namespace === '' || namespace === 'public' ? 'public' : '__unbound__';
      expect(result.value.storage.namespaces[namespaceId]?.entries['audit_rule']).toMatchObject({
        track_widgets: { resolvedModelRefs: { target: { tableName: 'mapped_widgets' } } },
      });
    },
  );

  it.each([
    ['', 'public'],
    ['unbound', '__unbound__'],
  ])(
    'rejects unqualified references from namespace "%s" to namespace "%s"',
    (namespace, modelNamespace) => {
      const block = 'audit_rule track_widgets {\n  target = Widget\n}';
      const model = 'model Widget {\n  id Int @id\n  @@audited\n}';
      const result = interpretWith(
        [
          namespace === '' ? block : `namespace ${namespace} {\n${block}\n}`,
          `namespace ${modelNamespace} {\n${model}\n}`,
        ].join('\n'),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
        { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find entity "Widget"' },
      ]);
    },
  );

  it('decodes mapped names before extension blocks and field lowering', () => {
    const result = interpretWith(String.raw`
audit_rule track_widgets {
  target = Widget
}
model Widget {
  id Int @id @map("widget\u005fid")
  @@map("mapped\u005fwidgets")
  @@audited
}`);
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
    if (!result.ok) return;
    expect(result.value.storage.namespaces['public']?.entries).toMatchObject({
      audit_rule: {
        track_widgets: { resolvedModelRefs: { target: { tableName: 'mapped_widgets' } } },
      },
      table: {
        mapped_widgets: { columns: { widget_id: expect.anything() } },
      },
    });
  });

  it.each(['name: "ignored"', '"ignored", extra: true', '', '""'])(
    'reports map diagnostics once with early extension consumers (%s)',
    (argument) => {
      const result = interpretWith(`
audit_rule first {
  target = Widget
}
audit_rule second {
  target = Widget
}
model Widget {
  id Int @id @map(${argument})
  others Other[] @map(${argument})
  @@map(${argument})
  @@audited
}
model Other {
  id Int @id
}`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics.map(({ code }) => code)).toEqual([
        ...Array.from(
          { length: argument.startsWith('name:') ? 6 : 3 },
          () => 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        ),
        'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      ]);
    },
  );

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

  it('checks the requirement on a top-level fallback selection', () => {
    const result = interpretWith(`
namespace reporting {
  audit_rule track_widgets {
    target = Widget
  }
}

model Widget {
  id Int @id
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

  it('accepts a top-level fallback selection that declares the attribute', () => {
    const result = interpretWith(`
namespace reporting {
  audit_rule track_widgets {
    target = Widget
  }
}

model Widget {
  id Int @id

  @@audited
}
`);
    expect(result.ok).toBe(true);
  });

  it('checks the selected local declaration, not a same-named attributed top-level model', () => {
    const result = interpretWith(`
namespace reporting {
  model Widget {
    id Int @id
  }

  audit_rule track_widgets {
    target = Widget
  }
}

model Widget {
  id Int @id

  @@audited
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE' }),
      ]),
    );
  });

  it('anchors the diagnostic on the parameter entry span', () => {
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
    const finding = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
    );
    expect(finding?.span).toMatchObject({ start: { line: 8, column: 5 } });
  });
});
