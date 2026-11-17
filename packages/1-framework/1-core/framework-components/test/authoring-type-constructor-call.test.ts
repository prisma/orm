import { describe, expect, it } from 'vitest';
import {
  authoringTypeConstructorArguments,
  authoringTypeConstructors,
  findAuthoringTypeConstructorCall,
} from '../src/shared/authoring-type-constructor-call';
import type { AuthoringTypeNamespace } from '../src/shared/framework-authoring';

const namespace = {
  Text: {
    kind: 'typeConstructor',
    output: { codecId: 'test/text@1' },
  },
  Decimal: {
    kind: 'typeConstructor',
    args: [
      { kind: 'value', dataType: 'test/int', name: 'precision', optional: true },
      { kind: 'value', dataType: 'test/int', name: 'scale', optional: true },
    ],
    output: {
      codecId: 'test/numeric@1',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  vector: {
    Vector: {
      kind: 'typeConstructor',
      args: [{ kind: 'value', dataType: 'test/int', name: 'length' }],
      output: {
        codecId: 'test/vector@1',
        typeParams: { length: { kind: 'arg', index: 0 } },
      },
    },
  },
  Ref: {
    kind: 'typeConstructor',
    entityRefArg: { index: 0, entityKind: 'native_enum' },
    output: { codecId: 'test/enum@1' },
  },
} as const satisfies AuthoringTypeNamespace;

describe('findAuthoringTypeConstructorCall', () => {
  it('finds a constructor that takes no arguments', () => {
    expect(findAuthoringTypeConstructorCall(namespace, { codecId: 'test/text@1' })).toEqual({
      path: ['Text'],
      args: [],
    });
  });

  it('finds a nested constructor, with the arguments its type parameters come from', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/vector@1',
        typeParams: { length: 3 },
      }),
    ).toEqual({ path: ['vector', 'Vector'], args: [3] });
  });

  it('compares type parameters whatever order their keys are in', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/numeric@1',
        typeParams: { scale: 2, precision: 10 },
      }),
    ).toEqual({ path: ['Decimal'], args: [10, 2] });
  });

  it('leaves out optional arguments the type parameters do not name', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/numeric@1',
      }),
    ).toEqual({ path: ['Decimal'], args: [] });
  });

  it('finds nothing when no constructor produces the codec', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, { codecId: 'test/other@1' }),
    ).toBeUndefined();
  });

  it('finds nothing when the type parameters differ from what the constructor produces', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/text@1',
        typeParams: { length: 3 },
      }),
    ).toBeUndefined();
  });

  it('finds nothing when an argument before a given one has no type parameter to come from', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/numeric@1',
        typeParams: { scale: 2 },
      }),
    ).toBeUndefined();
  });

  it('finds nothing when a required argument has no type parameter to come from', () => {
    expect(
      findAuthoringTypeConstructorCall(namespace, {
        codecId: 'test/vector@1',
      }),
    ).toBeUndefined();
  });

  it('never calls a constructor whose argument names another entity', () => {
    expect(findAuthoringTypeConstructorCall(namespace, { codecId: 'test/enum@1' })).toBeUndefined();
  });

  it('takes the first constructor in namespace order when two produce the same output', () => {
    const twice = {
      First: { kind: 'typeConstructor', output: { codecId: 'test/text@1' } },
      Second: { kind: 'typeConstructor', output: { codecId: 'test/text@1' } },
    } as const satisfies AuthoringTypeNamespace;

    expect(findAuthoringTypeConstructorCall(twice, { codecId: 'test/text@1' })).toEqual({
      path: ['First'],
      args: [],
    });
  });
});

describe('authoringTypeConstructors', () => {
  it('lists every constructor with its path, nested ones included', () => {
    expect([...authoringTypeConstructors(namespace)].map(({ path }) => path)).toEqual([
      ['Text'],
      ['Decimal'],
      ['vector', 'Vector'],
      ['Ref'],
    ]);
  });
});

describe('authoringTypeConstructorArguments', () => {
  it('gives the arguments that make one constructor produce the output', () => {
    expect(
      authoringTypeConstructorArguments(namespace.Decimal, {
        codecId: 'test/numeric@1',
        typeParams: { precision: 10, scale: 2 },
      }),
    ).toEqual([10, 2]);
  });

  it('gives nothing when the constructor cannot produce the output', () => {
    expect(
      authoringTypeConstructorArguments(namespace.Decimal, { codecId: 'test/text@1' }),
    ).toBeUndefined();
  });
});
