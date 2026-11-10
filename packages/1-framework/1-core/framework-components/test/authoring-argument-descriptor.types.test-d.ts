import { describe, expectTypeOf, it } from 'vitest';
import type {
  AuthoringArgRef,
  AuthoringArgumentDescriptor,
} from '../src/shared/framework-authoring';

describe('AuthoringArgumentDescriptor', () => {
  it('is a value of a data type, with its name and whether it is optional', () => {
    const length = {
      kind: 'value',
      dataType: 'pg/int4',
      name: 'length',
      optional: true,
    } as const;
    expectTypeOf(length).toExtend<AuthoringArgumentDescriptor>();
  });

  it('has no option, number or object kind', () => {
    // @ts-expect-error an option argument is not an authoring argument
    const option: AuthoringArgumentDescriptor = { kind: 'option', values: [] };
    // @ts-expect-error a number argument is not an authoring argument
    const number: AuthoringArgumentDescriptor = { kind: 'number' };
    // @ts-expect-error an object argument is not an authoring argument
    const object: AuthoringArgumentDescriptor = { kind: 'object', properties: {} };
    expectTypeOf([option, number, object]).toBeArray();
  });
});

describe('AuthoringArgRef', () => {
  it('names an argument by its index only', () => {
    // @ts-expect-error an argument reference has no path
    const withPath: AuthoringArgRef = { kind: 'arg', index: 0, path: ['x'] };
    // @ts-expect-error an argument reference has no default
    const withDefault: AuthoringArgRef = { kind: 'arg', index: 0, default: 1 };
    expectTypeOf([withPath, withDefault]).toBeArray();
  });
});
