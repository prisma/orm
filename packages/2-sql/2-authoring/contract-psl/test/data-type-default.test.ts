import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
  dataType,
} from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { readStoredValue } from '../src/data-type-default';

const zoned = dataType('demo/zoned', {
  toCanonicalForm: (value) => {
    if (typeof value === 'string' && value.endsWith('Z')) return value;
    throw structuredError('CONTRACT.CAST_REFUSED', `"${String(value)}" has no zone.`);
  },
});

class ZonedTextCodec extends CodecImpl<'demo/zoned-text@1', readonly ['equality'], string, string> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  encodeJson(value: string): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): string {
    return String(json);
  }
}

/** A codec that declares no canonical form of its own and reads any text. */
class ZonedTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = zoned.id;
  override readonly codecId = 'demo/zoned-text@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => ZonedTextCodec {
    return () => new ZonedTextCodec(this);
  }
}

const descriptor = new ZonedTextDescriptor();
const codecLookup: CodecLookupWithDescriptors = {
  get: (id) => (id === descriptor.codecId ? descriptor.factory()({ name: id }) : undefined),
  descriptorFor: (id) => (id === descriptor.codecId ? descriptor : undefined),
  renderOutputTypeFor: () => undefined,
};

describe('readStoredValue', () => {
  it("reads a stored value through the canonical form of its codec's data type", () => {
    const read = (value: JsonValue) =>
      readStoredValue({
        value,
        column: { codecId: descriptor.codecId },
        codecLookup,
        dataTypeLookup: createDataTypeLookup([zoned]),
        fieldPath: 'T.at',
      });
    expect({ zoned: read('12:00Z'), unzoned: read('12:00') }).toEqual({
      zoned: { ok: true, value: '12:00Z' },
      unzoned: {
        ok: false,
        code: 'PSL_INVALID_LITERAL',
        message: 'Field "T.at": "12:00" has no zone.',
      },
    });
  });
});
