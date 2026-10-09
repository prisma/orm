import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptorTemplate,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import type { RuntimeExtensionDescriptor } from '@internal/framework-components/execution';
import { sqlDataType } from '@internal/sql-contract/data-type';
import {
  BinaryExpr,
  ColumnRef,
  ParamRef,
  PreparedParamRef,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import {
  type AnyPostgresCodecDescriptor,
  buildPostgresCodecDescriptorRegistry,
  postgresCodec,
} from '@internal/target-postgres/codec-descriptor';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { postgresAdapterCapabilities } from '../src/core/capabilities';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';
import { createComposedPostgresAdapter } from './helpers/composed-adapter';
import { defineTestCodec } from './test-codec';

const emptyRegistry = buildPostgresCodecDescriptorRegistry([]);

function genericDescriptor(codecId: string): AnyCodecDescriptorTemplate {
  const codec = defineTestCodec({
    typeId: codecId,
    encode: (value: JsonValue): JsonValue => value,
    decode: (wire: JsonValue): JsonValue => wire,
  });
  return {
    codecId,
    traits: ['equality'],
    paramsSchema: undefined,
    isParameterized: false,
    factory: () => () => codec,
  };
}

function fixtureDataType(name: string) {
  return sqlDataType(`demo/${name}`, { texts: [{ text: name, written: true }] });
}

const dataTypes = createDataTypeLookup([
  ...postgresDataTypes,
  ...['foo', 'geography', 'jsonb'].map(fixtureDataType),
]);

function descriptorFor(codecId: string, name: string): AnyPostgresCodecDescriptor {
  return postgresCodec(genericDescriptor(codecId), {
    dataType: fixtureDataType(name),
    jsonProjection: (expression: ProjectionExpr) => expression,
  });
}

const baseContract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:cast-policy-test',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'sha256:cast-policy',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                tag: { codecId: 'app/test-foo@1', dataType: 'app/test-foo', nullable: false },
                score: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                geo: { codecId: 'app/geography@1', dataType: 'app/geography', nullable: false },
                profile: { codecId: 'arktype/json@1', dataType: 'pg/jsonb', nullable: false },
                name: {
                  codecId: 'pg/varchar@1',
                  dataType: 'pg/varchar',
                  nullable: false,
                  typeParams: { length: 255 },
                },
                status: {
                  codecId: 'pg/enum@1',
                  dataType: 'pg/enum',
                  nullable: false,
                  typeParams: { typeName: 'aal_level' },
                },
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

function selectWithParam(column: string, codecId: string | undefined, value: unknown) {
  const ref =
    codecId === undefined
      ? ParamRef.of(value, { name: column })
      : ParamRef.of(value, { name: column, codec: { codecId } });
  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(BinaryExpr.eq(ColumnRef.of('user', column), ref));
}

function selectWithTypeParams(
  column: string,
  codecId: string,
  typeParams: JsonValue,
  value: unknown,
) {
  const ref = ParamRef.of(value, { name: column, codec: { codecId, typeParams } });
  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(BinaryExpr.eq(ColumnRef.of('user', column), ref));
}

describe('renderLoweredSql cast policy', () => {
  it('emits $N::<nativeType> from a target descriptor outside the inferrable set', () => {
    const registry = buildPostgresCodecDescriptorRegistry([descriptorFor('app/test-foo@1', 'foo')]);
    const ast = selectWithParam('tag', 'app/test-foo@1', 'tagged');

    const lowered = renderLoweredSql(
      ast,
      baseContract,
      registry,
      dataTypes,
      postgresAdapterCapabilities,
    );

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."tag" = $1::foo');
  });

  it('emits plain $N for an inferrable scalar target descriptor', () => {
    const ast = selectWithParam('score', 'pg/int4@1', 1);

    const lowered = renderLoweredSql(
      ast,
      baseContract,
      postgresCodecDescriptorRegistry,
      dataTypes,
      postgresAdapterCapabilities,
    );

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."score" = $1');
  });

  it('emits exact native-enum casts from validated descriptor type parameters', () => {
    const publicAst = selectWithTypeParams(
      'status',
      'pg/enum@1',
      { typeName: 'aal_level' },
      'aal2',
    );
    const qualifiedAst = selectWithTypeParams(
      'status',
      'pg/enum@1',
      { typeName: 'auth.aal_level' },
      'aal2',
    );

    expect(
      renderLoweredSql(
        publicAst,
        baseContract,
        postgresCodecDescriptorRegistry,
        dataTypes,
        postgresAdapterCapabilities,
      ).sql,
    ).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."status" = $1::"aal_level"');
    expect(
      renderLoweredSql(
        qualifiedAst,
        baseContract,
        postgresCodecDescriptorRegistry,
        dataTypes,
        postgresAdapterCapabilities,
      ).sql,
    ).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."status" = $1::"auth"."aal_level"');
  });

  it('uses descriptor native type rather than the storage column spelling', () => {
    const ref = codecRefForStorageColumn(baseContract.storage, '__unbound__', 'user', 'score');
    expect(ref).toEqual({ codecId: 'pg/int4@1' });
    if (ref === undefined) return;
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(ColumnRef.of('user', 'score'), ParamRef.of(1, { name: 'score', codec: ref })),
      );

    const lowered = renderLoweredSql(
      ast,
      baseContract,
      postgresCodecDescriptorRegistry,
      dataTypes,
      postgresAdapterCapabilities,
    );

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."score" = $1');
  });

  it('casts scalar arrays even when their element native type is inferrable', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'score'),
          ParamRef.of([1, 2], {
            name: 'scores',
            codec: { codecId: 'pg/int4@1', many: true },
          }),
        ),
      );

    const lowered = renderLoweredSql(
      ast,
      baseContract,
      postgresCodecDescriptorRegistry,
      dataTypes,
      postgresAdapterCapabilities,
    );

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."score" = $1::int4[]',
    );
  });

  it('casts a forced int4 parameter to the data type base name', () => {
    const ref = PreparedParamRef.of('value', { codecId: 'pg/int4@1' });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('value', ref),
    ]);

    const lowered = renderLoweredSql(
      ast,
      baseContract,
      postgresCodecDescriptorRegistry,
      dataTypes,
      postgresAdapterCapabilities,
    );

    expect(lowered.sql).toBe('SELECT $1::int4 AS "value" FROM "user"');
  });

  it('casts a varchar list parameter to the base name without its length', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'name'),
          ParamRef.of(['Ada', 'Grace'], {
            name: 'names',
            codec: { codecId: 'pg/varchar@1', typeParams: { length: 255 }, many: true },
          }),
        ),
      );

    const lowered = renderLoweredSql(
      ast,
      baseContract,
      postgresCodecDescriptorRegistry,
      dataTypes,
      postgresAdapterCapabilities,
    );

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."name" = $1::character varying[]',
    );
  });

  it('resolves parameterized descriptors without requiring an id-keyed codec representative', () => {
    const registry = buildPostgresCodecDescriptorRegistry([
      descriptorFor('arktype/json@1', 'jsonb'),
    ]);
    const ast = selectWithParam('profile', 'arktype/json@1', { name: 'Ada' });

    const lowered = renderLoweredSql(
      ast,
      baseContract,
      registry,
      dataTypes,
      postgresAdapterCapabilities,
    );

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."profile" = $1::jsonb',
    );
  });

  it('throws clearly when the validated target registry has no descriptor for the codec id', () => {
    const ast = selectWithParam('tag', 'app/test-foo@1', 'tagged');

    expect(() =>
      renderLoweredSql(ast, baseContract, emptyRegistry, dataTypes, postgresAdapterCapabilities),
    ).toThrow(/codecId "app\/test-foo@1"/);
  });

  it('throws even when no contract column references the unknown codec id', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'unknown', codec: { codecId: 'app/never-used@1' } }),
        ),
      );

    expect(() =>
      renderLoweredSql(ast, baseContract, emptyRegistry, dataTypes, postgresAdapterCapabilities),
    ).toThrow(/codecId "app\/never-used@1"/);
  });

  it('throws RUNTIME.PARAM_REF_MISSING_CODEC when the param ref carries no codec', () => {
    const ast = selectWithParam('id', undefined, 1);

    expect(() =>
      renderLoweredSql(ast, baseContract, emptyRegistry, dataTypes, postgresAdapterCapabilities),
    ).toThrow(/PARAM_REF_MISSING_CODEC|reached lowering without/);
  });
});

describe('renderLoweredSql cast policy via stack-derived registry', () => {
  it('uses target descriptor behavior without generic native-type metadata', () => {
    const geographyDescriptor = descriptorFor('app/geography@1', 'geography');
    const geographyExtension: RuntimeExtensionDescriptor<'sql', 'postgres'> = {
      kind: 'extension',
      id: 'app-geography',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      types: { codecTypes: { codecDescriptors: [geographyDescriptor] } },
      dataTypes: [fixtureDataType('geography')],
      create() {
        return { familyId: 'sql', targetId: 'postgres' };
      },
    };
    const adapter = createComposedPostgresAdapter({ extensions: [geographyExtension] });
    const ast = selectWithParam('geo', 'app/geography@1', 'POINT(0 0)');

    const lowered = adapter.lower(ast, { contract: baseContract });

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."geo" = $1::geography',
    );
  });

  it('emits the per-instance enum cast through the assembled stack', () => {
    const adapter = createComposedPostgresAdapter({ extensions: [] });
    const ast = selectWithTypeParams('status', 'pg/enum@1', { typeName: 'auth.aal_level' }, 'aal2');

    const lowered = adapter.lower(ast, { contract: baseContract });

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."status" = $1::"auth"."aal_level"',
    );
  });
});
