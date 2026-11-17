import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { Codec } from '../src/shared/codec';
import type { CodecDescriptor } from '../src/shared/codec-descriptor';
import { createDataTypeLookup, type DataType, dataType } from '../src/shared/data-type';
import { applyDiscriminatorRule, type DiscriminatorField } from '../src/shared/discriminator-rule';
import type { DataTypeSupport, WrittenValue } from '../src/shared/written-value';

const textType = dataType('t/text', {
  read: (json) => {
    if (typeof json !== 'string') throw new Error('t/text JSON value must be a string');
    return json;
  },
});
/** A text type whose spelling stores a number, which no real text type does. */
const brokenTextType = dataType('t/broken-text', {
  read: (json) => json,
  spell: () => 1,
  casts: { [textType.id]: (value) => value },
});
const intType = dataType('t/int', { read: (json) => json });

function codecOf(id: string, type: DataType): Codec {
  return {
    id,
    dataType: type,
    toWire: async (value: unknown) => value,
    fromWire: async (wire: unknown) => wire,
    toDataTypeValue: (value) => type.valueFrom(value as JsonValue, {}),
    fromDataTypeValue: (value) => {
      if (value.value === 'forbidden') throw new Error('"forbidden" is not a kind');
      return value.value;
    },
  };
}

const codecs = [
  codecOf('t/text@1', textType),
  codecOf('t/broken-text@1', brokenTextType),
  codecOf('t/int@1', intType),
];

const codecLookup = {
  descriptorFor: (id: string): CodecDescriptor<void> | undefined => {
    const codec = codecs.find((candidate) => candidate.id === id);
    return codec === undefined
      ? undefined
      : {
          codecId: id,
          dataType: codec.dataType.id,
          traits: ['equality'],
          paramsSchema: undefined,
          isParameterized: false,
          factory: () => () => codec,
        };
  },
};

const dataTypes: DataTypeSupport = {
  entries: {
    [textType.id]: {
      written: { kind: 'plain', syntax: 'string', parse: (value) => value },
      print: (value) => String(value),
      documentation: 'Text.',
    },
    [intType.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [intType.id],
        classify: (value) => ({ type: intType.id, value: Number(value) }),
      },
      print: (value) => String(value),
      documentation: 'A number.',
    },
  },
  lookup: createDataTypeLookup([textType, brokenTextType, intType]),
  dataTypeOfCodec: () => undefined,
  textDataTypes: [textType.id, brokenTextType.id],
};

const textField: DiscriminatorField = {
  ref: { codecId: 't/text@1' },
  nullable: false,
  many: false,
  enumMembers: undefined,
};

const string = (text: string): WrittenValue => ({ kind: 'string', text });

function apply(field: DiscriminatorField, variants: Record<string, WrittenValue>) {
  return applyDiscriminatorRule({
    field,
    variants: Object.entries(variants).map(([key, written]) => ({ key, written })),
    subject: 'Field "Asset.kind"',
    codecLookup,
    dataTypes,
  });
}

describe('applyDiscriminatorRule', () => {
  it("stores each variant's value as the field stores it", () => {
    expect(apply(textField, { Photo: string('photo'), Video: string('video') })).toEqual({
      fieldRefusals: [],
      variantRefusals: [],
      values: new Map([
        ['Photo', 'photo'],
        ['Video', 'video'],
      ]),
    });
  });

  it('refuses the field and reads no variant value when the field is refused', () => {
    expect(
      apply({ ...textField, nullable: true }, { Photo: { kind: 'number', text: '1' } }),
    ).toEqual({ fieldRefusals: [{ kind: 'optional' }], variantRefusals: [], values: new Map() });
  });

  it('refuses a field with no codec as not text', () => {
    expect(apply({ ...textField, ref: undefined }, { Photo: string('photo') })).toEqual({
      fieldRefusals: [
        { kind: 'not-text', dataType: undefined, textDataTypes: dataTypes.textDataTypes },
      ],
      variantRefusals: [],
      values: new Map(),
    });
  });

  it('refuses, in variant order, a value it cannot read and a value that is not a member', () => {
    expect(
      apply(
        { ...textField, enumMembers: ['photo', 'video'] },
        {
          Number: { kind: 'number', text: '1' },
          Photo: string('photo'),
          Forbidden: string('forbidden'),
          Audio: string('audio'),
        },
      ),
    ).toEqual({
      fieldRefusals: [],
      variantRefusals: [
        {
          kind: 'unreadable',
          key: 'Number',
          refusal: {
            code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
            message: 'Field "Asset.kind": Expected a quoted string',
          },
        },
        {
          kind: 'unreadable',
          key: 'Forbidden',
          refusal: {
            code: 'PSL_VALUE_REFUSED',
            message: 'Field "Asset.kind": "forbidden" is not a kind',
          },
        },
        { kind: 'not-a-member', key: 'Audio', stored: 'audio', members: ['photo', 'video'] },
      ],
      values: new Map([['Photo', 'photo']]),
    });
  });

  it('throws when a text data type stores a value that is not a string', () => {
    expect(() =>
      apply({ ...textField, ref: { codecId: 't/broken-text@1' } }, { Photo: string('photo') }),
    ).toThrow(expect.objectContaining({ name: 'InternalError' }));
  });
});
