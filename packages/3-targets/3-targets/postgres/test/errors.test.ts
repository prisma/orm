import type { SqlControlFamilyInstance } from '@internal/family-sql/control';
import type { EntityHandleLoweringInput } from '@internal/sql-contract/entity-handle-lowering-hook';
import type { StorageColumn } from '@internal/sql-contract/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { postgresLowerEntityHandles } from '../src/core/authoring';
import { renderLength } from '../src/core/codec-helpers';
import { pgNumericDescriptor } from '../src/core/codecs';
import { errorPostgresMigrationStackMissing } from '../src/core/errors';
import {
  buildColumnDefaultSql,
  buildColumnTypeSql,
} from '../src/core/migrations/planner-ddl-builders';
import { createPostgresMigrationRunner } from '../src/core/migrations/runner';

describe('errorPostgresMigrationStackMissing', () => {
  it('renders under the stable MIGRATION.POSTGRES_CONTROL_STACK_MISSING code', () => {
    expect(errorPostgresMigrationStackMissing('createTable').toEnvelope().code).toBe(
      'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
    );
  });

  it('names the operation that failed in summary, why, and meta', () => {
    const envelope = errorPostgresMigrationStackMissing('dropColumn').toEnvelope();
    expect(envelope.summary).toContain('dropColumn');
    expect(envelope.why).toContain('dropColumn');
    expect(envelope.meta).toEqual({ operation: 'dropColumn' });
  });

  it('reports each operation distinctly rather than always naming one', () => {
    const createTable = errorPostgresMigrationStackMissing('createTable').toEnvelope().summary;
    const dropColumn = errorPostgresMigrationStackMissing('dropColumn').toEnvelope().summary;
    expect(createTable).not.toBe(dropColumn);
  });
});

describe('postgresError sites', () => {
  function catchError(fn: () => unknown): unknown {
    try {
      fn();
    } catch (error) {
      return error;
    }
    throw new Error('expected function to throw');
  }

  it('renderLength rejects non-integer length as RUNTIME.TYPE_PARAMS_INVALID', () => {
    const error = catchError(() => renderLength('VarChar', { length: 1.5 }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'RUNTIME.TYPE_PARAMS_INVALID' });
  });

  it('pg/numeric encodeJson rejects a non-numeral value as RUNTIME.ENCODE_FAILED', () => {
    const codec = pgNumericDescriptor.factory({ precision: 10, scale: 2 })({ name: 'test' });
    const error = catchError(() => codec.encodeJson('not-a-number'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        'pg/numeric@1 application value must be canonical numeric text: an optionally negated decimal numeral, or NaN, Infinity or -Infinity',
    });
  });

  it('buildColumnTypeSql rejects an unsafe native type as CONTRACT.NATIVE_TYPE_INVALID', () => {
    const column = {
      nativeType: 'text; DROP TABLE users',
      codecId: 'pg/text@1',
      nullable: false,
    } as StorageColumn;
    const error = catchError(() => buildColumnTypeSql(column, new Map()));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.NATIVE_TYPE_INVALID' });
  });

  it('buildColumnTypeSql without a codecId for typeParams throws CONTRACT.CODEC_DESCRIPTOR_MISSING', () => {
    const column = {
      nativeType: 'varchar',
      nullable: false,
      typeParams: { length: 10 },
    } as unknown as StorageColumn;
    const error = catchError(() => buildColumnTypeSql(column, new Map()));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING' });
  });

  it('buildColumnTypeSql without an expandNativeType hook throws CONTRACT.PACK_CONTRIBUTION_INVALID', () => {
    const column = {
      nativeType: 'varchar',
      codecId: 'pg/varchar@1',
      nullable: false,
      typeParams: { length: 10 },
    } as StorageColumn;
    const error = catchError(() => buildColumnTypeSql(column, new Map()));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.PACK_CONTRIBUTION_INVALID' });
  });

  it('buildColumnDefaultSql rejects an unsafe default expression as CONTRACT.DEFAULT_INVALID', () => {
    const error = catchError(() =>
      buildColumnDefaultSql({ kind: 'function', expression: 'now(); DROP TABLE users' }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.DEFAULT_INVALID' });
  });

  it('postgresLowerEntityHandles rejects an unknown entity kind as CONTRACT.ENTITY_KIND_INVALID', () => {
    const input = {
      handles: [{ handle: { entityKind: 'mystery' }, refs: {} }],
    } as unknown as EntityHandleLoweringInput;
    const error = catchError(() => postgresLowerEntityHandles(input));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.ENTITY_KIND_INVALID',
      meta: { entityKind: 'mystery' },
    });
  });

  it('postgresLowerEntityHandles rejects a duplicate role as CONTRACT.ROLE_INVALID', () => {
    const input = {
      handles: [
        { handle: { entityKind: 'role', name: 'app' }, refs: {} },
        { handle: { entityKind: 'role', name: 'app' }, refs: {} },
      ],
    } as unknown as EntityHandleLoweringInput;
    const error = catchError(() => postgresLowerEntityHandles(input));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.ROLE_INVALID', meta: { role: 'app' } });
  });

  it('postgresLowerEntityHandles rejects an unresolved rls target as CONTRACT.MODEL_UNKNOWN', () => {
    const input = {
      handles: [{ handle: { entityKind: 'rls' }, refs: {} }],
    } as unknown as EntityHandleLoweringInput;
    const error = catchError(() => postgresLowerEntityHandles(input));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.MODEL_UNKNOWN' });
  });

  it('postgresLowerEntityHandles rejects a cross-space rls target as CONTRACT.POLICY_INVALID', () => {
    const input = {
      handles: [
        {
          handle: { entityKind: 'rls' },
          refs: { target: { kind: 'cross-space', modelName: 'user', tableName: 'user' } },
        },
      ],
    } as unknown as EntityHandleLoweringInput;
    const error = catchError(() => postgresLowerEntityHandles(input));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.POLICY_INVALID' });
  });

  it('runner rejects a space/plan mismatch as MIGRATION.CONTRACT_SPACE_VIOLATION', async () => {
    const runner = createPostgresMigrationRunner({} as SqlControlFamilyInstance);
    const options = {
      destinationContract: { storage: { namespaces: {} } },
      driver: {},
      plan: { spaceId: 'app', operations: [] },
      space: 'other',
    } as unknown as Parameters<typeof runner.executeOnConnection>[0];
    await expect(runner.executeOnConnection(options)).rejects.toMatchObject({
      code: 'MIGRATION.CONTRACT_SPACE_VIOLATION',
      meta: { space: 'other', planSpaceId: 'app' },
    });
  });
});
