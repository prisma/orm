import type { JsonValue } from '@internal/contract/types';
import type {
  AnyCodecDescriptor,
  AnyCodecDescriptorTemplate,
} from '@internal/framework-components/codec';
import { dataType, dataTypeId, voidParamsSchema } from '@internal/framework-components/codec';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import type { RuntimeExtensionDescriptor } from '@internal/framework-components/execution';
import {
  BinaryExpr,
  CodecJsonValueProjection,
  ColumnRef,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ParamRef,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import {
  type AnyPostgresCodecDescriptor,
  postgresCodec,
} from '@internal/target-postgres/codec-descriptor';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import postgresTargetControlDescriptor from '@internal/target-postgres/control';
import postgresRuntimeTargetDescriptor from '@internal/target-postgres/runtime';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { createPostgresAdapter } from '../src/core/adapter';
import { assemblePostgresCodecRegistry } from '../src/core/codec-lookup';
import type { PostgresContract } from '../src/core/types';
import postgresAdapterControlDescriptor, {
  createPostgresCodecRegistryWithBuiltins,
  PostgresControlAdapter,
} from '../src/exports/control';
import postgresRuntimeAdapterDescriptor from '../src/exports/runtime';
import {
  createComposedPostgresAdapter,
  createComposedPostgresControlAdapter,
} from './helpers/composed-adapter';
import { defineTestCodec } from './test-codec';

/** The data types the fixture codecs of one contribution represent, so assembly finds them. */
/** A fixture codec's data type: its own id without the version. */
const fixtureTypeId = (codecId: string) => dataTypeId(codecId.split('@')[0] ?? codecId);

const fixtureDataTypes = (descriptors: readonly { readonly dataType?: string }[]) =>
  [...new Set(descriptors.map((descriptor) => descriptor.dataType))]
    .filter((id): id is string => id !== undefined)
    .map((id) => dataType(id, {}));

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:postgres-codec-registry-composition',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'sha256:postgres-codec-registry-composition',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            records: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                document: { codecId: 'arktype/json@1', nativeType: 'jsonb', nullable: false },
                embedding: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
                location: { codecId: 'pg/geometry@1', nativeType: 'geometry', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as PostgresContract;

function genericDescriptor(codecId: string): AnyCodecDescriptorTemplate {
  const codec = defineTestCodec({
    typeId: codecId,
    encode: (value: JsonValue): JsonValue => value,
    decode: (wire: JsonValue): JsonValue => wire,
  });
  return {
    codecId,
    traits: ['equality'],
    targetTypes: [],
    paramsSchema: voidParamsSchema,
    isParameterized: false,
    factory: () => () => codec,
  };
}

function postgresDescriptor(
  codecId: string,
  nativeType: string,
  onProjection?: () => void,
): AnyPostgresCodecDescriptor {
  return postgresCodec(genericDescriptor(codecId), {
    dataType: fixtureTypeId(codecId),
    nativeType: () => nativeType,
    jsonProjection(expression: ProjectionExpr): ProjectionExpr {
      onProjection?.();
      return expression;
    },
  });
}

function transformingPostgresDescriptor(
  codecId: string,
  nativeType: string,
  onMaterialize?: () => void,
): AnyPostgresCodecDescriptor {
  const codec = defineTestCodec({
    typeId: codecId,
    encode: (value: string): string => `encoded:${value}`,
    decode: (wire: string): string => wire,
  });
  const descriptor: AnyCodecDescriptorTemplate = {
    codecId,
    traits: ['equality'],
    targetTypes: [nativeType],
    paramsSchema: voidParamsSchema,
    isParameterized: false,
    factory: () => () => {
      onMaterialize?.();
      return codec;
    },
  };
  return postgresCodec(descriptor, {
    dataType: fixtureTypeId(codecId),
    nativeType: () => nativeType,
    jsonProjection: (expression: ProjectionExpr) => expression,
  });
}

function runtimeExtension(
  id: string,
  descriptors: readonly AnyCodecDescriptor[],
): RuntimeExtensionDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    dataTypes: fixtureDataTypes(descriptors),
    types: { codecTypes: { codecDescriptors: descriptors } },
    create() {
      return { familyId: 'sql', targetId: 'postgres' };
    },
  };
}

function controlExtension(
  id: string,
  descriptors: readonly AnyCodecDescriptor[],
): ControlExtensionDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    dataTypes: fixtureDataTypes(descriptors),
    types: { codecTypes: { codecDescriptors: descriptors } },
    create() {
      return { familyId: 'sql', targetId: 'postgres' };
    },
  };
}

