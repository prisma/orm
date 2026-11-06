import type { AuthoringArgumentDescriptor } from '@internal/framework-components/authoring';
import { expectTypeOf, test } from 'vitest';
import type { TupleFromArgumentDescriptors } from '../src/authoring-argument-types';

type ValueTypes = {
  readonly 'test/int@1': { readonly argument: number; readonly parameter: number };
};

const lengthThenPrecision = [
  { kind: 'value', dataType: 'test/int@1', name: 'length' },
  { kind: 'value', dataType: 'test/int@1', name: 'precision', optional: true },
] as const satisfies readonly AuthoringArgumentDescriptor[];

type Params = TupleFromArgumentDescriptors<typeof lengthThenPrecision, ValueTypes>;

function call<const P extends Params>(...args: P): P {
  return args;
}

test('a required value argument gets a required slot and an optional one an optional slot', () => {
  expectTypeOf<Params>().toEqualTypeOf<readonly [number, number?]>();
});

test('a call may leave out the optional argument but not the required one', () => {
  call(36);
  call(36, 3);
  // @ts-expect-error the length is required
  call();
});
