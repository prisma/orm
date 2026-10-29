import { describe, expect, it } from 'vitest';
import { createDataTypeLookup, dataType } from '../src/shared/data-type';
import {
  writeDataTypeValue,
  writtenTypeArguments,
  writtenTypeConstructorCall,
} from '../src/shared/data-type-literal';
import type { AuthoringTypeConstructorDescriptor } from '../src/shared/framework-authoring';
import type { DataTypeSupport } from '../src/shared/written-value';

const int = dataType('t/int', { read: (json) => json });
const text = dataType('t/text', { read: (json) => json });

const dataTypes: DataTypeSupport = {
  entries: {
    [int.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [int.id],
        classify: (written) =>
          /^\d+$/.test(written) ? { type: int.id, value: Number(written) } : undefined,
      },
      print: String,
      documentation: 'A whole number.',
    },
    [text.id]: {
      written: { kind: 'plain', syntax: 'string', parse: (written) => written },
      print: String,
      documentation: 'Text.',
    },
  },
  lookup: createDataTypeLookup([int, text]),
  dataTypeOfCodec: () => undefined,
};

const numeric: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  args: [
    { kind: 'value', dataType: 't/int', name: 'precision', optional: true },
    { kind: 'value', dataType: 't/int', name: 'scale', optional: true },
  ],
  output: { codecId: 't/numeric@1' },
};

const labelled: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  args: [{ kind: 'value', dataType: 't/text', name: 'label' }],
  output: { codecId: 't/labelled@1' },
};

describe('writeDataTypeValue', () => {
  it('writes a value as the literal of its data type that reads back as it', () => {
    expect([
      writeDataTypeValue(10, int.id, dataTypes),
      writeDataTypeValue('line\nbreak', text.id, dataTypes),
    ]).toEqual(['10', '"line\\nbreak"']);
  });

  it('writes nothing for a value no literal reads back as, without throwing', () => {
    expect([
      writeDataTypeValue(-1, int.id, dataTypes),
      writeDataTypeValue({ precision: 1 }, int.id, dataTypes),
    ]).toEqual([undefined, undefined]);
  });
});

describe('writtenTypeArguments', () => {
  it('writes each value argument as a literal of its data type', () => {
    expect([
      writtenTypeArguments(numeric, [10, 2], dataTypes),
      writtenTypeArguments(labelled, ['say "hi"'], dataTypes),
    ]).toEqual([['10', '2'], ['"say \\"hi\\""']]);
  });

  it('writes nothing for a value no literal of its data type reads back as', () => {
    expect([
      writtenTypeArguments(numeric, [-1], dataTypes),
      writtenTypeArguments(numeric, [{ precision: 1 }], dataTypes),
      writtenTypeArguments(numeric, [1, 2, 3], dataTypes),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe('writtenTypeConstructorCall', () => {
  it('writes the path and each argument that has a value, by name', () => {
    expect([
      writtenTypeConstructorCall(['pg', 'Numeric'], numeric, [10, 2], dataTypes),
      writtenTypeConstructorCall(['Numeric'], numeric, [undefined, 2], dataTypes),
      writtenTypeConstructorCall(['ext', 'Numeric'], numeric, [], dataTypes),
    ]).toEqual(['pg.Numeric(precision: 10, scale: 2)', 'Numeric(scale: 2)', 'ext.Numeric']);
  });

  it('writes an unnamed argument by position', () => {
    const unnamed: AuthoringTypeConstructorDescriptor = {
      kind: 'typeConstructor',
      args: [{ kind: 'value', dataType: 't/text' }],
      output: { codecId: 't/unnamed@1' },
    };
    expect(writtenTypeConstructorCall(['Unnamed'], unnamed, ['x'], dataTypes)).toBe('Unnamed("x")');
  });

  it('writes nothing for a value no literal reads back as, such as a bigint', () => {
    expect(writtenTypeConstructorCall(['Numeric'], numeric, [10n], dataTypes)).toBeUndefined();
  });
});
