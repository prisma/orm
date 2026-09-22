import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  type CodecDescriptor,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type CodecRef,
  dataTypeId,
} from '@internal/framework-components/codec';
import {
  ColumnRef,
  FunctionCallExpr,
  LiteralExpr,
  type ProjectionExpr,
} from '@internal/sql-relational-core/ast';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import {
  buildSqliteCodecDescriptorRegistry,
  isSqliteCodecDescriptor,
  SqliteCodecDescriptor,
  sqliteCodec,
} from '../src/exports/codec-descriptor';

interface VectorParams {
  readonly length: number;
}

const vectorParamsSchema: StandardSchemaV1<VectorParams> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(value) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'length' in value &&
        typeof value.length === 'number'
      ) {
        return { value: { length: value.length } };
      }
      return { issues: [{ message: 'expected numeric length' }] };
    },
  },
};

class VectorCodec<N extends number> extends CodecImpl<
  'demo/vector@1',
  readonly ['equality'],
  string,
  ReadonlyArray<number>
> {
  constructor(
    descriptor: CodecDescriptor<VectorParams>,
    readonly length: N,
  ) {
    super(descriptor);
  }

  async encode(value: ReadonlyArray<number>, _ctx: CodecCallContext): Promise<string> {
    return `[${value.join(',')}]`;
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<ReadonlyArray<number>> {
    return wire.slice(1, -1).split(',').map(Number);
  }

  encodeJson(value: ReadonlyArray<number>): JsonValue {
    return [...value];
  }

  decodeJson(json: JsonValue): ReadonlyArray<number> {
    if (!Array.isArray(json)) {
      throw new Error('Expected vector JSON array');
    }
    return json.map(Number);
  }
}

class GenericVectorDescriptor extends CodecDescriptorImpl<VectorParams> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = 'demo/vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly paramsSchema = vectorParamsSchema;
  readonly extensionOnly = 'wrapped-only' as const;

  extensionOnlyMethod(): 'wrapped-only' {
    return this.extensionOnly;
  }

  override renderOutputType(params: VectorParams): string {
    return `Vector<${params.length}>`;
  }

  override renderInputType(params: VectorParams): string {
    return `ReadonlyArray<number> & { length: ${params.length} }`;
  }

  override renderValueLiteral(value: JsonValue, side: 'output' | 'input'): string | undefined {
    return typeof value === 'string' ? `${side}:${value}` : undefined;
  }

  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return () => new VectorCodec(this, params.length);
  }
}

class DirectVectorDescriptor extends SqliteCodecDescriptor<VectorParams> {
  override readonly dataType = dataTypeId('demo/fixture');
  override readonly codecId = 'demo/direct-vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly paramsSchema = vectorParamsSchema;
  readonly jsonProjectionParams: VectorParams[] = [];

  protected override jsonProjection(
    expression: ProjectionExpr,
    params: VectorParams,
  ): ProjectionExpr {
    this.jsonProjectionParams.push(params);
    return FunctionCallExpr.of('project_vector', [expression, LiteralExpr.of(params.length)]);
  }

  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return () => new VectorCodec(this, params.length);
  }
}

const genericVectorDescriptor = new GenericVectorDescriptor();

const scalarRef = (codecId: string, length: JsonValue): CodecRef => ({
  codecId,
  typeParams: { length },
});

