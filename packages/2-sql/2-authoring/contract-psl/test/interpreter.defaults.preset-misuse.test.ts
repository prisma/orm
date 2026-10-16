import { describe, expect, it } from 'vitest';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

describe('field-preset misuse', () => {
  const exampleRef = (entry: string) => ({ namespace: 'public', entry, field: 'example' });
  const syntheticPresetContributions = {
    field: {
      temporal: {
        exampleField: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/text@1',
            default: { kind: 'function', expression: "'synthetic-default'" },
          },
        },
        generatedField: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/text@1',
            executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
          },
        },
        updateOnlyField: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/text@1',
            executionDefaults: { onUpdate: { kind: 'generator', id: 'uuidv4' } },
          },
        },
        idField: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/text@1',
            executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
            id: true,
          },
        },
        nullField: {
          kind: 'fieldPreset',
          output: { codecId: 'pg/text@1', nullable: true },
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

  it('rejects ? on a preset that contributes id semantics with PSL_PRESET_NOT_OPTIONAL', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.idField()?
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
        code: 'PSL_PRESET_NOT_OPTIONAL',
        message: `Field "Bad.example" is a primary key through its field preset, so it cannot be optional; primary key columns must be NOT NULL. Remove "?" or use a preset that does not make the field a primary key.`,
      },
    ]);
  });

  it('keeps the column of a nullable preset nullable with ?', () => {
    const result = interpretPostgresSchema(
      `model Good {
id Int @id
example temporal.nullField()?
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Good']?.columns[
        'example'
      ],
    ).toEqual({ many: false, dataType: 'pg/text', codecId: 'pg/text@1', nullable: true });
  });

  it('accepts ? on a preset that does not fix the id', () => {
    const result = interpretPostgresSchema(
      `model Good {
id Int @id
example temporal.generatedField()?
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Good']?.columns[
        'example'
      ],
    ).toEqual({ many: false, dataType: 'pg/text', codecId: 'pg/text@1', nullable: true });
    expect(result.value.execution?.mutations.defaults).toEqual([
      { ref: exampleRef('Good'), onCreate: { kind: 'generator', id: 'uuidv4' } },
    ]);
  });

  it('rejects @default(...) on a preset that sets its own database default', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.exampleField() @default("other")
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
        code: 'PSL_PRESET_AND_DEFAULT_CONFLICT',
        message:
          'Field "Bad.example" uses a field-preset call that already sets a database default, so it cannot also declare @default(...). Remove @default(...) or use a preset without a default.',
      },
    ]);
  });

  it('rejects a generated @default(...) on a preset that generates a value on create', () => {
    const result = interpretPostgresSchema(
      `model Bad {
id Int @id
example temporal.generatedField() @default(uuid())
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
        code: 'PSL_PRESET_AND_DEFAULT_CONFLICT',
        message:
          'Field "Bad.example" uses a field-preset call that already generates a value on create, so @default(...) cannot generate one too. Remove @default(...), write a database default in @default(...), or use a preset without an onCreate generator.',
      },
    ]);
  });

  it('keeps a database @default(...) together with the preset generators', () => {
    const result = interpretPostgresSchema(
      `model Good {
id Int @id
example temporal.generatedField() @default("fallback")
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Good']?.columns[
        'example'
      ],
    ).toEqual({
      many: false,
      dataType: 'pg/text',
      codecId: 'pg/text@1',
      nullable: false,
      default: { kind: 'literal', value: 'fallback' },
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      { ref: exampleRef('Good'), onCreate: { kind: 'generator', id: 'uuidv4' } },
    ]);
  });

  it('keeps a generated @default(...) together with a preset that only generates on update', () => {
    const result = interpretPostgresSchema(
      `model Good {
id Int @id
example temporal.updateOnlyField() @default(uuid())
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: exampleRef('Good'),
        onCreate: { kind: 'generator', id: 'uuidv4' },
        onUpdate: { kind: 'generator', id: 'uuidv4' },
      },
    ]);
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
