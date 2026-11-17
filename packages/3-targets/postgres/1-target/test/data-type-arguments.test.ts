import {
  assembleDataTypeSupport,
  readWrittenValueAs,
  type WrittenScalar,
} from '@internal/framework-components/authoring';
import { dataTypeId } from '@internal/framework-components/codec';
import { describe, expect, expectTypeOf, it } from 'vitest';
import postgresPack from '../src/exports/pack';

type Declared = NonNullable<(typeof postgresPack)['__dataTypeArguments']>;

const samples: {
  readonly [DataType in keyof Declared]: {
    readonly argument: Declared[DataType]['argument'];
    readonly written: WrittenScalar;
    readonly parameter: Declared[DataType]['parameter'];
  };
} = {
  'pg/int4': { argument: 255, written: { kind: 'number', text: '255' }, parameter: 255 },
};

const { support } = assembleDataTypeSupport([postgresPack], () => undefined);

describe('the value argument types the Postgres pack declares', () => {
  it('has a sample for every declared data type', () => {
    expectTypeOf<keyof typeof samples>().toEqualTypeOf<keyof Declared>();
  });

  it.each(Object.entries(samples))('names %s, a data type the pack registers', (dataType) => {
    expect(postgresPack.dataTypes.map((type) => type.id)).toContain(dataType);
  });

  it.each(Object.entries(samples))(
    'reads a %s argument as the declared parameter',
    (dataType, { written, parameter }) => {
      const read = readWrittenValueAs(support, dataTypeId(dataType), written);
      expect(read.ok && read.value.value).toEqual(parameter);
    },
  );
});
