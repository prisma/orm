import {
  type CodecCallContext,
  CodecDescriptorImpl,
  type CodecDescriptorTemplate,
  CodecImpl,
  type CodecInstanceContext,
  type CodecTrait,
  type DataType,
  type DataTypeValue,
  dataType,
  dataTypeId,
} from '@internal/framework-components/codec';
import { FunctionCallExpr, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expectTypeOf, test } from 'vitest';
import {
  defineSqliteCodecs,
  SqliteCodecDescriptor,
  sqliteCodec,
} from '../src/exports/codec-descriptor';

interface VectorParams {
  readonly length: number;
}

const fixtureType = dataType('demo/fixture', { read: (json) => json });

const vectorParamsSchema: StandardSchemaV1<VectorParams> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (input) => ({ value: input as VectorParams }),
  },
};

class VectorCodec<N extends number> extends CodecImpl<
  'demo/vector@1',
  readonly ['equality'],
  string,
  ReadonlyArray<number>
> {
  constructor(
    descriptor: CodecDescriptorTemplate<VectorParams>,
    dataType: DataType,
    readonly length: N,
  ) {
    super(descriptor, dataType);
  }

  async toWire(value: ReadonlyArray<number>, _ctx: CodecCallContext): Promise<string> {
    return `[${value.join(',')}]`;
  }

  async fromWire(wire: string, _ctx: CodecCallContext): Promise<ReadonlyArray<number>> {
    return wire.slice(1, -1).split(',').map(Number);
  }

  toDataTypeValue(value: ReadonlyArray<number>): DataTypeValue {
    return this.dataTypeValueOf([...value]);
  }

  fromDataTypeValue(value: DataTypeValue): ReadonlyArray<number> {
    return value.value as unknown as ReadonlyArray<number>;
  }
}

class GenericVectorDescriptor extends CodecDescriptorImpl<VectorParams> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = 'demo/vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = vectorParamsSchema;
  readonly extensionOnly = 'wrapped-only' as const;

  extensionOnlyMethod(): 'wrapped-only' {
    return this.extensionOnly;
  }

  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return () => new VectorCodec(this, fixtureType, params.length);
  }
}

class DirectVectorDescriptor extends SqliteCodecDescriptor<VectorParams> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = 'demo/direct-vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = vectorParamsSchema;

  protected override jsonProjection(
    expression: ProjectionExpr,
    _params: VectorParams,
  ): ProjectionExpr {
    return expression;
  }

  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return () => new VectorCodec(this, fixtureType, params.length);
  }
}

const genericDescriptor = new GenericVectorDescriptor();
const directDescriptor = new DirectVectorDescriptor();
const adaptedDescriptor = sqliteCodec(genericDescriptor, {
  dataType: fixtureType,
  factory: (descriptor, type, params) => () => new VectorCodec(descriptor, type, params.length),
  jsonProjection(expression, params) {
    expectTypeOf(expression).toEqualTypeOf<ProjectionExpr>();
    expectTypeOf(params).toEqualTypeOf<VectorParams>();
    return FunctionCallExpr.of('project_vector', [expression]);
  },
});

test('direct and adapted descriptors preserve codec and factory literals', () => {
  expectTypeOf(directDescriptor.codecId).toEqualTypeOf<'demo/direct-vector@1'>();
  expectTypeOf(adaptedDescriptor.codecId).toEqualTypeOf<'demo/vector@1'>();
  expectTypeOf(adaptedDescriptor.traits).toEqualTypeOf<readonly ['equality']>();

  expectTypeOf(adaptedDescriptor.factory({ length: 1536 })).toEqualTypeOf<
    (ctx: CodecInstanceContext) => VectorCodec<1536>
  >();
  expectTypeOf(adaptedDescriptor.factory({ length: 3 })({} as CodecInstanceContext)).toEqualTypeOf<
    VectorCodec<3>
  >();

  // @ts-expect-error -- the adapter does not expose wrapped-only fields
  adaptedDescriptor.extensionOnly;
  // @ts-expect-error -- the adapter does not expose wrapped-only methods
  adaptedDescriptor.extensionOnlyMethod();
});

test('defineSqliteCodecs preserves the readonly descriptor tuple', () => {
  const descriptors = defineSqliteCodecs([adaptedDescriptor, directDescriptor] as const);
  expectTypeOf(descriptors).toEqualTypeOf<
    readonly [typeof adaptedDescriptor, typeof directDescriptor]
  >();
});

test('defineSqliteCodecs rejects an unadapted generic descriptor', () => {
  // @ts-expect-error -- generic descriptors need an explicit SQLite adapter
  defineSqliteCodecs([genericDescriptor] as const);
});

test('sqliteCodec requires explicit scalar projection behavior', () => {
  // @ts-expect-error -- jsonProjection is mandatory
  sqliteCodec(genericDescriptor, {});
});

test('SQLite protocol remains scalar-only', () => {
  sqliteCodec(genericDescriptor, {
    jsonProjection: (expression) => expression,
    // @ts-expect-error -- SQLite descriptors do not define an array-projection hook
    jsonArrayProjection: (expression: ProjectionExpr) => expression,
  });
});

// @ts-expect-error -- direct descriptors must implement scalar JSON projection
class MissingJsonProjection extends SqliteCodecDescriptor<VectorParams> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = 'demo/missing-json@1' as const;
  override readonly traits: readonly CodecTrait[] = [];
  override readonly paramsSchema = vectorParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => VectorCodec<number> {
    return () => new VectorCodec(this, fixtureType, 1);
  }
}

void MissingJsonProjection;
