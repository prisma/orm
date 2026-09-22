import { describe, expect, it } from 'vitest';
import type {
  AuthoringFieldNamespace,
  AuthoringFieldPresetDescriptor,
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '../src/shared/framework-authoring';
import {
  assertNoCrossRegistryCollisions,
  classifyEnumMemberType,
  collectScalarTypeConstructors,
  hasRegisteredFieldNamespace,
  instantiateAuthoringFieldPreset,
  instantiateAuthoringTypeConstructor,
  isAuthoringArgRef,
  isAuthoringFieldPresetDescriptor,
  isAuthoringTypeConstructorDescriptor,
  resolveAuthoringTemplateValue,
  validateAuthoringHelperArguments,
} from '../src/shared/framework-authoring';
import type {
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '../src/shared/psl-extension-block';

describe('authoring template resolution', () => {
  const typeConstructor = {
    kind: 'typeConstructor',
    output: { codecId: 'test/text@1', nativeType: 'text' },
  } satisfies AuthoringTypeConstructorDescriptor;
  const fieldPreset = {
    kind: 'fieldPreset',
    output: { codecId: 'test/text@1', nativeType: 'text' },
  } satisfies AuthoringFieldPresetDescriptor;

  it('narrows a descriptor by kind', () => {
    expect(isAuthoringTypeConstructorDescriptor(typeConstructor)).toBe(true);
    expect(isAuthoringFieldPresetDescriptor(fieldPreset)).toBe(true);
  });

  it('classifies a sub-namespace as not a descriptor', () => {
    const typeNamespace = { nested: typeConstructor } satisfies AuthoringTypeNamespace;
    const fieldNamespace = { nested: fieldPreset } satisfies AuthoringFieldNamespace;
    expect(isAuthoringTypeConstructorDescriptor(typeNamespace)).toBe(false);
    expect(isAuthoringFieldPresetDescriptor(fieldNamespace)).toBe(false);
  });

  describe('hasRegisteredFieldNamespace', () => {
    const presetLeaf = {
      kind: 'fieldPreset',
      output: { codecId: 'test/text@1', nativeType: 'text' },
    } as const;

    it('returns true for a non-leaf namespace key', () => {
      expect(
        hasRegisteredFieldNamespace({ field: { temporal: { createdAt: presetLeaf } } }, 'temporal'),
      ).toBe(true);
    });

    it('returns true for an empty sub-namespace', () => {
      expect(hasRegisteredFieldNamespace({ field: { temporal: {} } }, 'temporal')).toBe(true);
    });

    it('returns false for a leaf preset registered at the root', () => {
      expect(hasRegisteredFieldNamespace({ field: { temporal: presetLeaf } }, 'temporal')).toBe(
        false,
      );
    });

    it('returns false for missing contributions or unknown key', () => {
      expect(hasRegisteredFieldNamespace(undefined, 'temporal')).toBe(false);
      expect(hasRegisteredFieldNamespace({}, 'temporal')).toBe(false);
      expect(hasRegisteredFieldNamespace({ field: {} }, 'temporal')).toBe(false);
    });
  });

  it('rejects arg refs with invalid index or path', () => {
    expect(isAuthoringArgRef({ kind: 'arg', index: 0 })).toBe(true);
    expect(isAuthoringArgRef({ kind: 'arg', index: 0, path: ['a', 'b'] })).toBe(true);

    expect(isAuthoringArgRef({ kind: 'arg', index: -1 })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: 1.5 })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: Number.NaN })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: 0, path: [1] })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: 0, path: 'not-array' })).toBe(false);
  });

  it('resolves array template values', () => {
    expect(
      resolveAuthoringTemplateValue(
        [
          {
            kind: 'arg',
            index: 0,
          },
          {
            kind: 'arg',
            index: 1,
            default: 'fallback',
          },
        ],
        ['value'],
      ),
    ).toEqual(['value', 'fallback']);
  });

  it('validates supported helper argument kinds', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [
          { kind: 'string' },
          { kind: 'stringArray' },
          {
            kind: 'object',
            properties: {
              label: { kind: 'string' },
              length: { kind: 'number', integer: true, minimum: 1, maximum: 3 },
            },
          },
          { kind: 'number', optional: true, minimum: 0 },
        ],
        ['vector', ['a', 'b'], { label: 'embedding', length: 2 }, 0],
      ),
    ).not.toThrow();
  });

  it('allows omitted optional helper arguments', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'string' }, { kind: 'number', optional: true }],
        ['name'],
      ),
    ).not.toThrow();
  });

  it('rejects missing required helper arguments', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'object', properties: { label: { kind: 'string' } } }],
        [{}],
      ),
    ).toThrow(/Missing required authoring helper argument at field\.test\[0\]\.label/);
  });

  it('rejects malformed helper argument values', () => {
    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'string' }], [123]),
    ).toThrow(/must be a string/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'stringArray' }], [['ok', 1]]),
    ).toThrow(/must be an array of strings/);

    const sparseArray = new Array(2);
    sparseArray[1] = 'id';
    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'stringArray' }], [sparseArray]),
    ).toThrow(/must be an array of strings/);

    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'object', properties: { label: { kind: 'string' } } }],
        ['not-an-object'],
      ),
    ).toThrow(/must be an object/);

    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'object', properties: { label: { kind: 'string' } } }],
        [{ label: 'ok', extra: true }],
      ),
    ).toThrow(/contains unknown property "extra"/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'number' }], ['x']),
    ).toThrow(/must be a number/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'number', integer: true }], [1.5]),
    ).toThrow(/must be an integer/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'number', minimum: 2 }], [1]),
    ).toThrow(/must be >= 2, received 1/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'number', maximum: 2 }], [3]),
    ).toThrow(/must be <= 2, received 3/);
  });

  it('rejects invalid helper argument counts', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'string' }, { kind: 'number', optional: true }],
        [],
      ),
    ).toThrow(/expects 1-2 argument\(s\), received 0/);

    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'string' }], ['a', 'b']),
    ).toThrow(/expects 1 argument\(s\), received 2/);
  });

  it('computes minimum arity from last required slot, not count of required slots', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'number', optional: true }, { kind: 'string' }],
        [],
      ),
    ).toThrow(/expects 2 argument\(s\), received 0/);

    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'number', optional: true }, { kind: 'string' }],
        [42],
      ),
    ).toThrow(/expects 2 argument\(s\), received 1/);

    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'number', optional: true }, { kind: 'string' }],
        [42, 'hello'],
      ),
    ).not.toThrow();
  });

  it('ignores prototype-chain values when resolving arg paths', () => {
    const descriptor = {
      kind: 'typeConstructor',
      output: {
        codecId: 'test/text@1',
        nativeType: 'text',
        typeParams: {
          label: {
            kind: 'arg',
            index: 0,
            path: ['label'],
            default: 'fallback',
          },
        },
      },
    } as const;

    const args = [Object.create({ label: 'prototype-label' })];

    expect(instantiateAuthoringTypeConstructor(descriptor, args)).toEqual({
      codecId: 'test/text@1',
      nativeType: 'text',
      typeParams: { label: 'fallback' },
    });
  });

  it('rejects instantiation of an output template without a nativeType', () => {
    const descriptor = {
      kind: 'typeConstructor',
      output: { codecId: 'test/text@1' },
    } as const;

    expect(() => instantiateAuthoringTypeConstructor(descriptor, [])).toThrow(
      /declares no nativeType; only entity-ref constructors may omit it/,
    );
  });

  it('rejects malformed resolved typeParams values', () => {
    const descriptor = {
      kind: 'typeConstructor',
      output: {
        codecId: 'test/vector@1',
        nativeType: 'vector',
        typeParams: {
          kind: 'arg',
          index: 0,
        },
      },
      // Intentional test-only double-cast to inject malformed runtime shape.
    } as unknown as AuthoringTypeConstructorDescriptor;

    expect(() => instantiateAuthoringTypeConstructor(descriptor, ['not-an-object'])).toThrow(
      /Resolved authoring typeParams must be an object/,
    );
  });

  it('rejects object-valued function default expressions', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/text@1',
        nativeType: 'text',
        default: {
          kind: 'function',
          expression: {
            kind: 'arg',
            index: 0,
          },
        },
      },
    } as const;

    expect(() =>
      instantiateAuthoringFieldPreset(descriptor, [{ sql: 'CURRENT_TIMESTAMP' }]),
    ).toThrow(/Resolved authoring function default expression must resolve to a primitive/);
  });

  it('rejects literal defaults that resolve to undefined', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/text@1',
        nativeType: 'text',
        default: {
          kind: 'literal',
          value: {
            kind: 'arg',
            index: 0,
            path: ['missing'],
          },
        },
      },
    } as const;

    expect(() => instantiateAuthoringFieldPreset(descriptor, [{}])).toThrow(
      /Resolved authoring literal default must not be undefined/,
    );
  });

  it('resolves literal defaults and execution defaults from field presets', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/vector@1',
        nativeType: 'vector',
        typeParams: {
          length: {
            kind: 'arg',
            index: 0,
          },
        },
        default: {
          kind: 'literal',
          value: {
            length: {
              kind: 'arg',
              index: 0,
            },
          },
        },
        executionDefaults: {
          onCreate: {
            kind: 'arg',
            index: 1,
          },
        },
        nullable: true,
        id: true,
        unique: true,
      },
    } as const;

    expect(
      instantiateAuthoringFieldPreset(descriptor, [
        1536,
        { kind: 'generator', id: 'vectorGenerated' },
      ]),
    ).toEqual({
      descriptor: {
        codecId: 'test/vector@1',
        nativeType: 'vector',
        typeParams: { length: 1536 },
      },
      nullable: true,
      default: {
        kind: 'literal',
        value: {
          length: 1536,
        },
      },
      executionDefaults: {
        onCreate: { kind: 'generator', id: 'vectorGenerated' },
      },
      id: true,
      unique: true,
    });
  });

  it('resolves phase-specific execution defaults from field presets', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
        executionDefaults: {
          onCreate: {
            kind: 'arg',
            index: 0,
            path: ['create'],
          },
          onUpdate: {
            kind: 'arg',
            index: 0,
            path: ['update'],
          },
        },
      },
    } as const;

    expect(
      instantiateAuthoringFieldPreset(descriptor, [
        {
          create: { kind: 'generator', id: 'timestampNow' },
          update: { kind: 'generator', id: 'timestampNow' },
        },
      ]),
    ).toEqual({
      descriptor: {
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
      },
      nullable: false,
      executionDefaults: {
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
      id: false,
      unique: false,
    });
  });

  it('rejects executionDefaults phases that resolve to non-generator values', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
        executionDefaults: {
          onCreate: {
            kind: 'arg',
            index: 0,
          },
        },
      },
    } as const;

    expect(() => instantiateAuthoringFieldPreset(descriptor, ['not-a-generator'])).toThrow(
      /Authoring preset executionDefaults\.onCreate did not resolve to a valid generator descriptor/,
    );
  });

  it('rejects executionDefaults phases whose generator id is not a string', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
        executionDefaults: {
          onUpdate: {
            kind: 'arg',
            index: 0,
          },
        },
      },
    } as const;

    expect(() =>
      instantiateAuthoringFieldPreset(descriptor, [{ kind: 'generator', id: 42 }]),
    ).toThrow(
      /Authoring preset executionDefaults\.onUpdate did not resolve to a valid generator descriptor/,
    );
  });

  it('validates option-kind arguments', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'option', values: ['now'] }],
        ['now'],
      ),
    ).not.toThrow();
  });

  it('rejects an option-kind argument value not in the descriptor values', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'option', values: ['now'] }],
        ['later'],
      ),
    ).toThrow(/Authoring helper argument at field\.test\[0\] must be one of: now/);
  });

  it('rejects a non-string value for an option-kind argument', () => {
    expect(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'option', values: ['now'] }], [42]),
    ).toThrow(/Authoring helper argument at field\.test\[0\] must be one of: now/);
  });

  it('rejects a missing required option-kind argument', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'option', values: ['now'] }],
        [undefined],
      ),
    ).toThrow(/Missing required authoring helper argument at field\.test\[0\]/);
  });

  it('allows an omitted optional option-kind argument', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'field.test',
        [{ kind: 'option', values: ['now'], optional: true }],
        [undefined],
      ),
    ).not.toThrow();
  });

  describe('resolveAuthoringTemplateValue with a select node', () => {
    it('resolves the case the argument value selects, recursively', () => {
      expect(
        resolveAuthoringTemplateValue(
          {
            kind: 'select',
            index: 0,
            cases: { now: { kind: 'generator', id: { kind: 'arg', index: 1 } } },
          },
          ['now', 'timestampNow'],
        ),
      ).toEqual({ kind: 'generator', id: 'timestampNow' });
    });

    it('throws when the resolved value has no case', () => {
      expect(() =>
        resolveAuthoringTemplateValue({ kind: 'select', index: 0, cases: { now: 'resolved' } }, [
          'later',
        ]),
      ).toThrow(/Authoring template select has no case for value "later"/);
    });

    it('resolves undefined for an absent argument', () => {
      expect(
        resolveAuthoringTemplateValue({ kind: 'select', index: 0, cases: { now: 'resolved' } }, [
          undefined,
        ]),
      ).toBeUndefined();
    });

    it('walks path into an object argument before selecting', () => {
      expect(
        resolveAuthoringTemplateValue(
          { kind: 'select', index: 0, path: ['mode'], cases: { now: 'resolved' } },
          [{ mode: 'now' }],
        ),
      ).toBe('resolved');
    });

    it('omits an executionDefaults phase whose select argument is absent', () => {
      const descriptor = {
        kind: 'fieldPreset',
        args: [{ name: 'onCreate', kind: 'option', values: ['now'], optional: true }],
        output: {
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
          executionDefaults: {
            onCreate: { kind: 'select', index: 0, cases: { now: { kind: 'generator', id: 'g' } } },
          },
        },
      } as const;

      expect(instantiateAuthoringFieldPreset(descriptor, [undefined])).not.toHaveProperty(
        'executionDefaults',
      );
      expect(instantiateAuthoringFieldPreset(descriptor, ['now']).executionDefaults).toEqual({
        onCreate: { kind: 'generator', id: 'g' },
      });
    });
  });

  describe('select templates validated against option arguments at registration', () => {
    const presetWith = (args: readonly unknown[], onCreate: unknown): Record<string, unknown> => ({
      stamped: {
        kind: 'fieldPreset',
        args,
        output: {
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
          executionDefaults: { onCreate },
        },
      },
    });
    const check = (fieldNamespace: Record<string, unknown>) => () =>
      assertNoCrossRegistryCollisions({}, fieldNamespace as never);

    it('accepts a select whose cases exactly cover the option values', () => {
      expect(
        check(
          presetWith([{ name: 'onCreate', kind: 'option', values: ['now'], optional: true }], {
            kind: 'select',
            index: 0,
            cases: { now: { kind: 'generator', id: 'g' } },
          }),
        ),
      ).not.toThrow();
    });

    it('rejects a select missing a case for a declared option value', () => {
      expect(
        check(
          presetWith(
            [{ name: 'onCreate', kind: 'option', values: ['now', 'later'], optional: true }],
            { kind: 'select', index: 0, cases: { now: { kind: 'generator', id: 'g' } } },
          ),
        ),
      ).toThrow(
        /Authoring field helper "stamped" option argument "onCreate" allows \[now, later\] but the select template has no case for: later/,
      );
    });

    it('rejects a select carrying a case no option value can reach', () => {
      expect(
        check(
          presetWith([{ name: 'onCreate', kind: 'option', values: ['now'], optional: true }], {
            kind: 'select',
            index: 0,
            cases: {
              now: { kind: 'generator', id: 'g' },
              later: { kind: 'generator', id: 'g' },
            },
          }),
        ),
      ).toThrow(
        /Authoring field helper "stamped" select template has case\(s\) not allowed by option argument "onCreate": later/,
      );
    });

    it('rejects a select whose argument is not an option', () => {
      expect(
        check(
          presetWith([{ name: 'onCreate', kind: 'string', optional: true }], {
            kind: 'select',
            index: 0,
            cases: { now: { kind: 'generator', id: 'g' } },
          }),
        ),
      ).toThrow(
        /Authoring field helper "stamped" select template references argument #1, which is kind "string"; select requires an option argument/,
      );
    });

    it('rejects a select referencing an undeclared argument position', () => {
      expect(
        check(
          presetWith([], {
            kind: 'select',
            index: 0,
            cases: { now: { kind: 'generator', id: 'g' } },
          }),
        ),
      ).toThrow(
        /Authoring field helper "stamped" select template references argument #1, but the helper declares no argument at that position/,
      );
    });

    it('validates a select that paths into an object-argument option property', () => {
      const objectArg = {
        kind: 'object',
        optional: true,
        properties: { mode: { kind: 'option', values: ['now'] } },
      };
      expect(
        check(
          presetWith([objectArg], {
            kind: 'select',
            index: 0,
            path: ['mode'],
            cases: { now: { kind: 'generator', id: 'g' } },
          }),
        ),
      ).not.toThrow();
      expect(
        check(
          presetWith([objectArg], {
            kind: 'select',
            index: 0,
            path: ['mode'],
            cases: { sometime: { kind: 'generator', id: 'g' } },
          }),
        ),
      ).toThrow(/has no case for: now/);
    });
  });

  describe('execution-defaults phase omission', () => {
    it('omits a phase whose template resolves to undefined', () => {
      const descriptor = {
        kind: 'fieldPreset',
        output: {
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
          executionDefaults: {
            onCreate: { kind: 'arg', index: 0 },
            onUpdate: { kind: 'generator', id: 'timestampNow' },
          },
        },
      } as const;

      expect(instantiateAuthoringFieldPreset(descriptor, [undefined]).executionDefaults).toEqual({
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      });
    });

    it('omits executionDefaults entirely when every phase resolves to undefined', () => {
      const descriptor = {
        kind: 'fieldPreset',
        output: {
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
          executionDefaults: {
            onCreate: { kind: 'arg', index: 0 },
            onUpdate: { kind: 'arg', index: 1 },
          },
        },
      } as const;

      const result = instantiateAuthoringFieldPreset(descriptor, [undefined, undefined]);
      expect(result).not.toHaveProperty('executionDefaults');
    });

    it('carries only the defined phase when one of two resolves to undefined', () => {
      const descriptor = {
        kind: 'fieldPreset',
        output: {
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
          executionDefaults: {
            onCreate: { kind: 'arg', index: 0 },
            onUpdate: { kind: 'arg', index: 1 },
          },
        },
      } as const;

      expect(
        instantiateAuthoringFieldPreset(descriptor, [
          { kind: 'generator', id: 'timestampNow' },
          undefined,
        ]).executionDefaults,
      ).toEqual({ onCreate: { kind: 'generator', id: 'timestampNow' } });
    });
  });

  describe('empty resolved typeParams omission', () => {
    it('omits typeParams when the resolved value has no keys', () => {
      const descriptor = {
        kind: 'typeConstructor',
        output: {
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
          typeParams: { precision: { kind: 'arg', index: 0 } },
        },
      } as const;

      expect(instantiateAuthoringTypeConstructor(descriptor, [undefined])).toEqual({
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
      });
    });

    it('keeps typeParams when the resolved value has at least one key', () => {
      const descriptor = {
        kind: 'typeConstructor',
        output: {
          codecId: 'test/timestamp@1',
          nativeType: 'timestamp',
          typeParams: { precision: { kind: 'arg', index: 0 } },
        },
      } as const;

      expect(instantiateAuthoringTypeConstructor(descriptor, [3])).toEqual({
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
        typeParams: { precision: 3 },
      });
    });
  });

  it('regression: a static executionDefaults template (e.g. temporalAuthoringPresets shape) resolves unchanged', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/timestamp@1',
        nativeType: 'timestamp',
        executionDefaults: {
          onCreate: { kind: 'generator', id: 'timestampNow' },
          onUpdate: { kind: 'generator', id: 'timestampNow' },
        },
      },
    } as const;

    expect(instantiateAuthoringFieldPreset(descriptor, [])).toEqual({
      descriptor: { codecId: 'test/timestamp@1', nativeType: 'timestamp' },
      nullable: false,
      executionDefaults: {
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
      id: false,
      unique: false,
    });
  });

  it('stringifies primitive function default expressions', () => {
    const descriptor = {
      kind: 'fieldPreset',
      output: {
        codecId: 'test/text@1',
        nativeType: 'text',
        default: {
          kind: 'function',
          expression: {
            kind: 'arg',
            index: 0,
          },
        },
      },
    } as const;

    expect(instantiateAuthoringFieldPreset(descriptor, [123]).default).toEqual({
      kind: 'function',
      expression: '123',
    });
  });
});

