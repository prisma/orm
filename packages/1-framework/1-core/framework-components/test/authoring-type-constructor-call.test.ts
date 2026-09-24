import { describe, expect, it } from 'vitest';
import { findAuthoringTypeConstructorCall } from '../src/shared/authoring-type-constructor-call';
import type { AuthoringTypeNamespace } from '../src/shared/framework-authoring';

const namespace = {
  Text: {
    kind: 'typeConstructor',
    output: { codecId: 'test/text@1', nativeType: 'text' },
  },
  Decimal: {
    kind: 'typeConstructor',
    args: [
      { kind: 'number', name: 'precision', integer: true, optional: true },
      { kind: 'number', name: 'scale', integer: true, optional: true },
    ],
    output: {
      codecId: 'test/numeric@1',
      nativeType: 'numeric',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  vector: {
    Vector: {
      kind: 'typeConstructor',
      args: [{ kind: 'number', name: 'length', integer: true }],
      output: {
        codecId: 'test/vector@1',
        nativeType: 'vector',
        typeParams: { length: { kind: 'arg', index: 0 } },
      },
    },
  },
  Ref: {
    kind: 'typeConstructor',
    entityRefArg: { index: 0, entityKind: 'native_enum' },
    output: { codecId: 'test/enum@1', nativeType: 'text' },
  },
} as const satisfies AuthoringTypeNamespace;

describe('findAuthoringTypeConstructorCall', () => {
  it('finds a constructor that takes no arguments', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, { codecId: 'test/text@1', nativeType: 'text' }),
    ).toEqual({ path: ['Text'], args: [] });
  });

  it('finds a nested constructor, with the arguments its type parameters come from', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/vector@1',
        nativeType: 'vector',
        typeParams: { length: 3 },
      }),
    ).toEqual({ path: ['vector', 'Vector'], args: [3] });
  });

  it('compares type parameters whatever order their keys are in', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/numeric@1',
        nativeType: 'numeric',
        typeParams: { scale: 2, precision: 10 },
      }),
    ).toEqual({ path: ['Decimal'], args: [10, 2] });
  });

  it('leaves out optional arguments the type parameters do not name', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/numeric@1',
        nativeType: 'numeric',
      }),
    ).toEqual({ path: ['Decimal'], args: [] });
  });

  it('finds nothing when no constructor produces the native type', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/text@1',
        nativeType: 'varchar',
      }),
    ).toBeUndefined();
  });

  it('finds nothing when the type parameters differ from what the constructor produces', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/text@1',
        nativeType: 'text',
        typeParams: { length: 3 },
      }),
    ).toBeUndefined();
  });

  it('finds nothing when an argument before a given one has no type parameter to come from', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/numeric@1',
        nativeType: 'numeric',
        typeParams: { scale: 2 },
      }),
    ).toBeUndefined();
  });

  it('finds nothing when a required argument has no type parameter to come from', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/vector@1',
        nativeType: 'vector',
      }),
    ).toBeUndefined();
  });

  it('never calls a constructor whose argument names another entity', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, { codecId: 'test/enum@1', nativeType: 'text' }),
    ).toBeUndefined();
  });

  it('takes the first constructor in namespace order when two produce the same output', () => {
    const twice = {
      First: { kind: 'typeConstructor', output: { codecId: 'test/text@1', nativeType: 'text' } },
      Second: { kind: 'typeConstructor', output: { codecId: 'test/text@1', nativeType: 'text' } },
    } as const satisfies AuthoringTypeNamespace;

    expect(
      findAuthoringTypeConstructorCall(twice, { codecId: 'test/text@1', nativeType: 'text' }),
    ).toEqual({ path: ['First'], args: [] });
  });
});
