import type { JsonValue } from '@internal/contract/types';
import { notOk, ok } from '@internal/utils/result';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { CodecImpl } from '../src/shared/codec';
import { CodecDescriptorImpl } from '../src/shared/codec-descriptor';
import type {
  CodecCallContext,
  CodecInstanceContext,
  CodecLookupWithDescriptors,
  CodecRef,
  CodecTrait,
} from '../src/shared/codec-types';
import {
  createDataTypeLookup,
  type DataType,
  type DataTypeId,
  type DataTypeValue,
  dataType,
} from '../src/shared/data-type';
import type { DataTypeAuthoringEntry } from '../src/shared/framework-authoring';
import {
  type DataTypeSupport,
  readWrittenValueIntoCodec,
  type WrittenValue,
} from '../src/shared/written-value';

const text = dataType('t/text', {
  read: (json) => {
    if (typeof json !== 'string') throw new Error('t/text JSON value must be a string');
    return json;
  },
});
const int = dataType('t/int', { read: (json) => json });
const dec = dataType('t/dec', { read: (json) => json });
const sized = dataType('t/sized', {
  params: type({ 'length?': 'number' }),
  read: (json, params) => {
    const length = typeof params['length'] === 'number' ? params['length'] : 1;
    if (typeof json === 'string' && json.length <= length) return json;
    throw new Error(`${JSON.stringify(json)} is longer than ${length}`);
  },
  casts: { [text.id]: (value) => value },
});
const positive = dataType('t/positive', {
  read: (json) => json,
  casts: {
    [int.id]: (value) => {
      if (typeof value === 'number' && value > 0) return value;
      throw new Error(`${String(value)} is not positive`);
    },
  },
});
const vector = dataType('t/vector', {
  read: (json) => json,
  listCast: {
    of: [int.id, dec.id],
    cast: (elements) => {
      if (elements.length === 0) throw new Error('a vector has at least one element');
      return elements.map(Number);
    },
  },
});

const sizedVector = dataType('t/sized-vector', {
  params: type({ 'length?': 'number' }),
  read: (json, params) => {
    if (Array.isArray(json) && json.length === params['length']) return json;
    throw new Error(`${JSON.stringify(json)} does not have ${String(params['length'])} elements`);
  },
  listCast: { of: [int.id, dec.id], cast: (elements) => elements.map(Number) },
});

const entries: Readonly<Record<string, DataTypeAuthoringEntry>> = {
  [text.id]: {
    written: { kind: 'plain', syntax: 'string', parse: (value) => value },
    print: (value) => String(value),
    documentation: 'Text.',
  },
  [int.id]: {
    written: {
      kind: 'plain',
      syntax: 'number',
      types: [int.id, dec.id],
      classify: (value) => {
        if (/^-?\d+$/.test(value)) return { type: int.id, value: Number(value) };
        if (/^-?\d+\.\d+$/.test(value)) return { type: dec.id, value };
        return undefined;
      },
    },
    print: (value) => String(value),
    documentation: 'A number.',
  },
};

const support: DataTypeSupport = {
  entries,
  lookup: createDataTypeLookup([text, int, dec, sized, positive, vector, sizedVector]),
  dataTypeOfCodec: () => undefined,
};

class FixtureCodec extends CodecImpl<string, readonly CodecTrait[], unknown, unknown> {
  constructor(
    descriptor: FixtureDescriptor,
    type: DataType,
    private readonly refuses: ((value: JsonValue) => string | undefined) | undefined,
  ) {
    super(descriptor, type);
  }
  async toWire(value: unknown, _ctx: CodecCallContext): Promise<unknown> {
    return value;
  }
  async fromWire(wire: unknown, _ctx: CodecCallContext): Promise<unknown> {
    return wire;
  }
  toDataTypeValue(value: unknown): DataTypeValue {
    return this.dataTypeValueOf(value as JsonValue);
  }
  fromDataTypeValue(value: DataTypeValue): unknown {
    const refusal = this.refuses?.(value.value);
    if (refusal !== undefined) throw new Error(refusal);
    return value.value;
  }
}

