import type { DataType } from '@internal/framework-components/codec';
import { opaqueSql } from '@internal/sql-relational-core/ast';
import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import { SqlColumnDefaultIR, SqlColumnIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { pgInt4, pgNumeric, pgText, pgUuid } from '../../src/core/data-types';
import {
  buildSetDefaultColumn,
  renderColumnAlterType,
  renderColumnDdl,
  resolveColumnTemporaryDefault,
} from '../../src/core/migrations/column-ddl-rendering';
import { postgresTypeLookups as types } from '../postgres-type-lookups';

const typed = (type: DataType, typeParams: Record<string, unknown> = {}) => ({
  dataType: type,
  storedType: type,
  typeParams,
});

describe('renderColumnDdl', () => {
  it('renders a non-null array column with typeParams, an explicit many flag', () => {
    const column = new SqlColumnIR({
      name: 'tags',
      typeText: 'text[]',
      nullable: false,
      many: true,
      resolvedDefault: { kind: 'literal', value: ['a', 'b'] },
      codecRef: { codecId: 'pg/text@1', typeParams: {} },
      ...typed(pgText),
    });

    const result = renderColumnDdl('tags', column);

    expect(result.name).toBe('tags');
    expect(result.type).toBe('text[]');
    expect(result.notNull).toBe(true);
    expect(result.default).toEqual({ kind: 'literal', value: ['a', 'b'] });
    expect(result.codecRef).toEqual({ codecId: 'pg/text@1', typeParams: {} });
  });

  it('renders a nullable column with a non-autoincrement function default and no codec typeParams', () => {
    const column = new SqlColumnIR({
      name: 'id2',
      typeText: 'uuid',
      nullable: true,
      resolvedDefault: { kind: 'function', expression: 'gen_random_uuid()' },
      codecRef: { codecId: 'pg/uuid@1' },
      ...typed(pgUuid),
    });

    const result = renderColumnDdl('id2', column);

    expect(result.name).toBe('id2');
    expect(result.type).toBe('uuid');
    expect(result.notNull).toBeUndefined();
    expect(result.default).toEqual({
      kind: 'function',
      expression: opaqueSql('gen_random_uuid()'),
    });
    expect(result.codecRef).toEqual({ codecId: 'pg/uuid@1' });
  });

  it('writes the type from the stored type and the parameters as the contract writes them', () => {
    const column = new SqlColumnIR({
      name: 'amount',
      typeText: 'numeric(10)',
      nullable: true,
      codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 10 } },
      ...typed(pgNumeric, { precision: 10, scale: 0 }),
    });

    expect(renderColumnDdl('amount', column).type).toBe('numeric(10)');
  });

  it('throws when the column has no data type', () => {
    const column = new SqlColumnIR({
      name: 'x',
      typeText: 'text',
      nullable: true,
      codecRef: { codecId: 'pg/text@1' },
    });

    expect(() => renderColumnDdl('x', column)).toThrow(/column "x" has no data type/);
  });
});

describe('renderColumnAlterType', () => {
  it('renders the raw target type, with no SERIAL pseudo-type', () => {
    const column = new SqlColumnIR({
      name: 'id3',
      typeText: 'integer',
      nullable: false,
      resolvedDefault: { kind: 'function', expression: 'autoincrement()' },
      codecRef: { codecId: 'pg/int4@1' },
      ...typed(pgInt4),
    });

    expect({
      alter: renderColumnAlterType(column),
      create: renderColumnDdl('id3', column).type,
    }).toEqual({ alter: 'int4', create: 'SERIAL' });
  });
});

describe('resolveColumnTemporaryDefault', () => {
  it('resolves the built-in identity value for a uuid column with no codec hooks', () => {
    const column = new SqlColumnIR({
      name: 'id2',
      typeText: 'uuid',
      nullable: true,
      codecRef: { codecId: 'pg/uuid@1' },
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
      codecRef: { codecId: 'pg/text@1' },
    });

    expect(buildSetDefaultColumn('v', defaultNode, types)).toEqual(
      col('v', 'text', { default: lit('hello'), codecRef: { codecId: 'pg/text@1' } }),
    );
  });

  it.each(['int2', 'int4', 'int8'])(
    'carries an autoincrement default on a %s column, for setDefault to attach a sequence',
    (typeText) => {
      const defaultNode = new SqlColumnDefaultIR({
        resolved: { kind: 'function', expression: 'autoincrement()' },
        codecRef: { codecId: `pg/${typeText}@1` },
      });

      expect(buildSetDefaultColumn('v', defaultNode, types)).toEqual(
        col('v', typeText, {
          default: fn('autoincrement()'),
          codecRef: { codecId: `pg/${typeText}@1` },
        }),
      );
    },
  );

  it('carries an autoincrement default on a column that is not an integer, for setDefault to refuse', () => {
    const defaultNode = new SqlColumnDefaultIR({
      resolved: { kind: 'function', expression: 'autoincrement()' },
      codecRef: { codecId: 'pg/text@1' },
    });

    expect(buildSetDefaultColumn('v', defaultNode, types)).toEqual(
      col('v', 'text', { default: fn('autoincrement()'), codecRef: { codecId: 'pg/text@1' } }),
    );
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
        many: true,
        codecRef: { codecId: 'pg/enum@1', typeParams: { typeName }, many: true },
      });

      expect(buildSetDefaultColumn('v', defaultNode, types)?.type).toBe(cast);
    },
  );

  it('throws when a default to render carries no codec identity', () => {
    const defaultNode = new SqlColumnDefaultIR({
      resolved: { kind: 'literal', value: 42 },
    });

    expect(() => buildSetDefaultColumn('v', defaultNode, types)).toThrow(
      /carries no codec identity/,
    );
  });
});
