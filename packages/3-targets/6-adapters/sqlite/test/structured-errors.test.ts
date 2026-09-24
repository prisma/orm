import type { Codec } from '@internal/framework-components/codec';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import {
  CheckExpressionConstraint,
  DefaultValueExpr,
  InsertAst,
  LiteralExpr,
  ProjectionItem,
  type RawSqlLiteral,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { createTable } from '@internal/target-sqlite/contract-free';
import { SqliteCreateTable } from '@internal/target-sqlite/ddl';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter, sqliteRawCodecInferer } from '../src/core/adapter';
import { createSqliteBuiltinCodecLookup } from '../src/core/codec-lookup';
import { SqliteControlAdapter } from '../src/core/control-adapter';
import { decodeSqliteMarkerRow } from '../src/core/marker-ledger';
import type { SqliteCodecRegistry, SqliteContract } from '../src/core/types';

const contract = {} as SqliteContract;
const runtimeAdapter = createSqliteAdapter();
const controlAdapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected fn to throw');
}

async function catchAsyncError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected fn to reject');
}

describe('structured error codes', () => {
  it('RUNTIME.DDL_UNSUPPORTED on runtime-adapter lower of a DDL node', () => {
    const ddl = new SqliteCreateTable({ table: 't', columns: [col('a', 'TEXT')] });
    const err = catchError(() => runtimeAdapter.lower(ddl, { contract }));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.DDL_UNSUPPORTED',
      meta: { surface: 'runtime-adapter' },
    });
  });

  it('RUNTIME.DDL_UNSUPPORTED on control-adapter sync lower of a DDL node', () => {
    const ddl = new SqliteCreateTable({ table: 't', columns: [col('a', 'TEXT')] });
    const err = catchError(() => controlAdapter.lower(ddl, { contract }));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.DDL_UNSUPPORTED',
      meta: { surface: 'control-adapter' },
    });
  });

  it('RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION on an uninterpolatable JS value', () => {
    const err = catchError(() => sqliteRawCodecInferer.inferCodec({} as RawSqlLiteral));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION',
      meta: { valueType: 'object' },
    });
  });

  it('RUNTIME.NAMESPACE_UNKNOWN when a table references a namespace missing from the contract', () => {
    const ast = SelectAst.from(TableSource.named('user', undefined, 'missing')).withProjection([
      ProjectionItem.of('id', LiteralExpr.of(1)),
    ]);
    const nsContract = { storage: { namespaces: {} } } as unknown as SqliteContract;
    const err = catchError(() => runtimeAdapter.lower(ast, { contract: nsContract }));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.NAMESPACE_UNKNOWN',
      message: 'Table "user" references namespace "missing" which is not present on the contract',
      meta: { table: 'user', namespaceId: 'missing', reason: 'not-present' },
    });
  });

  it('RUNTIME.AST_INVALID on INSERT with zero rows', () => {
    const err = catchError(() =>
      runtimeAdapter.lower(InsertAst.into(TableSource.named('user')).withRows([]), { contract }),
    );
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.AST_INVALID',
      message: 'INSERT requires at least one row',
      meta: { node: 'insert', table: 'user' },
    });
  });

  it('RUNTIME.AST_UNSUPPORTED on DEFAULT as an INSERT value', () => {
    const ast = InsertAst.into(TableSource.named('user')).withRows([
      { email: new DefaultValueExpr() },
    ]);
    const err = catchError(() => runtimeAdapter.lower(ast, { contract }));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.AST_UNSUPPORTED',
      message: 'SQLite does not support DEFAULT as a value in INSERT ... VALUES',
      meta: { node: 'default-value' },
    });
  });

  it('CONTRACT.DEFAULT_INVALID on a non-finite number literal default', async () => {
    const ast = new SqliteCreateTable({
      table: 'defaults',
      columns: [col('x', 'INTEGER', { default: lit(Number.POSITIVE_INFINITY) })],
    });
    const err = await catchAsyncError(() =>
      controlAdapter.lowerToExecuteRequest(ast, { contract }),
    );
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'CONTRACT.DEFAULT_INVALID' });
  });

  it('CONTRACT.PACK_CONTRIBUTION_INVALID when a codec emits an unsupported wire type', async () => {
    const symbolCodec = {
      id: 'test/symbol@1',
      encode: async () => Symbol('wire'),
      decode: async (wire: unknown) => wire,
      encodeJson: (value: unknown) => value,
      decodeJson: (json: unknown) => json,
    } as unknown as Codec;
    const lookup: SqliteCodecRegistry = {
      ...createSqliteBuiltinCodecLookup(),
      get: (id) => (id === 'test/symbol@1' ? symbolCodec : undefined),
      forCodecRef: () => {
        throw new Error('not used in DDL tests');
      },
      forColumn: () => undefined,
    };
    const adapter = new SqliteControlAdapter(lookup);
    const ast = new SqliteCreateTable({
      table: 'secrets',
      columns: [
        col('token', 'TEXT', { default: lit('x'), codecRef: { codecId: 'test/symbol@1' } }),
      ],
    });
    const err = await catchAsyncError(() => adapter.lowerToExecuteRequest(ast, { contract }));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
      meta: { wireType: 'symbol' },
    });
  });

  it('CONTRACT.CONSTRAINT_INVALID on an expression CHECK constraint', async () => {
    const ast = createTable({
      table: 'arr',
      columns: [col('a', 'TEXT')],
      constraints: [
        new CheckExpressionConstraint({ name: 'chk_a', expression: 'length("a") > 0' }),
      ],
    });
    const err = await catchAsyncError(() =>
      controlAdapter.lowerToExecuteRequest(ast, { contract }),
    );
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'CONTRACT.CONSTRAINT_INVALID',
      meta: { constraintName: 'chk_a' },
    });
  });

  it('CONTRACT.INTROSPECTION_UNSUPPORTED on an unknown referential action rule', async () => {
    const driver: SqlControlDriverInstance<'sqlite'> = {
      familyId: 'sql',
      targetId: 'sqlite',
      query: async <Row = Record<string, unknown>>(sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { rows: [{ name: 't' }] as Row[] };
        }
        if (sql.includes('table_info')) {
          return {
            rows: [{ name: 'a', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 }] as Row[],
          };
        }
        if (sql.includes('foreign_key_list')) {
          return {
            rows: [
              {
                id: 0,
                seq: 0,
                table: 'other',
                from: 'a',
                to: 'id',
                on_update: 'BOGUS',
                on_delete: 'BOGUS',
                match: 'NONE',
              },
            ] as Row[],
          };
        }
        return { rows: [] as Row[] };
      },
      close: async () => {},
    };
    const err = await catchAsyncError(() => controlAdapter.introspect(driver));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'CONTRACT.INTROSPECTION_UNSUPPORTED',
      meta: { rule: 'BOGUS' },
    });
  });

  it('CONTRACT.MARKER_ROW_CORRUPT when marker invariants are not valid JSON', () => {
    const err = catchError(() => decodeSqliteMarkerRow({ invariants: '{not json' }));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'CONTRACT.MARKER_ROW_CORRUPT' });
  });
});
