/**
 * A test-only extension that declares one data type, `testext/thing`, with one integer parameter, its codec `testext/thing@1` and the constructor `testext.Thing(size)` marked `inferred`.
 *
 * PGlite cannot create a base type (that needs C functions), and a domain is reported with the kind `domain`, which no data type claims by text. PGlite does ship the `vector` extension, whose `vector(n)` is a base type reported as `vector(n)`, so `testext/thing` claims the text `vector({size})`. pgvector, which claims the same text, is left out of every config this extension is in.
 */
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeReader,
  type DataTypeValue,
  refuseJsonValue,
} from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';

const THING_CODEC_ID = 'testext/thing@1' as const;

const thingParams = arktype({ size: 'number.integer >= 1' });

type ThingParams = { readonly size: number };

const readThing: DataTypeReader = (json) =>
  Array.isArray(json) && json.every((element) => typeof element === 'number')
    ? json
    : refuseJsonValue('testext/thing', 'an array of numbers', json);

export const testextThing = sqlDataType('testext/thing', {
  params: thingParams,
  texts: [{ text: 'vector({size})', written: true, catalog: true }],
  read: readThing,
});

class ThingCodec extends CodecImpl<typeof THING_CODEC_ID, readonly [], string, number[]> {
  constructor(descriptor: AnyCodecDescriptor, size: number) {
    super(descriptor, testextThing, { size });
  }

  async toWire(value: number[], _ctx: CodecCallContext): Promise<string> {
    return `[${value.join(',')}]`;
  }

  async fromWire(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    return wire.slice(1, -1).split(',').map(Number);
  }

  fromDataTypeValue(value: DataTypeValue<readonly number[]>): number[] {
    return [...value.value];
  }

  toDataTypeValue(input: number[]): DataTypeValue {
    return this.dataTypeValueOf([...input]);
  }
}

class ThingDescriptor extends PostgresCodecDescriptor<ThingParams> {
  override readonly dataType = testextThing.id;
  override readonly codecId = THING_CODEC_ID;
  override readonly traits = [] as const;
  override readonly paramsSchema: StandardSchemaV1<ThingParams> = thingParams;
  override factory(params: ThingParams): (ctx: CodecInstanceContext) => ThingCodec {
    return () => new ThingCodec(this, params.size);
  }
}

const authoringTypes = {
  testext: {
    Thing: {
      kind: 'typeConstructor',
      inferred: true,
      args: [{ kind: 'value', name: 'size', dataType: 'pg/int4' }],
      output: { codecId: THING_CODEC_ID, typeParams: { size: { kind: 'arg', index: 0 } } },
    },
  },
} as const satisfies AuthoringTypeNamespace;

const testext: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'testext',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  authoring: { type: authoringTypes },
  dataTypes: [testextThing],
  types: { codecTypes: { codecDescriptors: definePostgresCodecs([new ThingDescriptor()]) } },
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

export default testext;