describe('SqliteCodecDescriptor', () => {
  it('exposes the stable discriminant and validates erased parameters before projection', () => {
    const descriptor = new DirectVectorDescriptor();
    const expression = ColumnRef.of('items', 'embedding');

    expect(descriptor.descriptorKind).toBe('sqlite-codec');
    expect(descriptor.projectJson(expression, scalarRef(descriptor.codecId, 5))).toEqual(
      FunctionCallExpr.of('project_vector', [expression, LiteralExpr.of(5)]),
    );
    expect(descriptor.jsonProjectionParams).toEqual([{ length: 5 }]);

    expect(() => descriptor.projectJson(expression, scalarRef(descriptor.codecId, 'bad'))).toThrow(
      'Invalid typeParams',
    );
    expect(descriptor.jsonProjectionParams).toEqual([{ length: 5 }]);
  });

  it('rejects stored scalar arrays without invoking the scalar hook', () => {
    const descriptor = new DirectVectorDescriptor();

    expect(() =>
      descriptor.projectJson(ColumnRef.of('items', 'embeddings'), {
        ...scalarRef(descriptor.codecId, 5),
        many: true,
      }),
    ).toThrow(/SQLite codec descriptors do not support stored scalar arrays/);
    expect(descriptor.jsonProjectionParams).toEqual([]);
  });

  it('rejects stored scalar arrays with RUNTIME.CODEC_DESCRIPTOR_ARRAY_UNSUPPORTED', () => {
    const descriptor = new DirectVectorDescriptor();

    expect(() =>
      descriptor.projectJson(ColumnRef.of('items', 'embeddings'), {
        ...scalarRef(descriptor.codecId, 5),
        many: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.CODEC_DESCRIPTOR_ARRAY_UNSUPPORTED' }));
  });
});

describe('sqliteCodec', () => {
  it('preserves the wrapped descriptor contract and materialization behavior', () => {
    const descriptor = sqliteCodec(genericVectorDescriptor, {
      dataType: dataTypeId('demo/fixture'),
      jsonProjection: (expression, params) =>
        FunctionCallExpr.of('project_generic_vector', [expression, LiteralExpr.of(params.length)]),
    });

    expect(descriptor.descriptorKind).toBe('sqlite-codec');
    expect(descriptor.codecId).toBe(genericVectorDescriptor.codecId);
    expect(descriptor.traits).toBe(genericVectorDescriptor.traits);
    expect(descriptor.targetTypes).toBe(genericVectorDescriptor.targetTypes);
    expect(descriptor.paramsSchema).toBe(genericVectorDescriptor.paramsSchema);
    expect(descriptor.isParameterized).toBe(genericVectorDescriptor.isParameterized);
    expect(descriptor.renderOutputType?.({ length: 6 })).toBe('Vector<6>');
    expect(descriptor.renderInputType?.({ length: 6 })).toBe(
      'ReadonlyArray<number> & { length: 6 }',
    );
    expect(descriptor.renderValueLiteral?.('value', 'input')).toBe('input:value');
    expect('extensionOnly' in descriptor).toBe(false);
    expect('extensionOnlyMethod' in descriptor).toBe(false);

    const codec = descriptor.factory({ length: 6 })({} as CodecInstanceContext);
    expect(codec).toBeInstanceOf(VectorCodec);
    expect(codec.length).toBe(6);
    expect(codec.descriptor).toBe(genericVectorDescriptor);

    const expression = ColumnRef.of('items', 'embedding');
    expect(descriptor.projectJson(expression, scalarRef(descriptor.codecId, 6))).toEqual(
      FunctionCallExpr.of('project_generic_vector', [expression, LiteralExpr.of(6)]),
    );
  });
});

describe('SQLite codec descriptor registry', () => {
  it('accepts structurally valid descriptors without relying on class identity', () => {
    const descriptor = new DirectVectorDescriptor();
    const structuralDescriptor = {
      descriptorKind: descriptor.descriptorKind,
      codecId: descriptor.codecId,
      traits: descriptor.traits,
      targetTypes: descriptor.targetTypes,
      paramsSchema: descriptor.paramsSchema,
      isParameterized: descriptor.isParameterized,
      factory: descriptor.factory.bind(descriptor),
      projectJson: descriptor.projectJson.bind(descriptor),
    };

    expect(structuralDescriptor).not.toBeInstanceOf(SqliteCodecDescriptor);
    expect(isSqliteCodecDescriptor(structuralDescriptor)).toBe(true);

    const registry = buildSqliteCodecDescriptorRegistry([structuralDescriptor]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(registry.descriptorFor(descriptor.codecId)).toBe(structuralDescriptor);
    expect([...registry.values()]).toEqual([structuralDescriptor]);
  });

  it('rejects raw, wrong-target, malformed, and duplicate descriptors clearly', () => {
    const descriptor = new DirectVectorDescriptor();
    const validShape = {
      descriptorKind: descriptor.descriptorKind,
      codecId: descriptor.codecId,
      traits: descriptor.traits,
      targetTypes: descriptor.targetTypes,
      paramsSchema: descriptor.paramsSchema,
      isParameterized: descriptor.isParameterized,
      factory: descriptor.factory.bind(descriptor),
      projectJson: descriptor.projectJson.bind(descriptor),
    };

    expect(() => buildSqliteCodecDescriptorRegistry([genericVectorDescriptor])).toThrow(
      /demo\/vector@1.*SQLite codec descriptor/,
    );
    expect(() =>
      buildSqliteCodecDescriptorRegistry([{ ...validShape, descriptorKind: 'postgres-codec' }]),
    ).toThrow(/demo\/direct-vector@1.*SQLite codec descriptor/);
    expect(() =>
      buildSqliteCodecDescriptorRegistry([{ ...validShape, projectJson: undefined }]),
    ).toThrow(/demo\/direct-vector@1.*SQLite codec descriptor/);

    for (const paramsSchema of [
      null,
      { '~standard': null },
      { '~standard': { version: 1, vendor: 'test' } },
      { '~standard': { version: 1, vendor: 'test', validate: 'not-callable' } },
    ]) {
      expect(() => buildSqliteCodecDescriptorRegistry([{ ...validShape, paramsSchema }])).toThrow(
        /demo\/direct-vector@1.*SQLite codec descriptor/,
      );
    }

    expect(() => buildSqliteCodecDescriptorRegistry([validShape, validShape])).toThrow(
      /Duplicate SQLite codec descriptor id.*demo\/direct-vector@1/,
    );

    expect(() =>
      buildSqliteCodecDescriptorRegistry([{ ...validShape, descriptorKind: 'postgres-codec' }]),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.CODEC_DESCRIPTOR_INVALID' }));
    expect(() => buildSqliteCodecDescriptorRegistry([validShape, validShape])).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_CODEC',
        meta: expect.objectContaining({ target: 'sqlite' }),
      }),
    );
  });
});