const lengthSchema: StandardSchemaV1<{ readonly length: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (input) => ({ value: { length: Number(Reflect.get(Object(input), 'length')) } }),
  },
};

class FixtureDescriptor extends CodecDescriptorImpl<unknown> {
  override readonly traits: readonly CodecTrait[] = [];
  constructor(
    override readonly codecId: string,
    private readonly type: DataType,
    override readonly paramsSchema: StandardSchemaV1<unknown> | undefined = undefined,
    private readonly refuses?: (value: JsonValue) => string | undefined,
  ) {
    super();
  }
  override get dataType(): DataTypeId {
    return this.type.id;
  }
  override factory(): (ctx: CodecInstanceContext) => FixtureCodec {
    return () => new FixtureCodec(this, this.type, this.refuses);
  }
}

const descriptors = [
  new FixtureDescriptor('t/text@1', text),
  new FixtureDescriptor('t/int@1', int),
  new FixtureDescriptor('t/sized@1', sized, lengthSchema),
  new FixtureDescriptor('t/positive@1', positive),
  new FixtureDescriptor('t/vector@1', vector),
  new FixtureDescriptor('t/sized-vector@1', sizedVector, lengthSchema),
  new FixtureDescriptor('t/no-zero-vector@1', vector, undefined, (value) =>
    Array.isArray(value) && value.includes(0) ? 't/no-zero-vector@1 does not take 0' : undefined,
  ),
  new FixtureDescriptor('t/no-forbidden@1', text, undefined, (value) =>
    value === 'forbidden' ? 't/no-forbidden@1 does not take "forbidden"' : undefined,
  ),
];

const codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'> = {
  descriptorFor: (id) => descriptors.find((descriptor) => descriptor.codecId === id),
};

function readInto(ref: CodecRef, written: WrittenValue) {
  return readWrittenValueIntoCodec({ support, codecLookup, ref, written, subject: 'member "M"' });
}

const string = (value: string): WrittenValue => ({ kind: 'string', text: value });
const number = (value: string): WrittenValue => ({ kind: 'number', text: value });

