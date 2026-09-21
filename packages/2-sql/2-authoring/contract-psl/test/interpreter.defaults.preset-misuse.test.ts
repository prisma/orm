import { describe, expect, it } from 'vitest';
import { symbolTableInputFromParseArgs } from './fixtures';
import {
  builtinControlMutationDefaults,
  interpretPslDocumentToSqlContract,
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

  it('rejects optional field-preset call with PSL_PRESET_NOT_OPTIONAL', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Bad {
id Int @id
example temporal.exampleField()?
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: syntheticPresetContributions,
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Bad {
id Int @id
example temporal.exampleField() @default(now())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: syntheticPresetContributions,
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Bad {
id Int @id
example temporal.exampleField() @id
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: syntheticPresetContributions,
    });

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

  it('rejects an unknown extension namespace in field-position with PSL_EXTENSION_NAMESPACE_NOT_COMPOSED (AC5c)', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Bad {
id Int @id
ts weather.updatedAt()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          sourceId: 'schema.prisma',
          data: { namespace: 'weather', suggestedPack: 'weather' },
        }),
      ]),
    );
  });

  it('rejects extra positional argument to a zero-arg preset (AC5a)', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Bad {
id Int @id
example temporal.exampleField(123)
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: syntheticPresetContributions,
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Bad {
id Int @id
example temporal.exampleField()[]
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: syntheticPresetContributions,
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Bad {
id Int @id
ts DateTime @default(temporal.updatedAt())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Bad {
id Int @id
example temporal.updatedAt() temporal.createdAt()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.length).toBeGreaterThan(0);
  });

  it('rejects an unknown preset name in a registered field namespace with PSL_UNKNOWN_FIELD_PRESET', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Bad {
id Int @id
example audit.foo()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: { field: { audit: {} }, type: {} },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_FIELD_PRESET',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('audit.foo'),
          data: { namespace: 'audit', helperPath: 'audit.foo' },
        }),
      ]),
    );
  });
});
