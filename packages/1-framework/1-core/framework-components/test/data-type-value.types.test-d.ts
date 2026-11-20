import { describe, expectTypeOf, it } from 'vitest';
import { type DataTypeValue, dataType } from '../src/shared/data-type';

describe('DataTypeValue', () => {
  it('is constructed only by a data type', () => {
    const type = dataType('demo/text', { read: (json) => json });
    expectTypeOf(type.fromContract('a', {})).toEqualTypeOf<DataTypeValue>();
    // @ts-expect-error an object literal is not a value of a data type
    const literal: DataTypeValue = { type: type.id, params: {}, value: 'a' };
    expectTypeOf(literal).toEqualTypeOf<DataTypeValue>();
  });

  it('carries the type of its JSON', () => {
    expectTypeOf<DataTypeValue<string>['value']>().toEqualTypeOf<string>();
  });
});