describe('readWrittenValueIntoCodec', () => {
  it("returns the value as the codec's data type stores it", () => {
    expect([
      readInto({ codecId: 't/text@1' }, string('free')),
      readInto({ codecId: 't/int@1' }, number('7')),
      readInto({ codecId: 't/sized@1', typeParams: { length: 4 } }, string('abcd')),
      readInto({ codecId: 't/positive@1' }, number('3')),
    ]).toEqual([ok('free'), ok(7), ok('abcd'), ok(3)]);
  });

  it('refuses syntax no entry reads with PSL_INVALID_LITERAL', () => {
    expect(readInto({ codecId: 't/int@1' }, number('1e5'))).toEqual(
      notOk({
        code: 'PSL_INVALID_LITERAL',
        message: 'member "M": no data type of this target holds the number 1e5',
      }),
    );
  });

  it('refuses an unknown tag with PSL_UNKNOWN_LITERAL_TAG', () => {
    expect(readInto({ codecId: 't/text@1' }, { kind: 'tag', tag: 'nope', text: 'x' })).toEqual(
      notOk({
        code: 'PSL_UNKNOWN_LITERAL_TAG',
        message: 'member "M": Unknown literal tag "nope". Known tags: .',
      }),
    );
  });

  it('refuses a value whose type the receiving type neither is nor casts from, with the literal to write', () => {
    expect([
      readInto({ codecId: 't/int@1' }, string('5')),
      readInto({ codecId: 't/text@1' }, number('5')),
      readInto({ codecId: 't/text@1' }, { kind: 'boolean', value: true }),
    ]).toEqual([
      notOk({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'member "M": Expected a number; write 5',
      }),
      notOk({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'member "M": Expected a quoted string',
      }),
      notOk({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message:
          'member "M": Expected a quoted string; this target has no data type for a boolean value',
      }),
    ]);
  });

  it('refuses a value the type parameters exclude with PSL_VALUE_REFUSED', () => {
    expect(readInto({ codecId: 't/sized@1', typeParams: { length: 2 } }, string('abc'))).toEqual(
      notOk({ code: 'PSL_VALUE_REFUSED', message: 'member "M": "abc" is longer than 2' }),
    );
  });

  it('refuses a value the codec refuses with PSL_VALUE_REFUSED', () => {
    expect(readInto({ codecId: 't/no-forbidden@1' }, string('forbidden'))).toEqual(
      notOk({
        code: 'PSL_VALUE_REFUSED',
        message: 'member "M": t/no-forbidden@1 does not take "forbidden"',
      }),
    );
  });

  it('refuses a value the cast refuses with PSL_INVALID_LITERAL', () => {
    expect(readInto({ codecId: 't/positive@1' }, number('-3'))).toEqual(
      notOk({ code: 'PSL_INVALID_LITERAL', message: 'member "M": -3 is not positive' }),
    );
  });

  it('throws when no codec has the id, because the caller resolved the codec from one', () => {
    expect(() => readInto({ codecId: 't/missing@1' }, string('x'))).toThrow(
      'member "M": no codec descriptor is registered for "t/missing@1"',
    );
  });

  describe('a written list', () => {
    const list = (...elements: WrittenValue[]): WrittenValue => ({ kind: 'list', elements });

    it("reads each element into the list cast's element types, then through the list cast", () => {
      expect(readInto({ codecId: 't/vector@1' }, list(number('1'), number('2.5')))).toEqual(
        ok([1, 2.5]),
      );
    });

    it('refuses a list when the receiving type has no list cast', () => {
      expect(readInto({ codecId: 't/text@1' }, list(string('a')))).toEqual(
        notOk({
          code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
          message: 'member "M": Expected a quoted string; got a list',
        }),
      );
    });

    it('refuses an element of a type the list cast does not take, naming the element', () => {
      expect(readInto({ codecId: 't/vector@1' }, list(number('1'), string('a')))).toEqual(
        notOk({
          code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
          message: 'member "M" at element 2: Expected a number',
        }),
      );
    });

    it('refuses an element no entry reads, naming the element', () => {
      expect(readInto({ codecId: 't/vector@1' }, list(number('1e5')))).toEqual(
        notOk({
          code: 'PSL_INVALID_LITERAL',
          message: 'member "M" at element 1: no data type of this target holds the number 1e5',
        }),
      );
    });

    it('refuses a list inside a list', () => {
      expect(readInto({ codecId: 't/vector@1' }, list(list(number('1'))))).toEqual(
        notOk({
          code: 'PSL_INVALID_LITERAL',
          message: 'member "M" at element 1: a list holds values, not other lists',
        }),
      );
    });

    it('refuses a list the list cast takes and the type parameters exclude with PSL_VALUE_REFUSED', () => {
      expect(
        readInto({ codecId: 't/sized-vector@1', typeParams: { length: 3 } }, list(number('1'))),
      ).toEqual(
        notOk({ code: 'PSL_VALUE_REFUSED', message: 'member "M": [1] does not have 3 elements' }),
      );
    });

    it('refuses a list the list cast takes and the codec refuses with PSL_VALUE_REFUSED', () => {
      expect(readInto({ codecId: 't/no-zero-vector@1' }, list(number('0')))).toEqual(
        notOk({
          code: 'PSL_VALUE_REFUSED',
          message: 'member "M": t/no-zero-vector@1 does not take 0',
        }),
      );
    });

    it('refuses a list the list cast refuses', () => {
      expect(readInto({ codecId: 't/vector@1' }, list())).toEqual(
        notOk({
          code: 'PSL_INVALID_LITERAL',
          message: 'member "M": a vector has at least one element',
        }),
      );
    });
  });
});
