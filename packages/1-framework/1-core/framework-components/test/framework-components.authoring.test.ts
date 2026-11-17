import { describe, expect, it } from 'vitest';
import { collectScalarTypeConstructors } from '../src/shared/authoring-type-choice';
import type {
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '../src/shared/framework-authoring';
import {
  assertNoCrossRegistryCollisions,
  classifyEnumMemberType,
  instantiateAuthoringTypeConstructor,
  isAuthoringArgRef,
  isAuthoringTypeConstructorDescriptor,
  resolveAuthoringTemplateValue,
  validateAuthoringHelperArguments,
} from '../src/shared/framework-authoring';

describe('authoring template resolution', () => {
  const typeConstructor = {
    kind: 'typeConstructor',
    output: { codecId: 'test/text@1' },
  } satisfies AuthoringTypeConstructorDescriptor;

  it('narrows a descriptor by kind', () => {
    expect(isAuthoringTypeConstructorDescriptor(typeConstructor)).toBe(true);
  });

  it('classifies a sub-namespace as not a descriptor', () => {
    const typeNamespace = { nested: typeConstructor } satisfies AuthoringTypeNamespace;
    expect(isAuthoringTypeConstructorDescriptor(typeNamespace)).toBe(false);
  });

  it('rejects arg refs with an invalid index', () => {
    expect(isAuthoringArgRef({ kind: 'arg', index: 0 })).toBe(true);

    expect(isAuthoringArgRef({ kind: 'arg', index: -1 })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: 1.5 })).toBe(false);
    expect(isAuthoringArgRef({ kind: 'arg', index: Number.NaN })).toBe(false);
  });

  it('resolves array template values, an absent argument to undefined', () => {
    expect(
      resolveAuthoringTemplateValue(
        [
          { kind: 'arg', index: 0 },
          { kind: 'arg', index: 1 },
        ],
        ['value'],
      ),
    ).toEqual(['value', undefined]);
  });

  it('omits an object template key whose argument is absent', () => {
    expect(
      resolveAuthoringTemplateValue(
        { length: { kind: 'arg', index: 0 }, scale: { kind: 'arg', index: 1 } },
        [8],
      ),
    ).toEqual({ length: 8 });
  });

  it('checks only that a value argument is present: its value is already a value of its data type', () => {
    const descriptors = [{ kind: 'value', dataType: 'demo/int4', name: 'length' }] as const;
    expect(() =>
      validateAuthoringHelperArguments('type.Sized', descriptors, ['not a number']),
    ).not.toThrow();
    expect(() => validateAuthoringHelperArguments('type.Sized', descriptors, [undefined])).toThrow(
      'Argument "length" of type.Sized is missing',
    );
  });

  it('allows omitted optional helper arguments', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'type.test',
        [
          { kind: 'value', dataType: 'demo/text' },
          { kind: 'value', dataType: 'demo/int4', optional: true },
        ],
        ['name'],
      ),
    ).not.toThrow();
  });

  it('rejects invalid helper argument counts', () => {
    expect(() =>
      validateAuthoringHelperArguments(
        'type.test',
        [
          { kind: 'value', dataType: 'demo/text' },
          { kind: 'value', dataType: 'demo/int4', optional: true },
        ],
        [],
      ),
    ).toThrow(/expects 1-2 argument\(s\), received 0/);

    expect(() =>
      validateAuthoringHelperArguments(
        'type.test',
        [{ kind: 'value', dataType: 'demo/text' }],
        ['a', 'b'],
      ),
    ).toThrow(/expects 1 argument\(s\), received 2/);
  });

  it('computes minimum arity from last required slot, not count of required slots', () => {
    const descriptors = [
      { kind: 'value', dataType: 'demo/int4', optional: true },
      { kind: 'value', dataType: 'demo/text' },
    ] as const;
    expect(() => validateAuthoringHelperArguments('type.test', descriptors, [])).toThrow(
      /expects 2 argument\(s\), received 0/,
    );
    expect(() => validateAuthoringHelperArguments('type.test', descriptors, [42])).toThrow(
      /expects 2 argument\(s\), received 1/,
    );
    expect(() =>
      validateAuthoringHelperArguments('type.test', descriptors, [42, 'hello']),
    ).not.toThrow();
  });

  it('instantiates an output template to its codec and parameters, naming no database type', () => {
    const descriptor = {
      kind: 'typeConstructor',
      output: { codecId: 'test/text@1' },
    } as const;

    expect(instantiateAuthoringTypeConstructor(descriptor, [])).toEqual({ codecId: 'test/text@1' });
  });

  it('rejects malformed resolved typeParams values', () => {
    const descriptor = {
      kind: 'typeConstructor',
      output: {
        codecId: 'test/vector@1',
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

  describe('empty resolved typeParams omission', () => {
    it('omits typeParams when the resolved value has no keys', () => {
      const descriptor = {
        kind: 'typeConstructor',
        output: {
          codecId: 'test/timestamp@1',
          typeParams: { precision: { kind: 'arg', index: 0 } },
        },
      } as const;

      expect(instantiateAuthoringTypeConstructor(descriptor, [undefined])).toEqual({
        codecId: 'test/timestamp@1',
      });
    });

    it('keeps typeParams when the resolved value has at least one key', () => {
      const descriptor = {
        kind: 'typeConstructor',
        output: {
          codecId: 'test/timestamp@1',
          typeParams: { precision: { kind: 'arg', index: 0 } },
        },
      } as const;

      expect(instantiateAuthoringTypeConstructor(descriptor, [3])).toEqual({
        codecId: 'test/timestamp@1',
        typeParams: { precision: 3 },
      });
    });
  });
});

describe('assertNoCrossRegistryCollisions', () => {
  it('rejects a path registered both as an entity and as a type constructor', () => {
    expect(() =>
      assertNoCrossRegistryCollisions(
        { custom: { Thing: { kind: 'typeConstructor', output: { codecId: 'a@1' } } } },
        {
          custom: {
            Thing: { kind: 'entity', discriminator: 'thing', output: { factory: () => ({}) } },
          },
        },
      ),
    ).toThrow(
      'Ambiguous authoring registry path "custom.Thing". The same path is registered as an entity contribution AND as a type constructor or type alias; PSL resolution would be ambiguous.',
    );
  });
});

describe('collectScalarTypeConstructors', () => {
  it('collects top-level zero-arg constructors as {codecId}', () => {
    const namespace = {
      String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1' } },
      Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1' } },
    } satisfies AuthoringTypeNamespace;

    expect(Object.fromEntries(collectScalarTypeConstructors(namespace))).toEqual({
      String: { codecId: 'pg/text@1' },
      Int: { codecId: 'pg/int4@1' },
    });
  });

  it('excludes namespaced constructors from the scalar view', () => {
    const namespace = {
      String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1' } },
      sql: {
        String: {
          kind: 'typeConstructor',
          args: [{ kind: 'value', dataType: 'demo/int4', name: 'length' }],
          output: { codecId: 'sql/varchar@1' },
        },
      },
    } satisfies AuthoringTypeNamespace;

    expect([...collectScalarTypeConstructors(namespace).keys()]).toEqual(['String']);
  });

  it('excludes top-level constructors that declare required args', () => {
    const namespace = {
      Vector: {
        kind: 'typeConstructor',
        args: [{ kind: 'value', dataType: 'demo/int4', name: 'length' }],
        output: { codecId: 'pg/vector@1' },
      },
    } satisfies AuthoringTypeNamespace;

    expect(collectScalarTypeConstructors(namespace).size).toBe(0);
  });

  it('includes an all-optional-args constructor with exactly its zero-arg instantiation output', () => {
    const VarCharish = {
      kind: 'typeConstructor',
      args: [{ kind: 'value', dataType: 'demo/int4', name: 'length', optional: true }],
      output: {
        codecId: 'sql/varchar@1',
        typeParams: { length: { kind: 'arg', index: 0 } },
      },
    } satisfies AuthoringTypeConstructorDescriptor;
    const namespace = { VarCharish } satisfies AuthoringTypeNamespace;

    const bare = collectScalarTypeConstructors(namespace).get('VarCharish');
    expect(bare).toEqual(instantiateAuthoringTypeConstructor(VarCharish, []));
    expect(bare).toEqual({
      codecId: 'sql/varchar@1',
    });
  });

  it('excludes constructors mixing an optional arg with a required one', () => {
    const namespace = {
      Mixed: {
        kind: 'typeConstructor',
        args: [
          { kind: 'value', dataType: 'demo/int4', name: 'precision' },
          { kind: 'value', dataType: 'demo/int4', name: 'scale', optional: true },
        ],
        output: { codecId: 'pg/numeric@1' },
      },
    } satisfies AuthoringTypeNamespace;

    expect(collectScalarTypeConstructors(namespace).size).toBe(0);
  });

  it('excludes all-optional constructors that declare an entityRefArg', () => {
    const namespace = {
      Ref: {
        kind: 'typeConstructor',
        args: [{ kind: 'value', dataType: 'pg/text', name: 'entity', optional: true }],
        entityRefArg: { index: 0, entityKind: 'native_enum' },
        output: { codecId: 'pg/enum@1' },
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
      Plain: { kind: 'typeConstructor', args: [], output: { codecId: 'a@1' } },
    } satisfies AuthoringTypeNamespace;

    expect(Object.fromEntries(collectScalarTypeConstructors(namespace))).toEqual({
      Plain: { codecId: 'a@1' },
    });
  });
});

describe('classifyEnumMemberType', () => {
  it('classifies all-bare members (undefined values) as text', () => {
    expect(classifyEnumMemberType({ Admin: undefined, User: undefined })).toBe('text');
  });

  it('classifies all-string members as text', () => {
    expect(classifyEnumMemberType({ Admin: 'admin', User: 'user' })).toBe('text');
  });

  it('classifies a mix of bare and string members as text', () => {
    expect(classifyEnumMemberType({ Admin: undefined, User: 'user' })).toBe('text');
  });

  it('classifies all-integer members as int', () => {
    expect(classifyEnumMemberType({ Low: 1, High: 10 })).toBe('int');
  });

  it('returns null for a float value', () => {
    expect(classifyEnumMemberType({ Low: 1.5 })).toBeNull();
  });

  it('returns null for a boolean value', () => {
    expect(classifyEnumMemberType({ Flag: true })).toBeNull();
  });

  it('returns null for an explicit null value', () => {
    expect(classifyEnumMemberType({ Empty: null })).toBeNull();
  });

  it('returns null for a mix of string and integer values', () => {
    expect(classifyEnumMemberType({ Low: 1, High: 'high' })).toBeNull();
  });

  it('returns null for a mix of bare and integer values', () => {
    expect(classifyEnumMemberType({ Admin: undefined, Low: 1 })).toBeNull();
  });

  it('returns null for a structured value', () => {
    expect(classifyEnumMemberType({ Admin: { nested: true } })).toBeNull();
  });

  it('returns null for an enum with no members', () => {
    expect(classifyEnumMemberType({})).toBeNull();
  });
});
