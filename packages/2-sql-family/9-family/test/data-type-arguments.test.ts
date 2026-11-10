import {
  assembleDataTypeSupport,
  readWrittenValueAs,
  type WrittenScalar,
} from '@internal/framework-components/authoring';
import { dataTypeId } from '@internal/framework-components/codec';
import { sql } from '@internal/sql-contract/sql-expression';
import { describe, expect, expectTypeOf, it } from 'vitest';
import sqlFamilyPack from '../src/exports/pack';

type Declared = NonNullable<(typeof sqlFamilyPack)['__dataTypeArguments']>;

const samples: {
  readonly [DataType in keyof Declared]: {
    readonly argument: Declared[DataType]['argument'];
    readonly written: WrittenScalar;
    readonly parameter: Declared[DataType]['parameter'];
  };
} = {
  'sql/expression': {
    argument: sql`"MyType"[]`,
    written: { kind: 'tag', tag: 'sql', text: '"MyType"[]' },
    parameter: '"MyType"[]',
  },
};

const { support } = assembleDataTypeSupport([sqlFamilyPack], () => undefined);

describe('the value argument types the SQL family pack declares', () => {
  it('has a sample for every declared data type', () => {
    expectTypeOf<keyof typeof samples>().toEqualTypeOf<keyof Declared>();
  });

  it.each(Object.entries(samples))('names %s, a data type the pack registers', (dataType) => {
    expect(sqlFamilyPack.dataTypes.map((type) => type.id)).toContain(dataType);
  });

  it.each(Object.entries(samples))(
    'reads a %s argument as the declared parameter',
    (dataType, { written, parameter }) => {
      const read = readWrittenValueAs(support, dataTypeId(dataType), written);
      expect(read.ok && read.value.value).toEqual(parameter);
    },
  );
});
