import { expectTypeOf, test } from 'vitest';
import type {
  AnyCodecDescriptor,
  CodecLookupWithDescriptors,
  DataType,
  TypeLookups,
} from '../src/exports/codec';

declare const descriptorFor: (id: string) => AnyCodecDescriptor | undefined;
declare const get: (id: string) => DataType | undefined;

test('takes a codec lookup that finds descriptors and a data type lookup that finds types', () => {
  expectTypeOf({ codecLookup: { descriptorFor }, dataTypeLookup: { get } }).toExtend<TypeLookups>();
});

test('can ask for a full codec lookup', () => {
  expectTypeOf({
    codecLookup: { descriptorFor },
    dataTypeLookup: { get },
  }).not.toExtend<TypeLookups<CodecLookupWithDescriptors>>();
});
