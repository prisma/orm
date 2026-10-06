import { describe, expect, it } from 'vitest';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';

// Field-preset misuse cases. The preset is a complete field declaration —
// optional (?), list ([]), @default(...), @id, @updatedAt all contradict
// that and produce hard errors per spec FR7.
describe('field-preset misuse', () => {
  const syntheticPresetContributions = {
    field: {
      temporal: {
        exampleField: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/text@1',
            nativeType: 'text',
            default: { kind: 'function', expression: "'synthetic-default'" },
          },
        },
      },
    },
  } as const;

  it('rejects a field preset written without a call with PSL_PRESET_NOT_CALLED', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.exampleField
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_PRESET_NOT_CALLED',
        message:
          'Field "Bad.example" uses field preset "temporal.exampleField" without calling it. Write temporal.exampleField().',
      },
    ]);
  });

  it('rejects optional field-preset call with PSL_PRESET_NOT_OPTIONAL', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.exampleField()?
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_PRESET_NOT_OPTIONAL',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('rejects field-preset call combined with @default(...) with PSL_PRESET_AND_DEFAULT_CONFLICT', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.exampleField() @default(now())
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_PRESET_AND_DEFAULT_CONFLICT',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('rejects field-preset call combined with @id when preset does not contribute id', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.exampleField() @id
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_PRESET_AND_ID_CONFLICT',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('rejects a field-preset call with an unregistered namespace with PSL_UNRESOLVED_REFERENCE', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
ts weather.updatedAt()
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
          sourceId: 'schema.prisma',
          message: 'Cannot find type "weather.updatedAt"',
        }),
      ]),
    );
  });

  it('rejects extra positional argument to a zero-arg preset (AC5a)', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.exampleField(123)
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('temporal.exampleField'),
        }),
      ]),
    );
  });

  it('rejects list-of preset call with PSL_PRESET_NOT_LIST (AC5f)', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.exampleField()[]
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_PRESET_NOT_LIST',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('rejects @default(temporal.updatedAt()) as invalid attribute syntax (AC5g)', () => {
    // A namespaced callee fails the funcCall spec before reaching the registry, so the rejection
    // is a syntax error rather than a generator-applicability error.

    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
ts DateTime @default(temporal.updatedAt())
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
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('rejects two type-constructor calls on the same field at parse time (AC5i)', () => {
    // PSL grammar permits at most one type-constructor call per field; a
    // second one is a parser-level reject. This test locks in the
    // failure mode so a future parser refactor can't silently accept the
    // ambiguous form and let the interpreter pick one.

    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.updatedAt() temporal.createdAt()
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.length).toBeGreaterThan(0);
  });

  it('reports an unknown preset name in a registered field namespace as a single unresolved reference', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example audit.foo()
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: { field: { audit: {} }, type: {} },
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_UNRESOLVED_REFERENCE',
        sourceId: 'schema.prisma',
        message: 'Cannot find type "audit.foo"',
        data: { reference: 'type', name: 'audit.foo', constructorCall: true },
      }),
    ]);
  });

  it('keeps the binder voice for a bare name in a registered field namespace', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example audit.foo
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: { field: { audit: {} }, type: {} },
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "audit.foo"' },
    ]);
  });
});
