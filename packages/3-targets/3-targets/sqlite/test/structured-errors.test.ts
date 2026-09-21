import { CheckExpressionConstraint } from '@internal/sql-relational-core/ast';
import { col } from '@internal/sql-relational-core/contract-free';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { sqliteBigintDescriptor, sqliteRealDescriptor } from '../src/core/codecs';
import sqliteControlTargetDescriptor from '../src/core/control-target';
import { CreateTableCall, DropTableCall } from '../src/core/migrations/op-factory-call';
import {
  buildColumnDefaultSql,
  buildColumnTypeSql,
} from '../src/core/migrations/planner-ddl-builders';
import { renderOps } from '../src/core/migrations/render-ops';
import { createSqliteMigrationRunner } from '../src/core/migrations/runner';
import { escapeLiteral, quoteIdentifier } from '../src/core/sql-utils';
import { sqliteCreateNamespace } from '../src/core/sqlite-unbound-database';

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

async function captureAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

describe('structured error codes', () => {
  it('empty identifier raises CONTRACT.IDENTIFIER_INVALID', () => {
    const error = capture(() => quoteIdentifier(''));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
      message: 'Identifier cannot be empty',
    });
  });

  it('null byte in literal raises CONTRACT.IDENTIFIER_INVALID', () => {
    const error = capture(() => escapeLiteral('a\0b'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
      message: 'Literal value cannot contain null bytes',
    });
  });

  it('bigint codec decode of a boolean raises RUNTIME.DECODE_FAILED', () => {
    const bigintCodec = sqliteBigintDescriptor.factory()({ name: 'test' });
    const error = capture(() => bigintCodec.decodeJson(true));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'sqlite/bigint@1 database JSON value must be a decimal string',
    });
  });

  it('real codec encodeJson of a non-finite value raises RUNTIME.ENCODE_FAILED', () => {
    const realCodec = sqliteRealDescriptor.factory()({ name: 'test' });
    const error = capture(() => realCodec.encodeJson(Number.POSITIVE_INFINITY));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'sqlite/real@1 value must be a finite number',
    });
  });

  it('non-unbound namespace id raises CONTRACT.NAMESPACE_INVALID', () => {
    const error = capture(() => sqliteCreateNamespace({ id: 'auth', entries: { table: {} } }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.NAMESPACE_INVALID', meta: { received: 'auth' } });
  });

  it('non-SQL contract raises CONTRACT.TARGET_MISMATCH', () => {
    const error = capture(() =>
      sqliteControlTargetDescriptor.migrations?.contractToSchema(
        { storage: {} } as never,
        {} as never,
      ),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.TARGET_MISMATCH' });
  });

  it('unsafe native type raises CONTRACT.NATIVE_TYPE_INVALID', () => {
    const error = capture(() =>
      buildColumnTypeSql({ nativeType: 'TEXT; DROP', nullable: true, codecId: 'sqlite/text@1' }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.NATIVE_TYPE_INVALID',
      meta: { nativeType: 'TEXT; DROP' },
    });
  });

  it('unsafe default expression raises CONTRACT.DEFAULT_INVALID', () => {
    const error = capture(() =>
      buildColumnDefaultSql({ kind: 'function', expression: "eek(); DROP TABLE 'x'" }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.DEFAULT_INVALID' });
  });

  it('unknown typeRef raises CONTRACT.TYPE_UNKNOWN', () => {
    const error = capture(() =>
      buildColumnTypeSql(
        { nativeType: 'unused', nullable: true, codecId: 'sqlite/text@1', typeRef: 'missing' },
        {},
      ),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.TYPE_UNKNOWN', meta: { typeRef: 'missing' } });
  });

  it('toOp without a lowerer raises MIGRATION.SQLITE_CONTROL_STACK_MISSING', async () => {
    const error = await captureAsync(() => new DropTableCall('user').toOp());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
      meta: { factory: 'dropTable', tableName: 'user' },
    });
  });

  it('rendering a check-expression constraint raises CONTRACT.CONSTRAINT_INVALID', () => {
    const call = new CreateTableCall(
      'user',
      [col('id', 'INTEGER')],
      [new CheckExpressionConstraint({ name: 'chk', expression: '1 = 1' })],
    );
    const error = capture(() => call.renderTypeScript());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.CONSTRAINT_INVALID',
      meta: { constraintName: 'chk' },
    });
  });

  it('renderOps on a foreign-target op raises MIGRATION.TARGET_MISMATCH', () => {
    const foreignCall = {
      factoryName: 'createTable',
      toOp: () => ({ id: 'table.user', target: { id: 'postgres' } }),
    } as never;
    const error = capture(() => renderOps([foreignCall]));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'MIGRATION.TARGET_MISMATCH',
      meta: { opId: 'table.user', targetId: 'postgres', factoryName: 'createTable' },
    });
  });

  it('runner space/plan mismatch raises MIGRATION.CONTRACT_SPACE_VIOLATION', async () => {
    const runner = createSqliteMigrationRunner({} as never);
    const error = await captureAsync(() =>
      runner.executeOnConnection({
        space: 'app',
        plan: { spaceId: 'other', operations: [] },
      } as never),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'MIGRATION.CONTRACT_SPACE_VIOLATION',
      meta: { space: 'app', planSpaceId: 'other' },
    });
  });
});