describe('collectScalarTypeConstructors', () => {
  it('collects top-level zero-arg constructors with explicit nativeType as {codecId, nativeType}', () => {
    const namespace = {
      String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } },
      Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
    } satisfies AuthoringTypeNamespace;

    expect(Object.fromEntries(collectScalarTypeConstructors(namespace))).toEqual({
      String: { codecId: 'pg/text@1', nativeType: 'text' },
      Int: { codecId: 'pg/int4@1', nativeType: 'int4' },
    });
  });

  it('excludes namespaced constructors from the scalar view', () => {
    const namespace = {
      String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } },
      sql: {
        String: {
          kind: 'typeConstructor',
          args: [{ kind: 'number', name: 'length' }],
          output: { codecId: 'sql/varchar@1', nativeType: 'character varying' },
        },
      },
    } satisfies AuthoringTypeNamespace;

    expect([...collectScalarTypeConstructors(namespace).keys()]).toEqual(['String']);
  });

  it('excludes top-level constructors that declare required args', () => {
    const namespace = {
      Vector: {
        kind: 'typeConstructor',
        args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
        output: { codecId: 'pg/vector@1', nativeType: 'vector' },
      },
    } satisfies AuthoringTypeNamespace;

    expect(collectScalarTypeConstructors(namespace).size).toBe(0);
  });

  it('includes an all-optional-args constructor with exactly its zero-arg instantiation output', () => {
    const VarCharish = {
      kind: 'typeConstructor',
      args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
      output: {
        codecId: 'sql/varchar@1',
        nativeType: 'character varying',
        typeParams: { length: { kind: 'arg', index: 0 } },
      },
    } satisfies AuthoringTypeConstructorDescriptor;
    const namespace = { VarCharish } satisfies AuthoringTypeNamespace;

    const bare = collectScalarTypeConstructors(namespace).get('VarCharish');
    expect(bare).toEqual(instantiateAuthoringTypeConstructor(VarCharish, []));
    expect(bare).toEqual({
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
    });
  });

  it('applies a template default in bare form, same as the zero-arg call', () => {
    const Defaulted = {
      kind: 'typeConstructor',
      args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
      output: {
        codecId: 'sql/varchar@1',
        nativeType: 'character varying',
        typeParams: { length: { kind: 'arg', index: 0, default: 191 } },
      },
    } satisfies AuthoringTypeConstructorDescriptor;
    const namespace = { Defaulted } satisfies AuthoringTypeNamespace;

    const bare = collectScalarTypeConstructors(namespace).get('Defaulted');
    expect(bare).toEqual(instantiateAuthoringTypeConstructor(Defaulted, []));
    expect(bare).toEqual({
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: 191 },
    });
  });

  it('excludes constructors mixing an optional arg with a required one', () => {
    const namespace = {
      Mixed: {
        kind: 'typeConstructor',
        args: [
          { kind: 'number', name: 'precision', integer: true },
          { kind: 'number', name: 'scale', integer: true, optional: true },
        ],
        output: { codecId: 'pg/numeric@1', nativeType: 'numeric' },
      },
    } satisfies AuthoringTypeNamespace;

    expect(collectScalarTypeConstructors(namespace).size).toBe(0);
  });

  it('excludes all-optional constructors that declare an entityRefArg', () => {
    const namespace = {
      Ref: {
        kind: 'typeConstructor',
        args: [{ kind: 'string', name: 'entity', optional: true }],
        entityRefArg: { index: 0, entityKind: 'native_enum' },
        output: { codecId: 'pg/enum@1', nativeType: 'enum' },
      },
    } satisfies AuthoringTypeNamespace;

    expect(collectScalarTypeConstructors(namespace).size).toBe(0);
  });

  it('excludes top-level constructors that declare an entityRefArg', () => {
    const namespace = {
      enum: {
        kind: 'typeConstructor',
        entityRefArg: { index: 0, entityKind: 'native_enum' },
        output: { codecId: 'pg/enum@1' },
      },
    } satisfies AuthoringTypeNamespace;

    expect(collectScalarTypeConstructors(namespace).size).toBe(0);
  });

  it('treats an explicit empty args array as zero-arg', () => {
    const namespace = {
      Plain: { kind: 'typeConstructor', args: [], output: { codecId: 'a@1', nativeType: 'text' } },
    } satisfies AuthoringTypeNamespace;

    expect(Object.fromEntries(collectScalarTypeConstructors(namespace))).toEqual({
      Plain: { codecId: 'a@1', nativeType: 'text' },
    });
  });
});

