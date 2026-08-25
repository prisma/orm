import type { StorageHashBase } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import type { RawSqlLiteral } from '@internal/sql-relational-core/ast';
import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  InsertAst,
  NullCheckExpr,
  OperationExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { PostgresCreateTable } from '@internal/target-postgres/ddl';
import { PostgresSchema } from '@internal/target-postgres/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter, postgresRawCodecInferer } from '../src/core/adapter';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import { PostgresControlAdapter, parsePgReloptions } from '../src/core/control-adapter';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const contract = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: new SqlStorage({
    storageHash: 'test-core' as StorageHashBase<'test-core'>,
    namespaces: {
      public: new PostgresSchema({
        id: 'public',
        entries: {
          table: {
            user: new StorageTable({
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            }),
          },
        },
      }),
    },
  }),
  domain: applicationDomainOf({ models: {} }),
} as PostgresContract;

const codecLookup = createPostgresBuiltinCodecLookup();

function structuredCodeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isStructuredError(e) ? e.code : undefined;
  }
  return undefined;
}

describe('adapter-postgres structured error codes', () => {
  it('raises RUNTIME.DDL_UNSUPPORTED when the runtime adapter is asked to lower DDL', () => {
    const adapter = createPostgresAdapter();
    const ddl = new PostgresCreateTable({ table: 't', columns: [col('a', 'text')] });
    expect(structuredCodeOf(() => adapter.lower(ddl, { contract }))).toBe(
      'RUNTIME.DDL_UNSUPPORTED',
    );
  });

  it('raises RUNTIME.DDL_UNSUPPORTED when the control adapter sync lower() receives DDL', () => {
    const controlAdapter = new PostgresControlAdapter(codecLookup);
    const ddl = new PostgresCreateTable({ table: 't', columns: [col('a', 'text')] });
    expect(structuredCodeOf(() => controlAdapter.lower(ddl, { contract }))).toBe(
      'RUNTIME.DDL_UNSUPPORTED',
    );
  });

  it('raises RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION for an uninferrable raw literal', () => {
    const value = Symbol('nope') as unknown as RawSqlLiteral;
    expect(structuredCodeOf(() => postgresRawCodecInferer.inferCodec(value))).toBe(
      'RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION',
    );
  });

  it('raises RUNTIME.TYPE_PARAMS_INVALID for a non-positive length type param', () => {
    const hooks = postgresAdapterDescriptorMeta.types.codecTypes.controlPlaneHooks;
    const expand = hooks['pg/varchar@1'].expandNativeType;
    expect(
      structuredCodeOf(() =>
        expand?.({ nativeType: 'character varying', typeParams: { length: 0 } }),
      ),
    ).toBe('RUNTIME.TYPE_PARAMS_INVALID');
  });

  it('raises RUNTIME.PARAM_REF_MISSING_CODEC for a ParamRef with an unregistered codecId', () => {
    const ast = DeleteAst.from(TableSource.named('user', undefined, 'public')).withWhere(
      BinaryExpr.eq(
        ColumnRef.of('user', 'id'),
        ParamRef.of(1, { name: 'id', codec: { codecId: 'test/unknown@1' } }),
      ),
    );
    expect(structuredCodeOf(() => renderLoweredSql(ast, contract, codecLookup))).toBe(
      'RUNTIME.PARAM_REF_MISSING_CODEC',
    );
  });

  it('raises RUNTIME.NAMESPACE_UNKNOWN when a table references a namespace missing from the contract', () => {
    const ast = SelectAst.from(TableSource.named('user', undefined, 'missing')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
    ]);
    const error = (() => {
      try {
        renderLoweredSql(ast, contract, codecLookup);
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.NAMESPACE_UNKNOWN',
      meta: { table: 'user', namespaceId: 'missing' },
    });
  });

  it('raises RUNTIME.AST_INVALID for an UPDATE with no SET assignments', () => {
    const ast = UpdateAst.table(TableSource.named('user', undefined, 'public')).withSet({});
    expect(structuredCodeOf(() => renderLoweredSql(ast, contract, codecLookup))).toBe(
      'RUNTIME.AST_INVALID',
    );
  });

  it('raises RUNTIME.AST_INVALID for a non-finite LIMIT or OFFSET', () => {
    const base = () =>
      SelectAst.from(TableSource.named('user', undefined, 'public')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ]);
    for (const ast of [
      base().withLimit(Number.NaN),
      base().withLimit(Number.POSITIVE_INFINITY),
      base().withOffset(Number.NaN),
    ]) {
      expect(structuredCodeOf(() => renderLoweredSql(ast, contract, codecLookup))).toBe(
        'RUNTIME.AST_INVALID',
      );
    }
  });

  it('raises RUNTIME.AST_INVALID for an INSERT with zero rows', () => {
    const ast = InsertAst.into(TableSource.named('user', undefined, 'public')).withRows([]);
    expect(structuredCodeOf(() => renderLoweredSql(ast, contract, codecLookup))).toBe(
      'RUNTIME.AST_INVALID',
    );
  });

  it('raises CONTRACT.PACK_CONTRIBUTION_INVALID for a lowering template referencing a missing argument', () => {
    const op = new OperationExpr({
      method: 'broken',
      self: ColumnRef.of('user', 'email'),
      args: [],
      returns: { codecId: 'pg/bool@1', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: 'f({{self}}, {{arg0}})' },
    });
    const ast = SelectAst.from(TableSource.named('user', undefined, 'public'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(NullCheckExpr.isNull(op));
    expect(structuredCodeOf(() => renderLoweredSql(ast, contract, codecLookup))).toBe(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
    );
  });

  it('raises CONTRACT.INTROSPECTION_UNSUPPORTED for a malformed index reloption entry', () => {
    expect(structuredCodeOf(() => parsePgReloptions(['no_eq_sign'], 'item_body_idx'))).toBe(
      'CONTRACT.INTROSPECTION_UNSUPPORTED',
    );
  });

  it('raises CONTRACT.DEFAULT_INVALID for a non-finite numeric literal default', async () => {
    const controlAdapter = new PostgresControlAdapter(codecLookup);
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [col('x', 'double precision', { default: lit(Number.NaN) })],
    });
    await expect(controlAdapter.lowerToExecuteRequest(ast, { contract })).rejects.toSatisfy(
      (e) => isStructuredError(e) && e.code === 'CONTRACT.DEFAULT_INVALID',
    );
  });
});
