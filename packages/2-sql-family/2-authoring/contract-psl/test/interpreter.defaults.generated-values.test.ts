import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { modelsOf, postgresScalarAuthoringTypes, postgresScalarTypeDescriptors } from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

const types: AuthoringTypeNamespace = {
  ...postgresScalarAuthoringTypes,
  TimestampString: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timestamp-string@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  DateString: { kind: 'typeConstructor', output: { codecId: 'pg/date-string@1' } },
  sql: {
    Char: {
      kind: 'typeConstructor',
      args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
      output: { codecId: 'sql/char@1', typeParams: { length: { kind: 'arg', index: 0 } } },
    },
  },
};

describe('generated values with a database default or on an optional field', () => {
  it('keeps the generators, the database default and the nullability', () => {
    const result = interpretPostgresSchema(
      `model Post {
  id        Int @id
  updatedAt TimestampString(3) @default(now()) @onCreate(now()) @onUpdate(now())
  touchedAt TimestamptzTemporal @default(now()) @onUpdate(now())
  token     String? @onCreate(uuid())
  editedAt  TimestampString(3)? @onCreate(now()) @onUpdate(now())
  day       DateString? @onCreate(now()) @onUpdate(now())
}`,
      {
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: { type: types },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nowDefault = { kind: 'function', expression: 'now()' };
    expect(unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Post']).toEqual({
      columns: {
        id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
        updatedAt: {
          many: false,
          dataType: 'pg/timestamp',
          codecId: 'pg/timestamp-string@1',
          nullable: false,
          typeParams: { precision: 3 },
          default: nowDefault,
        },
        touchedAt: {
          many: false,
          dataType: 'pg/timestamptz',
          codecId: 'pg/timestamptz-temporal@1',
          nullable: false,
          default: nowDefault,
        },
        token: { many: false, dataType: 'pg/text', codecId: 'pg/text@1', nullable: true },
        editedAt: {
          many: false,
          dataType: 'pg/timestamp',
          codecId: 'pg/timestamp-string@1',
          nullable: true,
          typeParams: { precision: 3 },
        },
        day: { many: false, dataType: 'pg/date', codecId: 'pg/date-string@1', nullable: true },
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    });
    const scalar = (codecId: string, nullable: boolean, typeParams?: { precision: number }) => ({
      many: false,
      nullable,
      type: { kind: 'scalar', codecId, ...(typeParams ? { typeParams } : {}) },
    });
    const fieldNames = ['id', 'updatedAt', 'touchedAt', 'token', 'editedAt', 'day'];
    expect(JSON.parse(JSON.stringify(modelsOf(result.value)['Post']))).toEqual({
      fields: {
        id: scalar('pg/int4@1', false),
        updatedAt: scalar('pg/timestamp-string@1', false, { precision: 3 }),
        touchedAt: scalar('pg/timestamptz-temporal@1', false),
        token: scalar('pg/text@1', true),
        editedAt: scalar('pg/timestamp-string@1', true, { precision: 3 }),
        day: scalar('pg/date-string@1', true),
      },
      relations: {},
      storage: {
        namespaceId: 'public',
        table: 'Post',
        fields: Object.fromEntries(fieldNames.map((name) => [name, { column: name }])),
      },
    });

    const ref = (field: string) => ({ namespace: 'public', entry: 'Post', field });
    const timestampStringNow = {
      kind: 'generator',
      id: 'timestampStringNow',
      params: { precision: 3 },
    };
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: ref('day'),
        onCreate: { kind: 'generator', id: 'dateStringNow' },
        onUpdate: { kind: 'generator', id: 'dateStringNow' },
      },
      { ref: ref('editedAt'), onCreate: timestampStringNow, onUpdate: timestampStringNow },
      { ref: ref('token'), onCreate: { kind: 'generator', id: 'uuidv4' } },
      { ref: ref('touchedAt'), onUpdate: { kind: 'generator', id: 'instantNow' } },
      { ref: ref('updatedAt'), onCreate: timestampStringNow, onUpdate: timestampStringNow },
    ]);
  });
});

describe('a column with no generator, on an optional field or beside a database default', () => {
  it('keeps the nullability and the database default, and has no execution entry', () => {
    const result = interpretPostgresSchema(
      `model Doc {
  id      Int @id
  token   sql.Char(36)?
  meta    Jsonb?
  options Jsonb @default(json\`{ "plan": "free" }\`)
}`,
      {
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: { type: types },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['Doc']).toEqual({
      columns: {
        id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
        token: {
          many: false,
          dataType: 'pg/char',
          codecId: 'sql/char@1',
          nullable: true,
          typeParams: { length: 36 },
        },
        meta: { many: false, dataType: 'pg/jsonb', codecId: 'pg/jsonb@1', nullable: true },
        options: {
          many: false,
          dataType: 'pg/jsonb',
          codecId: 'pg/jsonb@1',
          nullable: false,
          default: { kind: 'literal', value: { plan: 'free' } },
        },
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    });
    const scalar = (codecId: string, nullable: boolean, typeParams?: { length: number }) => ({
      many: false,
      nullable,
      type: { kind: 'scalar', codecId, ...(typeParams ? { typeParams } : {}) },
    });
    expect(JSON.parse(JSON.stringify(modelsOf(result.value)['Doc']))).toEqual({
      fields: {
        id: scalar('pg/int4@1', false),
        token: scalar('sql/char@1', true, { length: 36 }),
        meta: scalar('pg/jsonb@1', true),
        options: scalar('pg/jsonb@1', false),
      },
      relations: {},
      storage: {
        namespaceId: 'public',
        table: 'Doc',
        fields: Object.fromEntries(
          ['id', 'token', 'meta', 'options'].map((name) => [name, { column: name }]),
        ),
      },
    });
    expect(result.value.execution?.mutations.defaults ?? []).toEqual([]);
  });
});
