import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { CodecLookupWithDescriptors } from '../src/shared/codec-types';
import { createDataTypeLookup, dataType } from '../src/shared/data-type';
import {
  type DiscriminatorField,
  describeDiscriminatorRefusal,
  discriminatorRefusals,
} from '../src/shared/discriminator-rule';

const textType = dataType('t/text', { read: (json) => json });
/** Text compared without case, so `PHOTO` and `photo` are one value. */
const foldedType = dataType('t/folded', {
  read: (json) => json,
  equalityKey: (json) => String(json).toLowerCase(),
});
const text = textType.id;
const folded = foldedType.id;
const int = dataType('t/int', { read: (json) => json }).id;
const lookup = createDataTypeLookup([textType, foldedType]);

const codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'> = {
  descriptorFor: (codecId) => {
    const dataType = { 't/text@1': text, 't/folded@1': folded, 't/int@1': int }[codecId];
    return dataType === undefined
      ? undefined
      : {
          codecId,
          dataType,
          traits: ['equality'],
          paramsSchema: undefined,
          isParameterized: false,
          factory: () => () => {
            throw new Error('the rule builds no codec');
          },
        };
  },
};

const textField: DiscriminatorField = {
  ref: { codecId: 't/text@1' },
  nullable: false,
  many: false,
  enumMembers: undefined,
};

function refusals(
  field: DiscriminatorField,
  variantValues: readonly { readonly key: string; readonly stored: JsonValue }[] = [],
) {
  return discriminatorRefusals({
    field,
    variantValues,
    codecLookup,
    dataTypes: { lookup, textDataTypes: [text, folded] },
  });
}

describe('discriminatorRefusals', () => {
  it('accepts a required single text field, whatever its values', () => {
    expect(refusals(textField, [{ key: 'Photo', stored: 'photo' }])).toEqual([]);
  });

  it('refuses an optional field, a list and a field whose data type is not text', () => {
    expect(
      refusals({ ...textField, ref: { codecId: 't/int@1' }, nullable: true, many: true }),
    ).toEqual([
      { kind: 'optional' },
      { kind: 'list' },
      { kind: 'not-text', dataType: int, textDataTypes: [text, folded] },
    ]);
  });

  it('refuses a field with no codec, such as a relation, as not text', () => {
    expect(refusals({ ...textField, ref: undefined })).toEqual([
      { kind: 'not-text', dataType: undefined, textDataTypes: [text, folded] },
    ]);
  });

  it('refuses a field whose codec names no data type as not text', () => {
    expect(refusals({ ...textField, ref: { codecId: 't/unknown@1' } })).toEqual([
      { kind: 'not-text', dataType: undefined, textDataTypes: [text, folded] },
    ]);
  });

  it('refuses each base value that is not a member of the field enum, naming its key', () => {
    expect(
      refusals({ ...textField, enumMembers: ['photo', 'video'] }, [
        { key: 'Photo', stored: 'photo' },
        { key: 'Audio', stored: 'audio' },
      ]),
    ).toEqual([
      { kind: 'not-a-member', key: 'Audio', stored: 'audio', members: ['photo', 'video'] },
    ]);
  });

  it('throws when the stack names no text data types, since no field could be a discriminator', () => {
    expect(() =>
      discriminatorRefusals({
        field: textField,
        variantValues: [],
        codecLookup,
        dataTypes: { lookup, textDataTypes: [] },
      }),
    ).toThrow(expect.objectContaining({ name: 'InternalError' }));
  });

  it("compares a base value with the members by the field's data type's equality", () => {
    expect(
      refusals({ ...textField, ref: { codecId: 't/folded@1' }, enumMembers: ['photo'] }, [
        { key: 'Photo', stored: 'PHOTO' },
        { key: 'Audio', stored: 'audio' },
      ]),
    ).toEqual([{ kind: 'not-a-member', key: 'Audio', stored: 'audio', members: ['photo'] }]);
  });
});

describe('describeDiscriminatorRefusal', () => {
  const subject = {
    modelName: 'Asset',
    fieldName: 'kind',
    typeName: 'Int',
    enumName: 'Kind',
    variantName: (key: string) => key,
  };

  it('words each refusal', () => {
    expect(
      [
        { kind: 'optional' as const },
        { kind: 'list' as const },
        { kind: 'not-text' as const, dataType: int, textDataTypes: [text] },
        {
          kind: 'not-a-member' as const,
          key: 'Audio',
          stored: 'audio',
          members: ['photo', 'video'],
        },
      ].map((refusal) => describeDiscriminatorRefusal(refusal, subject)),
    ).toEqual([
      'Discriminator field "kind" on model "Asset" must be required, but it is optional. Remove the "?"',
      'Discriminator field "kind" on model "Asset" must hold one value, but it is a list. Remove the "[]"',
      'Discriminator field "kind" on model "Asset" must be text, such as String, but is "Int"',
      'Model "Audio" declares @@base value "audio", which is not a member of enum "Kind", the type of discriminator field "Asset.kind". Write one of: "photo", "video"',
    ]);
  });
});