function selectWithParam(column: string, codecId: string, value: unknown) {
  return SelectAst.from(TableSource.named('records'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('records', 'id'))])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('records', column),
        ParamRef.of(value, { name: column, codec: { codecId } }),
      ),
    );
}

describe('PostgreSQL adapter codec registry composition', () => {
  it('assembles the same immutable ordered target registry for runtime and control components', () => {
    const arktypeJson = postgresDescriptor('arktype/json@1', 'jsonb');
    const pgvector = postgresDescriptor('pg/vector@1', 'vector');
    const postgis = postgresDescriptor('pg/geometry@1', 'geometry');
    const runtimeExtensions = [
      runtimeExtension('arktype-json', [arktypeJson]),
      runtimeExtension('pgvector', [pgvector]),
      runtimeExtension('postgis', [postgis]),
    ];
    const controlExtensions = [
      controlExtension('arktype-json', [arktypeJson]),
      controlExtension('pgvector', [pgvector]),
      controlExtension('postgis', [postgis]),
    ];

    const runtimeRegistry = assemblePostgresCodecRegistry([
      postgresRuntimeTargetDescriptor,
      postgresRuntimeAdapterDescriptor,
      ...runtimeExtensions,
    ]);
    const controlRegistry = assemblePostgresCodecRegistry([
      postgresTargetControlDescriptor,
      postgresAdapterControlDescriptor,
      ...controlExtensions,
    ]);
    const expectedIds = [
      ...Array.from(postgresCodecDescriptorRegistry.values(), (descriptor) => descriptor.codecId),
      'arktype/json@1',
      'pg/vector@1',
      'pg/geometry@1',
    ];

    expect(Object.isFrozen(runtimeRegistry)).toBe(true);
    expect(Object.isFrozen(controlRegistry)).toBe(true);
    expect(Array.from(runtimeRegistry.values(), (descriptor) => descriptor.codecId)).toEqual(
      expectedIds,
    );
    expect(Array.from(controlRegistry.values(), (descriptor) => descriptor.codecId)).toEqual(
      expectedIds,
    );
  });

  it('uses all extension target descriptors in runtime and control lowering with byte-identical SQL', () => {
    const descriptors = [
      postgresDescriptor('arktype/json@1', 'jsonb'),
      postgresDescriptor('pg/vector@1', 'vector'),
      postgresDescriptor('pg/geometry@1', 'geometry'),
    ] as const;
    const runtimeAdapter = createComposedPostgresAdapter({
      extensions: [
        runtimeExtension('arktype-json', [descriptors[0]]),
        runtimeExtension('pgvector', [descriptors[1]]),
        runtimeExtension('postgis', [descriptors[2]]),
      ],
    });
    const controlAdapter = createComposedPostgresControlAdapter({
      extensions: [
        controlExtension('arktype-json', [descriptors[0]]),
        controlExtension('pgvector', [descriptors[1]]),
        controlExtension('postgis', [descriptors[2]]),
      ],
    });
    const cases = [
      { column: 'document', codecId: 'arktype/json@1', value: { name: 'Ada' }, cast: 'jsonb' },
      { column: 'embedding', codecId: 'pg/vector@1', value: [0.1, 0.2], cast: 'vector' },
      {
        column: 'location',
        codecId: 'pg/geometry@1',
        value: { type: 'Point', coordinates: [1, 2] },
        cast: 'geometry',
      },
    ];

    for (const testCase of cases) {
      const ast = selectWithParam(testCase.column, testCase.codecId, testCase.value);
      const runtime = runtimeAdapter.lower(ast, { contract });
      const control = controlAdapter.lower(ast, { contract });

      expect(runtime.sql).toContain(`$1::${testCase.cast}`);
      expect(control).toEqual(runtime);
    }
  });

  it('keeps bare construction built-ins-only', () => {
    const adapter = createPostgresAdapter();
    const ast = selectWithParam('embedding', 'pg/vector@1', [0.1, 0.2]);

    expect(() => adapter.lower(ast, { contract })).toThrow(/codecId "pg\/vector@1"/);
  });

  it('derives direct runtime materialization and native-type rendering from one descriptor contribution', () => {
    let materializations = 0;
    const descriptor = transformingPostgresDescriptor('app/direct-runtime@1', 'citext', () => {
      materializations += 1;
    });
    const adapter = createPostgresAdapter({ codecDescriptors: [descriptor] });
    const ast = selectWithParam('document', descriptor.codecId, 'Ada');

    expect(materializations).toBe(1);
    expect(adapter.lower(ast, { contract })).toEqual({
      sql: 'SELECT "records"."id" AS "id" FROM "records" WHERE "records"."document" = $1::citext',
      params: [{ kind: 'literal', value: 'Ada' }],
    });
  });

  it('derives direct control materialization and native-type rendering from one descriptor contribution', async () => {
    const descriptor = transformingPostgresDescriptor('app/direct-control@1', 'citext');
    const codecRegistry = createPostgresCodecRegistryWithBuiltins([descriptor]);
    const adapter = new PostgresControlAdapter(codecRegistry);
    const ast = selectWithParam('document', descriptor.codecId, 'Ada');

    await expect(adapter.lowerToExecuteRequest(ast, { contract })).resolves.toEqual({
      sql: 'SELECT "records"."id" AS "id" FROM "records" WHERE "records"."document" = $1::citext',
      params: ['encoded:Ada'],
    });
  });

  it('rejects raw, wrong-target, and malformed contributions before lowering on both planes', () => {
    // Each carries a data type its contribution registers, so the descriptor-validity check is the
    // only one that can fire.
    const raw = { ...genericDescriptor('app/raw@1'), dataType: fixtureTypeId('app/raw@1') };
    const wrongTarget = {
      ...genericDescriptor('app/wrong-target@1'),
      dataType: fixtureTypeId('app/wrong-target@1'),
      descriptorKind: 'sqlite-codec',
      nativeTypeFor: () => 'text',
      projectJson: (expression: ProjectionExpr) => expression,
    } as const;
    const malformed = {
      ...genericDescriptor('app/malformed@1'),
      dataType: fixtureTypeId('app/malformed@1'),
      descriptorKind: 'postgres-codec',
      nativeTypeFor: () => 'text',
      projectJson: undefined,
    } as const;

    const invalid = [raw, wrongTarget, malformed] as unknown as AnyCodecDescriptor[];
    for (const descriptor of invalid) {
      expect(() =>
        createComposedPostgresAdapter({
          extensions: [runtimeExtension('invalid-runtime', [descriptor])],
        }),
      ).toThrow(/not a valid PostgreSQL codec descriptor/);
      expect(() =>
        createComposedPostgresControlAdapter({
          extensions: [controlExtension('invalid-control', [descriptor])],
        }),
      ).toThrow(/not a valid PostgreSQL codec descriptor/);
    }
  });

  it('rejects duplicate target descriptor ids during composition', () => {
    const duplicate = postgresDescriptor('pg/text@1', 'text');

    expect(() =>
      createComposedPostgresAdapter({
        extensions: [runtimeExtension('duplicate-runtime', [duplicate])],
      }),
    ).toThrow(/Duplicate PostgreSQL codec descriptor id.*pg\/text@1/);
    expect(() =>
      createComposedPostgresControlAdapter({
        extensions: [controlExtension('duplicate-control', [duplicate])],
      }),
    ).toThrow(/Duplicate codec descriptor.*pg\/text@1/);
  });

  it('asks a composed descriptor how to project every JSON entry it owns', () => {
    let projectionCalls = 0;
    const descriptor = postgresDescriptor('app/json-hook@1', 'jsonb', () => {
      projectionCalls += 1;
    });
    const runtimeAdapter = createComposedPostgresAdapter({
      extensions: [runtimeExtension('json-hook-runtime', [descriptor])],
    });
    const controlAdapter = createComposedPostgresControlAdapter({
      extensions: [controlExtension('json-hook-control', [descriptor])],
    });
    const projection = new CodecJsonValueProjection(ColumnRef.of('records', 'document'), {
      codecId: descriptor.codecId,
    });
    const ast = SelectAst.from(TableSource.named('records')).withProjection([
      ProjectionItem.of(
        'object',
        JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', projection)]),
      ),
      ProjectionItem.of('array', JsonArrayAggExpr.of(projection)),
    ]);

    const runtime = runtimeAdapter.lower(ast, { contract });
    const control = controlAdapter.lower(ast, { contract });

    // This descriptor's projection is the identity, so the SQL is unchanged —
    // which is the point: a codec whose canonical JSON is its stored form
    // renders as itself, and the renderer still had to ask to find that out.
    // The call count is what says it asked, once per entry, on both paths.
    expect(runtime.sql).toBe(
      `SELECT json_build_object('value', "records"."document") AS "object", json_agg("records"."document") AS "array" FROM "records"`,
    );
    expect(control).toEqual(runtime);
    expect(projectionCalls).toBe(4);
  });
});
