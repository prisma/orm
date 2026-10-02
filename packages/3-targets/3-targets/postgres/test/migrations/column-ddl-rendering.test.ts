import { col, lit } from '@internal/sql-relational-core/contract-free';
import { SqlColumnDefaultIR, SqlColumnIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  buildSetDefaultColumn,
  renderColumnAlterType,
  renderColumnDdl,
  resolveColumnTemporaryDefault,
} from '../../src/core/migrations/column-ddl-rendering';
import { postgresTypeLookups as types } from '../postgres-type-lookups';

describe('renderColumnDdl', () => {
  it('renders a non-null array column with typeParams, an explicit many flag', () => {
    const column = new SqlColumnIR({
      name: 'tags',
      nativeType: 'text[]',
      nullable: false,
      many: true,
      resolvedDefault: { kind: 'literal', value: ['a', 'b'] },
      codecRef: { codecId: 'pg/text@1', typeParams: {} },
      codecBaseNativeType: 'text',
    });

    const result = renderColumnDdl('tags', column, types);

    expect(result.name).toBe('tags');
    expect(result.type).toBe('text[]');
    expect(result.notNull).toBe(true);
    expect(result.default).toEqual({ kind: 'literal', value: ['a', 'b'] });
    expect(result.codecRef).toEqual({ codecId: 'pg/text@1', typeParams: {} });
  });

  it('renders a nullable column with a non-autoincrement function default and no codec typeParams', () => {
    const column = new SqlColumnIR({
      name: 'id2',
      nativeType: 'uuid',
      nullable: true,
      resolvedDefault: { kind: 'function', expression: 'gen_random_uuid()' },
      codecRef: { codecId: 'pg/uuid@1' },
      codecBaseNativeType: 'uuid',
    });

    const result = renderColumnDdl('id2', column, types);

    expect(result.name).toBe('id2');
    expect(result.type).toBe('uuid');
    expect(result.notNull).toBeUndefined();
    expect(result.default).toEqual({ kind: 'function', expression: 'gen_random_uuid()' });
    expect(result.codecRef).toEqual({ codecId: 'pg/uuid@1' });
  });

  it('drops an autoincrement default (SERIAL implies it) while rendering the pseudo-type', () => {
    const column = new SqlColumnIR({
      name: 'id',
      nativeType: 'integer',
      nullable: false,
      resolvedDefault: { kind: 'function', expression: 'autoincrement()' },
      codecRef: { codecId: 'pg/int4@1' },
      codecBaseNativeType: 'int4',
    });

    const result = renderColumnDdl('id', column, types);

    expect(result.type).toBe('SERIAL');
    expect(result.default).toBeUndefined();
  });

  it('throws when the column carries no codec identity at all', () => {
    const column = new SqlColumnIR({ name: 'x', nativeType: 'text', nullable: true });

    expect(() => renderColumnDdl('x', column, types)).toThrow(
      /column "x" carries no codec identity/,
    );
  });

  it('throws when the column has a codecRef but no codecBaseNativeType', () => {
    const column = new SqlColumnIR({
      name: 'y',
      nativeType: 'text',
      nullable: true,
      codecRef: { codecId: 'pg/text@1' },
    });

    expect(() => renderColumnDdl('y', column, types)).toThrow(
      /column "y" carries no codec identity/,
    );
  });
});

describe('renderColumnAlterType', () => {
  it('renders the raw target type (no SERIAL pseudo-type) alongside the format_type display name', () => {
    const column = new SqlColumnIR({
      name: 'id3',
      nativeType: 'integer',
      nullable: false,
      resolvedDefault: { kind: 'function', expression: 'autoincrement()' },
      codecRef: { codecId: 'pg/int4@1' },
      codecBaseNativeType: 'int4',
    });

    expect(renderColumnAlterType(column, types)).toEqual({
      qualifiedTargetType: 'int4',
      formatTypeExpected: 'integer',
    });
  });
});

describe('resolveColumnTemporaryDefault', () => {
  it('resolves the built-in identity value for a uuid column with no codec hooks', () => {
    const column = new SqlColumnIR({
      name: 'id2',
      nativeType: 'uuid',
      nullable: true,
      codecRef: { codecId: 'pg/uuid@1' },
      codecBaseNativeType: 'uuid',
    });

    expect(resolveColumnTemporaryDefault(column, new Map(), types)).toBe(
      "'00000000-0000-0000-0000-000000000000'",
    );
  });
});

describe('buildSetDefaultColumn', () => {
  it('has no column to set when the diff node carries no resolved default', () => {
    const defaultNode = new SqlColumnDefaultIR({ raw: "'hello'::text" });

    expect(buildSetDefaultColumn('v', defaultNode, types)).toBeUndefined();
  });

  it('carries a scalar literal default with the column type and codec, for the adapter to write', () => {
    const defaultNode = new SqlColumnDefaultIR({
      resolved: { kind: 'literal', value: 'hello' },
      nativeTypeContext: 'text',
      codecRef: { codecId: 'pg/text@1' },
      codecBaseNativeType: 'text',
    });

    expect(buildSetDefaultColumn('v', defaultNode, types)).toEqual(
      col('v', 'text', { default: lit('hello'), codecRef: { codecId: 'pg/text@1' } }),
    );
  });

  it('has no column to set for an autoincrement default, which the column type writes', () => {
    const defaultNode = new SqlColumnDefaultIR({
      resolved: { kind: 'function', expression: 'autoincrement()' },
      nativeTypeContext: 'int4',
      codecRef: { codecId: 'pg/int4@1' },
      codecBaseNativeType: 'int4',
    });

    expect(buildSetDefaultColumn('v', defaultNode, types)).toBeUndefined();
  });

  it.each([
    { typeName: 'order', cast: '"order"[]' },
    { typeName: 'my enum', cast: '"my enum"[]' },
    { typeName: 'my"enum', cast: '"my""enum"[]' },
    { typeName: 'audit.AuditAction', cast: '"audit"."AuditAction"[]' },
  ])(
    'gives a list default of the enum $typeName the column type as DDL writes it',
    ({ typeName, cast }) => {
      const defaultNode = new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value: ['asc'] },
        nativeTypeContext: `${typeName}[]`,
        many: true,
        codecRef: { codecId: 'pg/enum@1', typeParams: { typeName }, many: true },
        codecBaseNativeType: typeName,
      });

      expect(buildSetDefaultColumn('v', defaultNode, types)?.type).toBe(cast);
    },
  );

  it('throws when a default to render carries no codec identity', () => {
    const defaultNode = new SqlColumnDefaultIR({
      resolved: { kind: 'literal', value: 42 },
      nativeTypeContext: 'int4',
    });

    expect(() => buildSetDefaultColumn('v', defaultNode, types)).toThrow(
      /carries no codec identity/,
    );
  });
});