describe('classifyEnumMemberType', () => {
  const testSpan = {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 0, line: 1, column: 1 },
  };

  function testBlock(parameters: Record<string, PslExtensionBlockParamValue>): PslExtensionBlock {
    return {
      kind: 'enum',
      keyword: 'enum',
      name: 'TestEnum',
      parameters,
      blockAttributes: [],
      attributes: {},
      span: testSpan,
    };
  }

  const bare: PslExtensionBlockParamValue = { kind: 'bare', span: testSpan };
  const value = (raw: string): PslExtensionBlockParamValue => ({
    kind: 'value',
    raw,
    span: testSpan,
  });
  const ref: PslExtensionBlockParamValue = { kind: 'ref', identifier: 'Foo', span: testSpan };
  const option: PslExtensionBlockParamValue = { kind: 'option', token: 'Foo', span: testSpan };
  const list: PslExtensionBlockParamValue = { kind: 'list', items: [], span: testSpan };

  it('classifies all-bare members as text', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: bare, User: bare }))).toBe('text');
  });

  it('classifies all-string-value members as text', () => {
    expect(
      classifyEnumMemberType(testBlock({ Admin: value('"admin"'), User: value('"user"') })),
    ).toBe('text');
  });

  it('classifies a mix of bare and string-value members as text', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: bare, User: value('"user"') }))).toBe('text');
  });

  it('classifies all-integer-value members as int', () => {
    expect(classifyEnumMemberType(testBlock({ Low: value('1'), High: value('10') }))).toBe('int');
  });

  it('returns null for a float value', () => {
    expect(classifyEnumMemberType(testBlock({ Low: value('1.5') }))).toBeNull();
  });

  it('returns null for a boolean value', () => {
    expect(classifyEnumMemberType(testBlock({ Flag: value('true') }))).toBeNull();
  });

  it('returns null for a mix of string and integer values', () => {
    expect(
      classifyEnumMemberType(testBlock({ Low: value('1'), High: value('"high"') })),
    ).toBeNull();
  });

  it('returns null for a mix of bare and integer values', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: bare, Low: value('1') }))).toBeNull();
  });

  it('returns null for a ref parameter', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: ref }))).toBeNull();
  });

  it('returns null for an option parameter', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: option }))).toBeNull();
  });

  it('returns null for a list parameter', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: list }))).toBeNull();
  });

  it('returns null for invalid JSON in a value parameter', () => {
    expect(classifyEnumMemberType(testBlock({ Admin: value('notjson') }))).toBeNull();
  });

  it('returns null for an enum with no members', () => {
    expect(classifyEnumMemberType(testBlock({}))).toBeNull();
  });
});
